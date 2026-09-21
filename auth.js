const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  sendVerificationEmail,
  sendAccountCreatedEmail,
  sendPasswordResetEmail,
} = require('../utils/email');

const router = express.Router();

// Slow down credential-guessing / signup spam without blocking normal use.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function issueToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
}

// ---------- POST /api/auth/signup ----------
router.post('/signup', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = db
    .prepare('INSERT INTO users (email, password_hash, is_verified) VALUES (?, ?, 0)')
    .run(email.toLowerCase(), passwordHash);

  const token = crypto.randomBytes(30).toString('base64url');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO email_tokens (token, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)'
  ).run(token, result.lastInsertRowid, 'verify', expiresAt);

  try {
    await sendVerificationEmail(email.toLowerCase(), token);
  } catch (err) {
    console.error('Failed to send verification email:', err.message);
    // Don't fail signup just because email delivery hiccuped — the account exists;
    // a "resend verification" endpoint would let them retry (not included here).
  }

  res.status(201).json({
    message: 'Account created. Check your email to verify your address before logging in.',
  });
});

// ---------- GET /api/auth/verify-email?token=... ----------
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing verification token.' });

  const row = db
    .prepare(
      `SELECT et.*, u.email FROM email_tokens et
       JOIN users u ON u.id = et.user_id
       WHERE et.token = ? AND et.purpose = 'verify'`
    )
    .get(token);

  if (!row) return res.status(400).json({ error: 'Invalid or already-used verification link.' });
  if (row.used) return res.status(400).json({ error: 'This verification link was already used.' });
  if (new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This verification link has expired.' });
  }

  db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').run(row.user_id);
  db.prepare('UPDATE email_tokens SET used = 1 WHERE token = ?').run(token);

  try {
    await sendAccountCreatedEmail(row.email);
  } catch (err) {
    console.error('Failed to send welcome email:', err.message);
  }

  res.json({ message: 'Email verified. You can now log in.' });
});

// ---------- POST /api/auth/login ----------
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

  // Same error for "no account" and "wrong password" — don't reveal which.
  const invalid = () => res.status(401).json({ error: "Email or password doesn't match an account." });

  if (!user) return invalid();
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return invalid();

  if (!user.is_verified) {
    return res.status(403).json({ error: 'Please verify your email before logging in.' });
  }

  const token = issueToken(user);
  res.cookie('session', token, COOKIE_OPTS);
  res.json({ message: 'Logged in.', user: { id: user.id, email: user.email } });
});

// ---------- POST /api/auth/logout ----------
router.post('/logout', (req, res) => {
  res.clearCookie('session', { ...COOKIE_OPTS, maxAge: 0 });
  res.json({ message: 'Logged out.' });
});

// ---------- GET /api/auth/me (protected example) ----------
router.get('/me', requireAuth, (req, res) => {
  res.json({ userId: req.user.userId, email: req.user.email });
});

// ---------- POST /api/auth/forgot-password ----------
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body || {};
  // Always respond the same way, whether or not the account exists —
  // prevents leaking which emails are registered.
  const genericResponse = { message: 'If that account exists, a reset link has been sent.' };

  if (!email) return res.json(genericResponse);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (user) {
    const token = crypto.randomBytes(30).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.prepare(
      'INSERT INTO email_tokens (token, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)'
    ).run(token, user.id, 'reset', expiresAt);
    try {
      await sendPasswordResetEmail(user.email, token);
    } catch (err) {
      console.error('Failed to send reset email:', err.message);
    }
  }

  res.json(genericResponse);
});

// ---------- POST /api/auth/reset-password ----------
router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ error: 'A valid token and an 8+ character password are required.' });
  }

  const row = db
    .prepare(`SELECT * FROM email_tokens WHERE token = ? AND purpose = 'reset'`)
    .get(token);

  if (!row) return res.status(400).json({ error: 'Invalid or already-used reset link.' });
  if (row.used) return res.status(400).json({ error: 'This reset link was already used.' });
  if (new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This reset link has expired.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, row.user_id);
  db.prepare('UPDATE email_tokens SET used = 1 WHERE token = ?').run(token);

  res.json({ message: 'Password updated. You can now log in.' });
});

module.exports = router;

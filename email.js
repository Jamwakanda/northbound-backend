const nodemailer = require('nodemailer');

// Works with ANY SMTP provider (Resend, Postmark, SendGrid, Mailgun, Amazon SES,
// or plain Gmail SMTP for testing). Just set the SMTP_* env vars — see .env.example.
// In development (NODE_ENV=development) with no SMTP_HOST set, emails are printed
// to the console instead of sent, so you can build without a live provider.

const isDev = process.env.NODE_ENV !== 'production';
const hasSmtpConfig = !!process.env.SMTP_HOST;

let transporter;

if (hasSmtpConfig) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587/STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
} else if (isDev) {
  // Dev fallback: log instead of send. Prevents crashes when no provider is configured yet.
  transporter = {
    sendMail: async (opts) => {
      console.log('\n--- EMAIL (dev mode, not actually sent) ---');
      console.log('To:', opts.to);
      console.log('Subject:', opts.subject);
      console.log('Body:\n', opts.text || opts.html);
      console.log('--------------------------------------------\n');
      return { messageId: 'dev-mode-no-send' };
    },
  };
} else {
  throw new Error('SMTP_HOST is not configured. Set SMTP_* env vars before running in production.');
}

const FROM = process.env.EMAIL_FROM || 'Northbound <no-reply@northbound.example>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

async function sendVerificationEmail(toEmail, token) {
  const verifyUrl = `${APP_URL}/api/auth/verify-email?token=${token}`;
  return transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Verify your Northbound account',
    text: `Welcome to Northbound.\n\nConfirm your email to activate your account:\n${verifyUrl}\n\nThis link expires in 24 hours. If you didn't create this account, you can ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2>Confirm your email</h2>
        <p>Welcome to Northbound. Click below to activate your account.</p>
        <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 20px;background:#C6FF3B;color:#0C2027;text-decoration:none;font-weight:bold;">Verify email</a></p>
        <p style="color:#888;font-size:13px;">This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>
      </div>
    `,
  });
}

async function sendAccountCreatedEmail(toEmail) {
  return transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Your Northbound account is active',
    text: `Your account is verified and ready to go.\n\nLog in any time at ${APP_URL}/login`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2>You're all set</h2>
        <p>Your email is verified and your Northbound account is active.</p>
        <p><a href="${APP_URL}/login" style="display:inline-block;padding:12px 20px;background:#C6FF3B;color:#0C2027;text-decoration:none;font-weight:bold;">Log in</a></p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(toEmail, token) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;
  return transporter.sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Reset your Northbound password',
    text: `Reset your password:\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2>Reset your password</h2>
        <p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#C6FF3B;color:#0C2027;text-decoration:none;font-weight:bold;">Choose a new password</a></p>
        <p style="color:#888;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail, sendAccountCreatedEmail, sendPasswordResetEmail };

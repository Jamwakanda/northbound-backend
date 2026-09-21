# Northbound Backend

A real signup/login backend: password hashing, email verification, JWT sessions,
password reset, and transactional emails (verification + "account created" +
password reset). SQLite for storage, so there's no separate database to stand up.

Tested end-to-end in development (signup → verify → login → protected route →
wrong-password rejection) before being handed to you.

## 1. Install and configure

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `JWT_SECRET` — generate with `openssl rand -hex 32`
- `APP_URL` / `CORS_ORIGIN` — your real domain(s)
- `SMTP_*` — credentials from an email provider (see below)

## 2. Get real email sending working

This uses standard SMTP, so any transactional email provider works. Pick one:

| Provider | Free tier | SMTP host |
|---|---|---|
| [Resend](https://resend.com) | 3,000 emails/mo | `smtp.resend.com` |
| [Postmark](https://postmarkapp.com) | 100/mo trial | `smtp.postmarkapp.com` |
| [Amazon SES](https://aws.amazon.com/ses/) | 62,000/mo (from EC2) | region-specific |
| [SendGrid](https://sendgrid.com) | 100/day | `smtp.sendgrid.net` |

Sign up, verify your sending domain (they'll give you DNS records to add — this
is what stops your emails landing in spam), and drop the API key into `SMTP_PASS`.

**Without SMTP configured**, the server runs in dev mode and prints emails to
the console instead of sending them — useful for building, not for real users.

## 3. Run it

```bash
npm start          # production
node src/server.js # same thing, explicitly
```

## 4. Endpoints

| Method | Path | Does |
|---|---|---|
| POST | `/api/auth/signup` | Create account, send verification email |
| GET | `/api/auth/verify-email?token=` | Verify email, send "account created" email |
| POST | `/api/auth/login` | Log in, sets an httpOnly session cookie |
| POST | `/api/auth/logout` | Clear session cookie |
| GET | `/api/auth/me` | Example protected route |
| POST | `/api/auth/forgot-password` | Send password reset email |
| POST | `/api/auth/reset-password` | Set new password from reset token |

All error responses are `{ "error": "human-readable message" }`.

## 5. Connect your front-end

**Important:** the Northbound pages I published earlier as Claude artifacts
can't call this API directly — artifact pages run in a sandbox that only
allows a handful of script CDNs, not arbitrary `fetch()` calls to your own
server. To wire the real login page up to this backend, host both the
front-end and this API under your own domain (e.g. Vercel/Netlify for the
front-end, Render/Fly.io/a VPS for this API), then point your login form's
`fetch()` calls at `${APP_URL}/api/auth/...` with `credentials: 'include'`
so the session cookie is sent.

Example:

```js
const res = await fetch('https://api.northbound.com/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ email, password }),
});
const data = await res.json();
```

## 6. Before going live

- Put this behind HTTPS (the session cookie is marked `secure` in production,
  so it won't be sent over plain HTTP).
- Move off SQLite to Postgres/MySQL if you expect concurrent writes at scale
  (SQLite is fine for most early-stage traffic).
- Add a "resend verification email" endpoint (signup silently swallows email
  failures so a bad SMTP config doesn't block account creation — you'll want
  a retry path for real users).
- Consider adding 2FA before this handles real trading accounts and money.

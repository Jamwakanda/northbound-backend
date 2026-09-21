require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');

// Fail fast if critical config is missing, rather than running insecurely.
if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in environment. Set it in .env before starting the server.');
  process.exit(1);
}

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173', // your front-end's real origin
    credentials: true, // required so the httpOnly session cookie is sent/received
  })
);
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);

// Centralized error handler — keeps stack traces out of responses.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Northbound backend listening on :${PORT}`));

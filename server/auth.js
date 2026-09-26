'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { getPool, withTransaction } = require('./db');
const { production, sessionDays } = require('./config');
const { insertSampleData, insertDefaultBudgets } = require('./data');

const COOKIE = 'st_session';
const BCRYPT_ROUNDS = 12;
// Compared against when the email doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const publicUser = u => ({ id: u.id, name: u.name, email: u.email });

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

async function createSession(conn, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = sessionDays * 86400 * 1000;
  await conn.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    [sha256(token), userId, new Date(Date.now() + maxAge)]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: production, path: '/', maxAge });
  return token;
}

// Same-origin requests use the HttpOnly cookie. Allowlisted cross-origin requests use
// "Authorization: Bearer <token>" only; browsers never attach that header on their own.
function sessionToken(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.get('authorization') || '');
  if (req.crossOrigin) return m ? m[1] : null;
  return readCookie(req, COOKIE);
}

// Attaches req.user when a valid session cookie is present.
async function loadSession(req, _res, next) {
  const token = sessionToken(req);
  if (token) {
    const [rows] = await getPool().query(
      `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()`, [sha256(token)]);
    if (rows[0]) { req.user = rows[0]; req.sessionHash = sha256(token); }
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' } });

router.post('/signup', limiter, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const sample = req.body?.sample !== false;
  if (!name || name.length > 80) return res.status(400).json({ error: 'Enter your name (up to 80 characters).' });
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Password must be 8–72 characters.' });

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const user = await withTransaction(async conn => {
      const [r] = await conn.query('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)', [email, name, hash]);
      const id = r.insertId;
      await insertDefaultBudgets(conn, id);
      if (sample) await insertSampleData(conn, id);
      const token = await createSession(conn, res, id);
      return { id, name, email, token };
    });
    res.status(201).json({ user: publicUser(user), ...(req.crossOrigin && { token: user.token }) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account with that email already exists.' });
    throw err;
  }
});

router.post('/login', limiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const [rows] = await getPool().query('SELECT id, name, email, password_hash FROM users WHERE email = ?', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Incorrect email or password.' });
  const pool = getPool();
  const token = await createSession(pool, res, user.id);
  await pool.query('DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP()');
  res.json({ user: publicUser(user), ...(req.crossOrigin && { token }) });
});

router.post('/logout', async (req, res) => {
  if (req.sessionHash) await getPool().query('DELETE FROM sessions WHERE token_hash = ?', [req.sessionHash]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = { router, loadSession, requireUser };

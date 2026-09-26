'use strict';
// Test data factory shared by the integration and e2e suites. It writes users, sessions
// and transactions straight to MySQL, so each test sets up its preconditions in
// milliseconds (no bcrypt cost 12, no sign-up rate limit) and only drives the
// behaviour it is actually about. Everything it creates is removed by cleanup().
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getPool, withTransaction } = require('../../server/db');
const { insertDefaultBudgets, insertSampleData } = require('../../server/data');

const DOMAIN = 'example.test';
const PASSWORD = 'correct horse battery';
const tracked = new Set();

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const uniqueEmail = (prefix = 't') => `${prefix}-${crypto.randomBytes(5).toString('hex')}@${DOMAIN}`;
const track = email => { tracked.add(email.trim().toLowerCase()); return email; };

// Local calendar date (the app works in the browser's local time), offset by N days.
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA');
}

async function createUser({ prefix = 't', name = 'Test User', password = PASSWORD, sample = false, budgets = true } = {}) {
  const email = track(uniqueEmail(prefix));
  const hash = await bcrypt.hash(password, 4); // a valid bcrypt hash; low cost keeps setup fast
  const id = await withTransaction(async conn => {
    const [r] = await conn.query('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)', [email, name, hash]);
    if (budgets) await insertDefaultBudgets(conn, r.insertId);
    if (sample) await insertSampleData(conn, r.insertId);
    return r.insertId;
  });
  return { id, email, name, password };
}

// Returns a raw session token, usable as the st_session cookie or a bearer token.
// expires_at is a DATETIME (whole seconds), so "expired" sessions use a wide margin.
const EXPIRED = -3600 * 1000;
async function createSession(userId, { ttlMs = 24 * 3600 * 1000 } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  await getPool().query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    [sha256(token), userId, new Date(Date.now() + ttlMs)]);
  return token;
}

async function createTx(userId, over = {}) {
  const t = { date: isoDate(), merchant: 'Cafe', category: 'dining', type: 'expense', amount: 12.5, note: '', ...over };
  const [r] = await getPool().query(
    'INSERT INTO transactions (user_id, tx_date, merchant, category, type, amount, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, t.date, t.merchant, t.category, t.type, t.amount, t.note]);
  return { id: String(r.insertId), version: 1, ...t };
}

// Simulates another device saving the transaction (bumps its version).
async function editElsewhere(txId, fields) {
  const sets = Object.keys(fields).map(k => `${k === 'date' ? 'tx_date' : k} = ?`);
  await getPool().query(`UPDATE transactions SET ${sets.join(', ')}, version = version + 1 WHERE id = ?`, [...Object.values(fields), txId]);
}

const revokeSessions = userId => getPool().query('DELETE FROM sessions WHERE user_id = ?', [userId]);

async function row(sql, params) {
  const [rows] = await getPool().query(sql, params);
  return rows[0];
}

async function cleanup() {
  if (tracked.size) await getPool().query('DELETE FROM users WHERE email IN (?)', [[...tracked]]);
  tracked.clear();
}

// Safety net for crashed runs: removes leftovers by prefix.
const purge = prefix => getPool().query('DELETE FROM users WHERE email LIKE ?', [`${prefix}-%@${DOMAIN}`]);

module.exports = {
  PASSWORD, EXPIRED, uniqueEmail, track, isoDate, sha256,
  createUser, createSession, createTx, editElsewhere, revokeSessions, row,
  cleanup, purge, close: () => getPool().end(),
};

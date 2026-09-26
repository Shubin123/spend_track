'use strict';
const express = require('express');
const { getPool, withTransaction } = require('./db');
const { CATEGORIES, EXPENSE_CATS, DEFAULT_BUDGETS, generate } = require('../seed');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TX_COLS = 'id, tx_date AS date, merchant, category, type, amount, note, version';
const toTx = r => ({ ...r, id: String(r.id) });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1970 && y <= 2100;
}

// Returns a clean transaction or throws HttpError(400).
function validateTx(body = {}) {
  const type = body.type;
  const category = body.category;
  const merchant = String(body.merchant ?? '').trim();
  const note = String(body.note ?? '').trim();
  const date = String(body.date ?? '');
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (type !== 'expense' && type !== 'income') throw new HttpError(400, 'Type must be expense or income.');
  if (!CATEGORIES[category] || (type === 'income') !== (category === 'income')) throw new HttpError(400, 'Invalid category for this type.');
  if (!merchant || merchant.length > 60) throw new HttpError(400, 'Merchant is required (up to 60 characters).');
  if (note.length > 120) throw new HttpError(400, 'Note must be 120 characters or fewer.');
  if (!validDate(date)) throw new HttpError(400, 'Enter a valid date.');
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e10) throw new HttpError(400, 'Amount must be greater than 0.');
  return { type, category, merchant, note, date, amount };
}

async function insertDefaultBudgets(conn, userId) {
  const rows = Object.entries(DEFAULT_BUDGETS).map(([c, a]) => [userId, c, a]);
  await conn.query('INSERT INTO budgets (user_id, category, amount) VALUES ? ON DUPLICATE KEY UPDATE amount = VALUES(amount)', [rows]);
}

async function insertSampleData(conn, userId) {
  const { txs } = generate(new Date(), 1 + (userId % 1000));
  const rows = txs.map(t => [userId, t.date, t.merchant, t.category, t.type, t.amount, t.note]);
  await conn.query('INSERT INTO transactions (user_id, tx_date, merchant, category, type, amount, note) VALUES ?', [rows]);
}

async function getBudgets(conn, userId) {
  const [rows] = await conn.query('SELECT category, amount FROM budgets WHERE user_id = ?', [userId]);
  const out = Object.fromEntries(EXPENSE_CATS.map(c => [c, 0]));
  for (const r of rows) out[r.category] = r.amount;
  return out;
}

const router = express.Router();

// Transaction ids are BIGINT UNSIGNED. Reject anything else before it reaches SQL: in
// strict sql_mode (MySQL 8 default) comparing id to a non-number is an error, not a miss.
router.param('id', (_req, _res, next, id) => next(/^[1-9]\d{0,18}$/.test(id) ? undefined : new HttpError(404, 'This transaction no longer exists.')));

router.get('/data', async (req, res) => {
  const pool = getPool();
  const [txs] = await pool.query(`SELECT ${TX_COLS} FROM transactions WHERE user_id = ? ORDER BY tx_date DESC, id DESC`, [req.user.id]);
  res.json({ transactions: txs.map(toTx), budgets: await getBudgets(pool, req.user.id) });
});

router.post('/transactions', async (req, res) => {
  const t = validateTx(req.body);
  const pool = getPool();
  const [r] = await pool.query(
    'INSERT INTO transactions (user_id, tx_date, merchant, category, type, amount, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.user.id, t.date, t.merchant, t.category, t.type, t.amount, t.note]);
  // Built from the validated values rather than re-read, which could race with a reset.
  res.status(201).json({ transaction: { id: String(r.insertId), ...t, version: 1 } });
});

// Optimistic concurrency: the client sends the version it last saw. If someone else
// saved in between, nothing is written and the client gets 409 with the current row.
router.put('/transactions/:id', async (req, res) => {
  const t = validateTx(req.body);
  const version = Number(req.body.version);
  if (!Number.isInteger(version) || version < 1) throw new HttpError(400, 'Missing version.');
  const pool = getPool();
  const [r] = await pool.query(
    `UPDATE transactions SET tx_date = ?, merchant = ?, category = ?, type = ?, amount = ?, note = ?, version = version + 1
     WHERE id = ? AND user_id = ? AND version = ?`,
    [t.date, t.merchant, t.category, t.type, t.amount, t.note, req.params.id, req.user.id, version]);
  const [rows] = await pool.query(`SELECT ${TX_COLS} FROM transactions WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'This transaction no longer exists.');
  if (r.affectedRows === 0) {
    return res.status(409).json({ error: 'This transaction was changed somewhere else. Showing the latest version.', transaction: toTx(rows[0]) });
  }
  res.json({ transaction: toTx(rows[0]) });
});

router.delete('/transactions/:id', async (req, res) => {
  const [r] = await getPool().query('DELETE FROM transactions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!r.affectedRows) throw new HttpError(404, 'This transaction no longer exists.');
  res.json({ ok: true });
});

router.put('/budgets/:category', async (req, res) => {
  const cat = req.params.category;
  const amount = Math.round(Number(req.body?.amount));
  if (!EXPENSE_CATS.includes(cat)) throw new HttpError(400, 'Unknown category.');
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1e10) throw new HttpError(400, 'Budget must be 0 or more.');
  await getPool().query(
    'INSERT INTO budgets (user_id, category, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = VALUES(amount)',
    [req.user.id, cat, amount]);
  res.json({ category: cat, amount });
});

// Clear this user's transactions and zero every saved budget atomically.
// READ COMMITTED avoids the gap locks that make this bulk delete deadlock with
// other users' writes; locking the user row serialises two resets of the same account.
router.post('/reset', async (req, res) => {
  const budgets = await withTransaction(async conn => {
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
    await conn.query('DELETE FROM transactions WHERE user_id = ?', [req.user.id]);
    await conn.query('UPDATE budgets SET amount = 0 WHERE user_id = ?', [req.user.id]);
    return getBudgets(conn, req.user.id);
  }, { isolation: 'READ COMMITTED' });
  res.json({ ok: true, transactions: [], budgets });
});

module.exports = { router, HttpError, validateTx, insertSampleData, insertDefaultBudgets };

#!/usr/bin/env node
'use strict';
// Creates (or resets the password of) an account.
// Reads ST_NAME, ST_EMAIL, ST_PASSWORD, ST_SAMPLE from the environment so the
// password never appears in shell history or the process list.
const bcrypt = require('bcryptjs');
const { getPool, withTransaction } = require('../server/db');
const { insertDefaultBudgets, insertSampleData } = require('../server/data');

async function main() {
  const name = (process.env.ST_NAME || 'Demo User').trim();
  const email = (process.env.ST_EMAIL || '').trim().toLowerCase();
  const password = process.env.ST_PASSWORD || '';
  const sample = !/^n/i.test(process.env.ST_SAMPLE || 'y');
  if (!email.includes('@')) throw new Error('ST_EMAIL is required.');
  if (password.length < 8) throw new Error('ST_PASSWORD must be at least 8 characters.');

  const hash = await bcrypt.hash(password, 12);
  const created = await withTransaction(async conn => {
    const [rows] = await conn.query('SELECT id FROM users WHERE email = ? FOR UPDATE', [email]);
    if (rows[0]) {
      await conn.query('UPDATE users SET name = ?, password_hash = ? WHERE id = ?', [name, hash, rows[0].id]);
      await conn.query('DELETE FROM sessions WHERE user_id = ?', [rows[0].id]);
      return false;
    }
    const [r] = await conn.query('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)', [email, name, hash]);
    await insertDefaultBudgets(conn, r.insertId);
    if (sample) await insertSampleData(conn, r.insertId);
    return true;
  });
  console.log(created ? `  ✓ created ${email}${sample ? ' with sample data' : ''}` : `  ✓ ${email} already existed; password updated`);
  await getPool().end();
}

main().catch(err => { console.error('  ✗', err.message); process.exit(1); });

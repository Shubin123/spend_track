#!/usr/bin/env node
'use strict';
// Applies migrations/NNN_*.sql in order, once each. Safe to re-run.
// To change the schema, add a new numbered file; never edit an applied one.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('../server/config');
const { connectionOptions, mysql } = require('../server/db');

const DIR = path.join(__dirname, '..', 'migrations');

async function main() {
  if (!/^[A-Za-z0-9_]+$/.test(db.database)) throw new Error(`Invalid DB_NAME "${db.database}"`);
  const conn = await mysql.createConnection(connectionOptions({ withDatabase: false, multipleStatements: true }));
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await conn.changeUser({ database: db.database });
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);

    const [rows] = await conn.query('SELECT name, checksum FROM schema_migrations');
    const applied = new Map(rows.map(r => [r.name, r.checksum]));
    const files = fs.readdirSync(DIR).filter(f => /^\d+_.+\.sql$/.test(f)).sort();

    let ran = 0;
    for (const file of files) {
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      const sum = crypto.createHash('sha256').update(sql).digest('hex');
      if (applied.has(file)) {
        if (applied.get(file) !== sum) throw new Error(`${file} was modified after it was applied. Add a new migration instead.`);
        continue;
      }
      console.log(`[migrate] applying ${file}`);
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [file, sum]);
      ran++;
    }
    console.log(ran ? `[migrate] applied ${ran} migration(s) to ${db.database}` : `[migrate] ${db.database} is up to date`);
  } finally {
    await conn.end();
  }
}

main().catch(err => { console.error('[migrate] failed:', err.message); process.exit(1); });

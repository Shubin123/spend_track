#!/usr/bin/env node
'use strict';
// Creates (or rotates) two least-privilege MySQL accounts and points the
// config file at them, so the app no longer runs as the RDS master user:
//
//   spend_track_app       SELECT/INSERT/UPDATE/DELETE on DB_NAME.*  (DB_USER, used by the server)
//   spend_track_migrator  all privileges on DB_NAME.* only          (DB_MIGRATE_USER, used by migrate.js)
//
// Connects with DB_ADMIN_USER/DB_ADMIN_PASSWORD if set, otherwise with the
// current DB_USER/DB_PASSWORD. Passwords are random and never printed.
// Re-running rotates both passwords.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ENV_FILE, db } = require('../server/config');
const { connectionOptions, mysql } = require('../server/db');

const APP_USER = process.env.ST_APP_USER || 'spend_track_app';
const MIGRATE_USER = process.env.ST_MIGRATE_USER || 'spend_track_migrator';
const HOST = '%'; // network access is restricted by the RDS security group

const newPassword = () => crypto.randomBytes(32).toString('base64url');

// Replace or append KEY='value' lines, keeping everything else in the file.
function updateEnvFile(file, values) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  const pending = new Map(Object.entries(values));
  const out = lines.map(line => {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
    if (!key || !pending.has(key)) return line;
    const v = pending.get(key);
    pending.delete(key);
    return `${key}='${v}'`;
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of pending) out.push(`${k}='${v}'`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, out.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function main() {
  if (!/^[A-Za-z0-9_]+$/.test(db.database)) throw new Error(`Invalid DB_NAME "${db.database}"`);
  const admin = {
    user: process.env.DB_ADMIN_USER || db.user,
    password: process.env.DB_ADMIN_PASSWORD || db.password,
  };
  if (admin.user === APP_USER || admin.user === MIGRATE_USER) {
    throw new Error('Already using the restricted accounts. To rotate, run with DB_ADMIN_USER and DB_ADMIN_PASSWORD set to the RDS master credentials.');
  }

  const appPw = newPassword();
  const migPw = newPassword();
  const conn = await mysql.createConnection(connectionOptions({ withDatabase: false, ...admin }));
  try {
    for (const [user, pw] of [[APP_USER, appPw], [MIGRATE_USER, migPw]]) {
      await conn.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ? REQUIRE SSL', [user, HOST, pw]);
      await conn.query('ALTER USER ?@? IDENTIFIED BY ? REQUIRE SSL', [user, HOST, pw]);
    }
    await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${db.database}\`.* TO ?@?`, [APP_USER, HOST]);
    await conn.query(`GRANT ALL PRIVILEGES ON \`${db.database}\`.* TO ?@?`, [MIGRATE_USER, HOST]);
  } finally {
    await conn.end();
  }

  // Verify both logins before touching the config.
  for (const [user, password] of [[APP_USER, appPw], [MIGRATE_USER, migPw]]) {
    const c = await mysql.createConnection(connectionOptions({ withDatabase: false, user, password }));
    await c.end();
  }

  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true, mode: 0o700 });
  updateEnvFile(ENV_FILE, {
    DB_USER: APP_USER,
    DB_PASSWORD: appPw,
    DB_MIGRATE_USER: MIGRATE_USER,
    DB_MIGRATE_PASSWORD: migPw,
  });
  console.log(`  ✓ ${APP_USER} (read/write data) and ${MIGRATE_USER} (schema) ready on ${db.database}`);
  console.log(`  ✓ updated ${ENV_FILE}; the master password is no longer stored there`);
}

main().catch(err => { console.error('  ✗', err.message); process.exit(1); });

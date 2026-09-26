'use strict';
const fs = require('fs');
const mysql = require('mysql2/promise');
const { db } = require('./config');

function connectionOptions({ withDatabase = true, multipleStatements = false, user = db.user, password = db.password } = {}) {
  let ssl;
  if (db.ssl !== 'off') {
    if (!db.sslCa || !fs.existsSync(db.sslCa)) {
      console.error(`[db] DB_SSL_CA not found (${db.sslCa || 'unset'}). Run "npm run setup" to download the RDS CA bundle, or set DB_SSL=off for a local database.`);
      process.exit(1);
    }
    ssl = { ca: fs.readFileSync(db.sslCa), rejectUnauthorized: true };
  }
  return {
    host: db.host,
    port: db.port,
    user,
    password,
    database: withDatabase ? db.database : undefined,
    ssl,
    multipleStatements,
    dateStrings: ['DATE'],  // keep tx_date as 'YYYY-MM-DD'
    decimalNumbers: true,   // DECIMAL -> JS number
    timezone: 'Z',
    charset: 'utf8mb4',
  };
}

let pool;
function getPool() {
  if (!pool) pool = mysql.createPool({ ...connectionOptions(), connectionLimit: 10, waitForConnections: true });
  return pool;
}

// Run fn(conn) inside a transaction; commits on success, rolls back on throw.
// InnoDB can pick this transaction as a deadlock victim when other users write at the
// same time; MySQL's advice is to retry, so fn may run more than once and must not have
// side effects outside the database.
async function withTransaction(fn, { retries = 4, isolation } = {}) {
  for (let attempt = 0; ; attempt++) {
    const conn = await getPool().getConnection();
    try {
      if (isolation) await conn.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`); // next transaction only
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      if (err.code !== 'ER_LOCK_DEADLOCK' || attempt >= retries) throw err;
    } finally {
      conn.release();
    }
    await new Promise(r => setTimeout(r, 10 + Math.random() * 40 * (attempt + 1)));
  }
}

module.exports = { connectionOptions, getPool, withTransaction, mysql };

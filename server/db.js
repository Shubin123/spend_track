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

const SQL_MODE = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

let pool;
function getPool() {
  // Keep-alive detects connections silently dropped by NAT/firewalls between app and DB.
  if (!pool) {
    pool = mysql.createPool({ ...connectionOptions(), connectionLimit: 10, waitForConnections: true, enableKeepAlive: true, connectTimeout: 10000 });
    // Same SQL semantics on every server: RDS defaults to a lenient sql_mode, stock MySQL
    // to strict. Pin strict so bad data is an error everywhere, never silently truncated.
    pool.pool.on('connection', conn => conn.query(`SET SESSION sql_mode = '${SQL_MODE}'`));
  }
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

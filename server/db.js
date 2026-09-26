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
async function withTransaction(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { connectionOptions, getPool, withTransaction, mysql };

'use strict';
// Deletes the accounts the e2e tests created (all use e2e-*@example.test).
module.exports = async () => {
  if (process.env.E2E_NO_CLEANUP) return;
  const { getPool } = require('../server/db');
  const [r] = await getPool().query("DELETE FROM users WHERE email LIKE 'e2e-%@example.test'");
  await getPool().end();
  if (r.affectedRows) console.log(`[e2e] removed ${r.affectedRows} test account(s)`);
};

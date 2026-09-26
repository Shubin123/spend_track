'use strict';
// Safety net: removes e2e accounts left behind by an interrupted run.
module.exports = async () => {
  if (process.env.E2E_NO_CLEANUP) return;
  const factory = require('../test/support/factory');
  const [r] = await factory.purge('e2e');
  await factory.close();
  if (r.affectedRows) console.log(`[e2e] removed ${r.affectedRows} leftover test account(s)`);
};

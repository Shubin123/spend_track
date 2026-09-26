#!/usr/bin/env node
'use strict';
// Health check for a Spend Track install: config, TLS, DB logins, privileges,
// migrations, server, and the GitHub Pages tunnel. Exits 1 on any failure.
//
//   npm run doctor
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let failed = 0;
const ok = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = m => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const bad = (m, fix) => { failed++; console.log(`  \x1b[31m✗\x1b[0m ${m}${fix ? `\n      → ${fix}` : ''}`); };

async function main() {
  const major = +process.versions.node.split('.')[0];
  major >= 21 ? ok(`node ${process.version}`) : bad(`node ${process.version} is too old`, 'install Node 21+ (see .nvmrc)');

  const config = require('../server/config'); // exits with a clear message if required keys are missing
  const { db, migrate, ENV_FILE } = config;
  if (fs.existsSync(ENV_FILE)) {
    const mode = fs.statSync(ENV_FILE).mode & 0o777;
    mode & 0o077 ? bad(`${ENV_FILE} is mode ${mode.toString(8)}`, `chmod 600 "${ENV_FILE}"`) : ok(`config ${ENV_FILE} (mode 600)`);
  } else ok('config from environment variables');
  if (path.resolve(ENV_FILE).startsWith(path.resolve(__dirname, '..') + path.sep)) bad('config file is inside the repo', 'move it to ~/.config/spend_track/.env');

  if (db.ssl === 'off') warn('DB_SSL=off: database traffic is not encrypted (fine for a local MySQL only)');
  else if (!db.sslCa || !fs.existsSync(db.sslCa)) return bad(`TLS CA bundle missing (${db.sslCa || 'DB_SSL_CA unset'})`, 'npm run setup');
  else ok('TLS CA bundle present; server certificate is verified');

  const { connectionOptions, mysql } = require('../server/db');
  let conn;
  try {
    conn = await mysql.createConnection(connectionOptions());
    ok(`connected to ${db.host}:${db.port}/${db.database} as ${db.user}`);
  } catch (e) {
    return bad(`cannot connect as ${db.user}: ${e.code || e.message}`,
      e.code === 'ETIMEDOUT' ? 'allow your IP in the RDS security group' : 'check DB_HOST/DB_USER/DB_PASSWORD, or re-run npm run setup');
  }
  try {
    const [grants] = await conn.query('SHOW GRANTS');
    const broad = grants.map(r => Object.values(r)[0]).filter(g => / ON \*\.\* /.test(g) && !/^GRANT USAGE /.test(g));
    broad.length ? warn(`${db.user} has server-wide privileges; run node scripts/create-db-users.js for a least-privilege login`)
      : ok(`${db.user} is limited to ${db.database}.*`);

    const files = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(f => /^\d+_.+\.sql$/.test(f));
    const [rows] = await conn.query('SELECT name FROM schema_migrations').catch(() => [[]]);
    const pending = files.filter(f => !rows.some(r => r.name === f));
    pending.length ? bad(`${pending.length} migration(s) not applied: ${pending.join(', ')}`, 'npm run migrate') : ok(`migrations up to date (${files.length})`);
  } finally {
    await conn.end();
  }

  if (migrate.user) {
    try {
      const c = await mysql.createConnection(connectionOptions({ user: migrate.user, password: migrate.password }));
      await c.end();
      ok(`migrator login ${migrate.user} works`);
    } catch (e) { bad(`migrator login ${migrate.user} failed: ${e.code || e.message}`, 'DB_ADMIN_USER=… DB_ADMIN_PASSWORD=… node scripts/create-db-users.js'); }
  }

  // Informational: is the server up, and is the Pages tunnel live?
  const probe = url => fetch(url, { signal: AbortSignal.timeout(5000) }).then(r => r.status).catch(() => 0);
  const local = await probe(`http://localhost:${config.port}/api/auth/me`);
  local === 401 || local === 200 ? ok(`server responding on http://localhost:${config.port}`) : warn(`server not running on port ${config.port} (npm start)`);
  const apiCfg = fs.readFileSync(path.join(__dirname, '..', 'api-config.js'), 'utf8').match(/SPEND_TRACK_API = '([^']*)'/)?.[1];
  if (!apiCfg) warn('api-config.js has no tunnel URL: the GitHub Pages site runs in browser-only mode');
  else {
    const s = await probe(apiCfg + '/api/auth/me');
    s === 401 || s === 200 ? ok(`Pages tunnel live: ${apiCfg}`) : warn(`Pages tunnel ${apiCfg} is down (npm run tunnel -- --publish)`);
  }
  try { execFileSync('cloudflared', ['--version'], { stdio: 'ignore' }); ok('cloudflared installed'); }
  catch { warn('cloudflared not installed (needed for npm run tunnel): brew install cloudflared'); }
}

main()
  .catch(e => bad(e.message))
  .finally(() => {
    console.log(failed ? `\x1b[31m${failed} problem(s) found\x1b[0m` : '\x1b[32mAll checks passed\x1b[0m');
    process.exit(failed ? 1 : 0);
  });

#!/usr/bin/env node
'use strict';
// Smoke test: exercises every API endpoint against a running server, then deletes
// the throwaway account it created.
//
//   npm run smoke                                   # http://localhost:$PORT, cookie auth
//   npm run smoke -- https://x.trycloudflare.com    # through the tunnel
//   npm run smoke -- <url> --origin https://shubin123.github.io   # as the Pages site (bearer token)
//
// Cleanup uses the local DB config; pass --no-cleanup to skip it.
const crypto = require('crypto');

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1] ?? ''; };
const origin = flag('--origin');
const noCleanup = args.includes('--no-cleanup') && args.splice(args.indexOf('--no-cleanup'), 1);
const base = (args[0] || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');

let cookie = '', token = '', failures = 0;
async function call(method, path, body, extra = {}) {
  const headers = { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...extra };
  if (origin) { headers.Origin = origin; if (token) headers.Authorization = 'Bearer ' + token; }
  else if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => null);
  if (data?.token) token = data.token;
  return { status: res.status, data, res };
}
function check(name, ok, detail = '') {
  console.log(`  ${ok ? '\x1b[32m✓' : '\x1b[31m✗'}\x1b[0m ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures++;
}
const expect = async (name, want, p) => { const r = await p; check(name, r.status === want, `expected ${want}, got ${r.status} ${JSON.stringify(r.data)}`); return r; };

async function main() {
  console.log(`Smoke test: ${base}${origin ? ` as ${origin} (bearer token)` : ' (cookie)'}`);
  const email = `smoke-${crypto.randomBytes(5).toString('hex')}@example.test`;
  const password = crypto.randomBytes(12).toString('base64url');
  const tx = { date: new Date().toISOString().slice(0, 10), merchant: 'Smoke Cafe', category: 'dining', type: 'expense', amount: 12.5, note: 'smoke' };

  const page = await fetch(base + '/', { signal: AbortSignal.timeout(20000) });
  check('GET / serves the app', page.ok && (await page.text()).includes('app.js'), `status ${page.status}`);
  if (origin) {
    const pre = await fetch(base + '/api/transactions', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
    check('CORS preflight allows origin', pre.status === 204 && pre.headers.get('access-control-allow-origin') === origin, `status ${pre.status}`);
  }
  await expect('me while signed out → 401', 401, call('GET', '/api/auth/me'));
  const signup = await expect('signup → 201', 201, call('POST', '/api/auth/signup', { name: 'Smoke Test', email, password, sample: true }));
  if (origin) check('signup returns bearer token', !!signup.data?.token);
  await expect('me → 200', 200, call('GET', '/api/auth/me'));
  const data = await expect('load data → 200', 200, call('GET', '/api/data'));
  check('sample data loaded', data.data?.transactions?.length > 0, JSON.stringify(data.data)?.slice(0, 120));
  const created = await expect('create transaction → 201', 201, call('POST', '/api/transactions', tx));
  const id = created.data?.transaction?.id;
  await expect('update transaction → 200', 200, call('PUT', `/api/transactions/${id}`, { ...tx, amount: 15, version: 1 }));
  await expect('stale update → 409', 409, call('PUT', `/api/transactions/${id}`, { ...tx, amount: 1, version: 1 }));
  await expect('invalid transaction → 400', 400, call('POST', '/api/transactions', { ...tx, amount: -5 }));
  await expect('delete transaction → 200', 200, call('DELETE', `/api/transactions/${id}`));
  await expect('delete again → 404', 404, call('DELETE', `/api/transactions/${id}`));
  await expect('set budget → 200', 200, call('PUT', '/api/budgets/dining', { amount: 450 }));
  const after = await call('GET', '/api/data');
  check('budget persisted', after.data?.budgets?.dining === 450, JSON.stringify(after.data?.budgets));
  await expect('reset data → 200', 200, call('POST', '/api/reset', {}));
  await expect('unknown API path → 404', 404, call('GET', '/api/nope'));
  if (!origin) await expect('cross-site write blocked → 403', 403, call('POST', '/api/reset', {}, { Origin: 'https://evil.example' }));
  await expect('sign out → 200', 200, call('POST', '/api/auth/logout', {}));
  await expect('me after sign out → 401', 401, call('GET', '/api/auth/me'));
  cookie = ''; token = '';
  await expect('wrong password → 401', 401, call('POST', '/api/auth/login', { email, password: password + 'x' }));
  await expect('sign in → 200', 200, call('POST', '/api/auth/login', { email, password }));

  if (!noCleanup) {
    const { getPool } = require('../server/db');
    const [r] = await getPool().query('DELETE FROM users WHERE email = ?', [email]);
    await getPool().end();
    check('cleanup: test account deleted', r.affectedRows === 1);
  }
  console.log(failures ? `\x1b[31m${failures} check(s) failed\x1b[0m` : '\x1b[32mAll smoke checks passed\x1b[0m');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error('  ✗', err.message); process.exit(1); });

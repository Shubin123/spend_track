'use strict';
// Integration tests against the configured database (see server/config.js).
// Creates throwaway users and deletes them afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const app = require('../server/index');
const { getPool } = require('../server/db');

let server, base;
const created = [];

before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (created.length) await getPool().query('DELETE FROM users WHERE email IN (?)', [created]);
  await new Promise(r => server.close(r));
  await getPool().end();
});

// Minimal cookie-keeping client.
function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null), setCookie: set };
  };
}

async function signup(sample = false) {
  const c = client();
  const email = `test-${crypto.randomBytes(6).toString('hex')}@example.test`;
  created.push(email);
  const r = await c('POST', '/api/auth/signup', { name: 'Test User', email, password: 'correct horse', sample });
  assert.equal(r.status, 201);
  return { c, email };
}

const tx = (over = {}) => ({ type: 'expense', category: 'dining', merchant: 'Cafe', amount: 12.5, date: '2026-09-10', note: '', ...over });

test('signup sets an HttpOnly session cookie and stores only a bcrypt hash', async () => {
  const { c, email } = await signup();
  const me = await c('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, email);
  const [[row]] = await getPool().query('SELECT password_hash FROM users WHERE email = ?', [email]);
  assert.match(row.password_hash, /^\$2[aby]\$12\$/);
});

test('session cookie flags', async () => {
  const c = client();
  const email = `test-${crypto.randomBytes(6).toString('hex')}@example.test`;
  created.push(email);
  const r = await c('POST', '/api/auth/signup', { name: 'T', email, password: 'correct horse', sample: false });
  assert.match(r.setCookie, /HttpOnly/i);
  assert.match(r.setCookie, /SameSite=Lax/i);
});

test('login rejects wrong password and duplicate signup is 409', async () => {
  const { email } = await signup();
  const c = client();
  assert.equal((await c('POST', '/api/auth/login', { email, password: 'wrong password' })).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { email: email.toUpperCase(), password: 'correct horse' })).status, 200);
  assert.equal((await c('POST', '/api/auth/signup', { name: 'X', email, password: 'correct horse' })).status, 409);
});

test('logout invalidates the session server-side', async () => {
  const { c } = await signup();
  assert.equal((await c('POST', '/api/auth/logout', {})).status, 200);
  assert.equal((await c('GET', '/api/data')).status, 401);
});

test('create, update, and delete persist to MySQL', async () => {
  const { c } = await signup();
  const add = await c('POST', '/api/transactions', tx());
  assert.equal(add.status, 201);
  const t = add.body.transaction;
  assert.equal(t.amount, 12.5);
  assert.equal(t.version, 1);

  const upd = await c('PUT', `/api/transactions/${t.id}`, { ...tx({ merchant: 'Better Cafe', amount: 20.019 }), version: 1 });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.transaction.merchant, 'Better Cafe');
  assert.equal(upd.body.transaction.amount, 20.02);
  assert.equal(upd.body.transaction.version, 2);

  const [[row]] = await getPool().query('SELECT merchant, amount, version FROM transactions WHERE id = ?', [t.id]);
  assert.deepEqual(row, { merchant: 'Better Cafe', amount: 20.02, version: 2 });

  assert.equal((await c('DELETE', `/api/transactions/${t.id}`)).status, 200);
  assert.equal((await c('DELETE', `/api/transactions/${t.id}`)).status, 404);
  const data = await c('GET', '/api/data');
  assert.equal(data.body.transactions.length, 0);
});

test('stale update is rejected with 409 and does not overwrite', async () => {
  const { c } = await signup();
  const t = (await c('POST', '/api/transactions', tx())).body.transaction;
  // Two tabs both read version 1; the first save wins.
  assert.equal((await c('PUT', `/api/transactions/${t.id}`, { ...tx({ merchant: 'Tab A' }), version: 1 })).status, 200);
  const stale = await c('PUT', `/api/transactions/${t.id}`, { ...tx({ merchant: 'Tab B' }), version: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.transaction.merchant, 'Tab A');
  assert.equal(stale.body.transaction.version, 2);
});

test('concurrent updates with the same version: exactly one wins', async () => {
  const { c } = await signup();
  const t = (await c('POST', '/api/transactions', tx())).body.transaction;
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) =>
    c('PUT', `/api/transactions/${t.id}`, { ...tx({ merchant: `Writer ${i}` }), version: 1 })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 4);
});

test('users cannot read or modify each other\'s data', async () => {
  const a = await signup();
  const b = await signup();
  const t = (await a.c('POST', '/api/transactions', tx())).body.transaction;
  assert.equal((await b.c('PUT', `/api/transactions/${t.id}`, { ...tx({ merchant: 'Hacked' }), version: 1 })).status, 404);
  assert.equal((await b.c('DELETE', `/api/transactions/${t.id}`)).status, 404);
  assert.equal((await b.c('GET', '/api/data')).body.transactions.length, 0);
  const [[row]] = await getPool().query('SELECT merchant FROM transactions WHERE id = ?', [t.id]);
  assert.equal(row.merchant, 'Cafe');
});

test('validation rejects bad input', async () => {
  const { c } = await signup();
  for (const bad of [tx({ amount: 0 }), tx({ amount: -5 }), tx({ date: '2026-02-30' }), tx({ category: 'income' }),
    tx({ type: 'income', category: 'dining' }), tx({ merchant: '' }), tx({ merchant: 'x'.repeat(61) }), tx({ category: 'nope' })]) {
    assert.equal((await c('POST', '/api/transactions', bad)).status, 400, JSON.stringify(bad));
  }
});

test('budgets upsert and sample data loads', async () => {
  const { c } = await signup(true);
  const d = await c('GET', '/api/data');
  assert.ok(d.body.transactions.length > 50);
  assert.equal(d.body.budgets.dining, 400);
  assert.equal((await c('PUT', '/api/budgets/dining', { amount: 550 })).status, 200);
  assert.equal((await c('GET', '/api/data')).body.budgets.dining, 550);
  assert.equal((await c('PUT', '/api/budgets/income', { amount: 1 })).status, 400);
});

test('CSRF: non-JSON and cross-origin writes are blocked', async () => {
  const { c } = await signup();
  const form = await fetch(base + '/api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(form.status, 415);
  assert.equal((await c('POST', '/api/transactions', tx(), { Origin: 'https://evil.example' })).status, 403);
});

test('allowlisted origin: CORS preflight, bearer token auth, cookie ignored', async () => {
  const PAGES = 'https://shubin123.github.io';
  const pre = await fetch(base + '/api/transactions', { method: 'OPTIONS', headers: { Origin: PAGES, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), PAGES);
  assert.equal(pre.headers.get('access-control-allow-credentials'), null);
  const evil = await fetch(base + '/api/transactions', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  // Same-origin signup gets no token in the body; the cookie is the credential.
  const { c, email } = await signup();
  const plain = await c('POST', '/api/auth/login', { email, password: 'correct horse' });
  assert.equal(plain.body.token, undefined);

  // Cross-origin: token in the body, used as a bearer; a cookie alone is not accepted.
  const x = client();
  const login = await x('POST', '/api/auth/login', { email, password: 'correct horse' }, { Origin: PAGES });
  assert.equal(login.status, 200);
  assert.match(login.body.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal((await x('GET', '/api/auth/me', undefined, { Origin: PAGES })).status, 401);
  const auth = { Origin: PAGES, Authorization: 'Bearer ' + login.body.token };
  assert.equal((await client()('POST', '/api/transactions', tx(), auth)).status, 201);
  assert.equal((await client()('POST', '/api/auth/logout', {}, auth)).status, 200);
  assert.equal((await client()('GET', '/api/auth/me', undefined, auth)).status, 401);
});

test('server code and config are not served', async () => {
  for (const p of ['/server/config.js', '/package.json', '/.env', '/scripts/setup.sh']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  assert.equal((await fetch(base + '/')).status, 200);
});

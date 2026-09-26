'use strict';
// Transactions: CRUD, validation boundaries, optimistic concurrency, isolation, reset.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const f = require('./support/factory');
const { useServer, signedIn, txBody } = require('./support/http');
const { DEFAULT_BUDGETS } = require('../seed');

const ctx = useServer();
const dbTx = id => f.row('SELECT tx_date AS date, merchant, category, type, amount, note, version FROM transactions WHERE id = ?', [id]);

describe('create', { concurrency: true }, () => {
  it('stores the transaction and returns it in the API shape', async () => {
    const { user, c } = await signedIn(ctx);
    const body = txBody({ merchant: 'Blue Bottle', amount: 4.75, note: 'latte', date: '2026-09-10' });
    const r = await c.post('/api/transactions', body);

    assert.equal(r.status, 201);
    const { id, ...rest } = r.body.transaction;
    assert.match(id, /^\d+$/, 'ids are strings so they survive JSON as BIGINT');
    assert.deepEqual(rest, { ...body, version: 1 });
    assert.deepEqual(await dbTx(id), { ...body, version: 1 });
    assert.equal((await f.row('SELECT user_id FROM transactions WHERE id = ?', [id])).user_id, user.id);
  });

  it('normalises input: trims text, rounds to cents, accepts numeric strings', async () => {
    const { c } = await signedIn(ctx);
    const r = await c.post('/api/transactions', txBody({ merchant: '  Cafe  ', note: ' hi ', amount: '20.019' }));
    assert.equal(r.status, 201);
    assert.equal(r.body.transaction.merchant, 'Cafe');
    assert.equal(r.body.transaction.note, 'hi');
    assert.equal(r.body.transaction.amount, 20.02);
  });

  it('round-trips unicode and SQL metacharacters verbatim', async () => {
    const { c } = await signedIn(ctx);
    for (const merchant of ['Café 🍜 東京', "Robert'); DROP TABLE users;--", '<img src=x onerror=alert(1)>']) {
      const r = await c.post('/api/transactions', txBody({ merchant }));
      assert.equal(r.status, 201, merchant);
      assert.equal((await dbTx(r.body.transaction.id)).merchant, merchant);
    }
  });

  it('accepts the boundary values', async () => {
    const { c } = await signedIn(ctx);
    for (const over of [
      { merchant: 'm'.repeat(60) }, { note: 'n'.repeat(120) }, { amount: 0.01 }, { amount: 9999999999.99 },
      { date: '2028-02-29' }, { date: '1970-01-01' }, { date: '2100-12-31' },
      { type: 'income', category: 'income' },
    ]) {
      assert.equal((await c.post('/api/transactions', txBody(over))).status, 201, JSON.stringify(over));
    }
  });

  const invalid = {
    'unknown type': { type: 'refund' },
    'missing type': { type: undefined },
    'unknown category': { category: 'crypto' },
    'income category on an expense': { category: 'income' },
    'expense category on income': { type: 'income', category: 'dining' },
    'empty merchant': { merchant: '' },
    'whitespace-only merchant': { merchant: '   ' },
    'merchant over 60 chars': { merchant: 'm'.repeat(61) },
    'note over 120 chars': { note: 'n'.repeat(121) },
    'impossible date': { date: '2026-02-30' },
    'non-leap Feb 29': { date: '2026-02-29' },
    'month 13': { date: '2026-13-01' },
    'wrong date format': { date: '09/10/2026' },
    'date before 1970': { date: '1969-12-31' },
    'date after 2100': { date: '2101-01-01' },
    'zero amount': { amount: 0 },
    'negative amount': { amount: -5 },
    'amount that rounds to zero': { amount: 0.004 },
    'non-numeric amount': { amount: 'abc' },
    'amount at 1e10': { amount: 1e10 },
    'missing amount': { amount: null },
  };
  for (const [name, over] of Object.entries(invalid)) {
    it(`rejects ${name} with 400`, async () => {
      const { user, c } = await signedIn(ctx);
      const r = await c.post('/api/transactions', txBody(over));
      assert.equal(r.status, 400);
      assert.ok(r.body.error, 'a human-readable error is returned');
      assert.equal((await f.row('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?', [user.id])).n, 0);
    });
  }
});

describe('read', { concurrency: true }, () => {
  it('lists newest first, ties broken by newest id', async () => {
    const { user, c } = await signedIn(ctx);
    const old = await f.createTx(user.id, { date: '2026-01-05' });
    const a = await f.createTx(user.id, { date: '2026-03-01' });
    const b = await f.createTx(user.id, { date: '2026-03-01' });
    const ids = (await c.get('/api/data')).body.transactions.map(t => t.id);
    assert.deepEqual(ids, [b.id, a.id, old.id]);
  });
});

describe('update', { concurrency: true }, () => {
  it('saves every field and bumps the version', async () => {
    const { user, c } = await signedIn(ctx);
    const t = await f.createTx(user.id);
    const next = txBody({ type: 'income', category: 'income', merchant: 'Payroll', amount: 3000, note: 'Sept', date: '2026-09-01' });
    const r = await c.put(`/api/transactions/${t.id}`, { ...next, version: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.transaction, { id: t.id, ...next, version: 2 });
    assert.deepEqual(await dbTx(t.id), { ...next, version: 2 });
  });

  it('rejects a stale version with 409, returns the current copy, and writes nothing', async () => {
    const { user, c } = await signedIn(ctx);
    const t = await f.createTx(user.id);
    await f.editElsewhere(t.id, { merchant: 'Saved on phone' });

    const r = await c.put(`/api/transactions/${t.id}`, { ...txBody({ merchant: 'Saved on laptop' }), version: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.body.transaction.merchant, 'Saved on phone');
    assert.equal(r.body.transaction.version, 2);
    assert.equal((await dbTx(t.id)).merchant, 'Saved on phone');
  });

  it('lets exactly one of several concurrent writers win', async () => {
    const { user, c } = await signedIn(ctx);
    const t = await f.createTx(user.id);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      c.put(`/api/transactions/${t.id}`, { ...txBody({ merchant: `Writer ${i}` }), version: 1 })));
    const winners = results.filter(r => r.status === 200);
    assert.equal(winners.length, 1);
    assert.equal(results.filter(r => r.status === 409).length, 7);
    const saved = await dbTx(t.id);
    assert.equal(saved.version, 2);
    assert.equal(saved.merchant, winners[0].body.transaction.merchant);
  });

  it('requires a valid version', async () => {
    const { user, c } = await signedIn(ctx);
    const t = await f.createTx(user.id);
    for (const version of [undefined, 0, -1, 1.5, 'abc']) {
      assert.equal((await c.put(`/api/transactions/${t.id}`, { ...txBody(), version })).status, 400, String(version));
    }
    assert.equal((await dbTx(t.id)).version, 1);
  });

  it('validates the body the same way as create', async () => {
    const { user, c } = await signedIn(ctx);
    const t = await f.createTx(user.id);
    assert.equal((await c.put(`/api/transactions/${t.id}`, { ...txBody({ amount: -1 }), version: 1 })).status, 400);
  });

  it('returns 404 for a missing or non-numeric id', async () => {
    const { c } = await signedIn(ctx);
    for (const id of ['999999999999', 'abc', '1%20OR%201=1']) {
      assert.equal((await c.put(`/api/transactions/${id}`, { ...txBody(), version: 1 })).status, 404, id);
    }
  });
});

describe('delete', { concurrency: true }, () => {
  it('removes the row; a second delete is 404', async () => {
    const { user, c } = await signedIn(ctx);
    const t = await f.createTx(user.id);
    assert.equal((await c.del(`/api/transactions/${t.id}`)).status, 200);
    assert.equal(await dbTx(t.id), undefined);
    assert.equal((await c.del(`/api/transactions/${t.id}`)).status, 404);
  });
});

describe('isolation between users', { concurrency: true }, () => {
  it("cannot read, edit, or delete another user's transaction (404, not 403)", async () => {
    const a = await signedIn(ctx);
    const b = await signedIn(ctx);
    const t = await f.createTx(a.user.id, { merchant: 'Private' });

    assert.deepEqual((await b.c.get('/api/data')).body.transactions, []);
    assert.equal((await b.c.put(`/api/transactions/${t.id}`, { ...txBody({ merchant: 'Hacked' }), version: 1 })).status, 404);
    assert.equal((await b.c.del(`/api/transactions/${t.id}`)).status, 404);
    const { id: _id, ...unchanged } = t;
    assert.deepEqual(await dbTx(t.id), unchanged);
  });
});

describe('reset', { concurrency: true }, () => {
  it("clears only this user's transactions and preserves budget limits", async () => {
    const a = await signedIn(ctx);
    const b = await signedIn(ctx);
    await f.createTx(a.user.id, { merchant: 'Mine' });
    await f.createTx(a.user.id, { type: 'income', category: 'income', amount: 1000 });
    await f.createTx(a.user.id, { date: '2099-01-01', merchant: 'Future' });
    const theirs = await f.createTx(b.user.id, { merchant: 'Theirs' });
    await a.c.put('/api/budgets/dining', { amount: 1 });

    assert.equal((await a.c.post('/api/reset')).status, 200);
    const data = (await a.c.get('/api/data')).body;
    assert.deepEqual(data.transactions, []);
    assert.deepEqual(data.budgets, { ...DEFAULT_BUDGETS, dining: 1 });
    assert.ok(await dbTx(theirs.id), "other users' data is untouched");
  });

  it('succeeds while many users reset and write at the same time (deadlocks are retried)', async () => {
    const users = await Promise.all(Array.from({ length: 6 }, () => signedIn(ctx)));
    const results = await Promise.all(users.flatMap(({ c }) => [
      c.post('/api/reset'),
      c.post('/api/transactions', txBody()),
      c.post('/api/reset'),
    ]));
    assert.deepEqual(results.map(r => r.status).filter(s => s >= 500), []);
  });
});

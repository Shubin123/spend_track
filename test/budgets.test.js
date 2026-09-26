'use strict';
// Budgets: defaults, upsert, validation, isolation.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const f = require('./support/factory');
const { useServer, signedIn } = require('./support/http');
const { EXPENSE_CATS, DEFAULT_BUDGETS } = require('../seed');

const ctx = useServer();
const budgets = async c => (await c.get('/api/data')).body.budgets;

describe('budgets', { concurrency: true }, () => {
  it('has a value for every expense category, and 0 where none is set', async () => {
    const { c } = await signedIn(ctx, { budgets: false });
    assert.deepEqual(await budgets(c), Object.fromEntries(EXPENSE_CATS.map(k => [k, 0])));
  });

  it('creates and then updates a budget (upsert), rounding to whole dollars', async () => {
    const { c } = await signedIn(ctx, { budgets: false });
    assert.deepEqual((await c.put('/api/budgets/dining', { amount: 450 })).body, { category: 'dining', amount: 450 });
    assert.equal((await c.put('/api/budgets/dining', { amount: 99.6 })).body.amount, 100);
    assert.equal((await c.put('/api/budgets/dining', { amount: 0 })).status, 200);
    const b = await budgets(c);
    assert.equal(b.dining, 0);
    assert.equal(b.housing, 0, 'other categories are untouched');
  });

  it('sets default budgets with POST /api/budgets/default', async () => {
    const { c } = await signedIn(ctx, { budgets: false });
    assert.deepEqual(await budgets(c), Object.fromEntries(EXPENSE_CATS.map(k => [k, 0])));
    const r = await c.post('/api/budgets/default', {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.budgets, DEFAULT_BUDGETS);
    assert.deepEqual(await budgets(c), DEFAULT_BUDGETS);
  });

  it('batch updates multiple budgets with PUT /api/budgets', async () => {
    const { c } = await signedIn(ctx, { budgets: false });
    const r = await c.put('/api/budgets', { budgets: { dining: 300, groceries: 500 } });
    assert.equal(r.status, 200);
    const b = await budgets(c);
    assert.equal(b.dining, 300);
    assert.equal(b.groceries, 500);
    assert.equal(b.housing, 0);
  });

  const invalid = [
    ['the income category', 'income', 100],
    ['an unknown category', 'crypto', 100],
    ['a negative amount', 'dining', -1],
    ['a non-numeric amount', 'dining', 'lots'],
    ['an amount of 1e10', 'dining', 1e10],
  ];
  for (const [name, cat, amount] of invalid) {
    it(`rejects ${name} with 400 and changes nothing`, async () => {
      const { c } = await signedIn(ctx);
      const r = await c.put(`/api/budgets/${cat}`, { amount });
      assert.equal(r.status, 400);
      assert.ok(r.body.error);
      assert.deepEqual(await budgets(c), DEFAULT_BUDGETS);
    });
  }

  it("never touches another user's budgets", async () => {
    const a = await signedIn(ctx);
    const b = await signedIn(ctx);
    await a.c.put('/api/budgets/travel', { amount: 5000 });
    assert.equal((await budgets(a.c)).travel, 5000);
    assert.deepEqual(await budgets(b.c), DEFAULT_BUDGETS);
  });
});

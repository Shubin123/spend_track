'use strict';
// Browser-only fallback and the mobile layout.
const { test, expect } = require('./support/fixtures');
const { assertCleared } = require('./support/reset');

test('with the API unreachable the site runs in browser-only mode and keeps data locally', async ({ app, page }) => {
  await page.route(/\/api\//, route => route.abort('connectionrefused'));
  await app.open();
  await expect(app.accountPanel).toContainText('Demo mode');
  await expect(app.authScreen).toBeHidden();
  await app.getStarted(); // first visit shows the front page
  await expect(page.locator('#totals')).not.toBeEmpty();

  await app.addTx({ amount: 3.21, merchant: 'Local Only Kiosk' });
  await app.reload();
  await app.nav('transactions');
  await expect(app.row('Local Only Kiosk')).toContainText('$3.21');
});

test('browser-only reset persists an empty account across reloads', async ({ app, page }) => {
  await page.route(/\/api\//, route => route.abort('connectionrefused'));
  await app.open();
  await app.getStarted();
  await app.addTx({ amount: 25, merchant: 'Reset Local Expense' });
  await app.addTx({ amount: 1000, merchant: 'Reset Local Income', type: 'income', category: 'income' });
  const budgets = Object.fromEntries(Object.keys(require('../seed').DEFAULT_BUDGETS).map(cat => [cat, 0]));
  page.once('dialog', d => {
    expect(d.message()).toBe('Reset all financial data? This cannot be undone.');
    d.accept();
  });
  await app.openMenu();
  await page.getByRole('menuitem', { name: 'Reset data', exact: true }).click();
  await expect(app.toast).toHaveText('Financial data reset');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spendtrack.v1')))).toEqual({ txs: [], budgets });
  await assertCleared(app, page);
  await app.reload();
  await assertCleared(app, page);
});

test.describe('mobile @mobile', () => {
  test('tab bar navigation and adding a transaction work on a phone', async ({ signedIn: app, page, account, db }) => {
    await expect(page.locator('.tabbar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();

    await app.nav('budgets');
    await expect(page.locator('#budgetGrid .budget-card').first()).toBeVisible();
    await app.addTx({ amount: 7, merchant: 'Food Truck' });
    await expect(app.txDialog).toBeHidden();
    expect(await db.row('SELECT amount FROM transactions WHERE user_id = ? AND merchant = ?', [account.id, 'Food Truck'])).toEqual({ amount: 7 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no horizontal scrolling').toBeLessThanOrEqual(0);
  });
});

'use strict';
// Dashboard numbers, budgets, reset, and preferences.
const { test, expect } = require('./support/fixtures');
const { DEFAULT_BUDGETS } = require('../seed');

const usd = n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const usd0 = n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const totalBudget = Object.values(DEFAULT_BUDGETS).reduce((a, b) => a + b, 0);

test('period totals are computed from the stored transactions', async ({ signedIn: app, page, account, db }) => {
  await db.createTx(account.id, { amount: 40, category: 'dining' });
  await db.createTx(account.id, { amount: 2.5, category: 'transport' });
  await db.createTx(account.id, { amount: 1000, type: 'income', category: 'income' });
  await app.reload();

  await expect(app.spent).toHaveText(usd(42.5));
  await expect(app.stat('Money in')).toHaveText('+' + usd(1000));
  await expect(app.stat('Net')).toHaveText('+' + usd(957.5));
  await expect(app.stat('Budget left')).toContainText(usd0(totalBudget - 42.5));
  await expect(page.locator('#rankList .rank-row')).toHaveCount(2);
  await expect(page.locator('#rankList .rank-row').first()).toContainText('Dining');
});

test('totals update as soon as a transaction is added', async ({ signedIn: app }) => {
  await expect(app.spent).toHaveText(usd(0));
  await app.addTx({ amount: 19.99, merchant: 'Cinema', category: 'entertainment' });
  await expect(app.spent).toHaveText(usd(19.99));
});

test('budget edits persist and drive the over-budget status', async ({ signedIn: app, page, account, db }) => {
  await db.createTx(account.id, { amount: 55, category: 'dining' });
  await app.reload();
  await app.nav('budgets');
  await expect(app.budgetCard('dining')).toContainText('On track');

  await app.budgetCard('dining').click();
  await page.locator('#bAmount').fill('50');
  await page.locator('#budgetForm').getByRole('button', { name: 'Save' }).click();
  await expect(app.toast).toHaveText('Dining budget set to $50');
  await expect(app.budgetCard('dining')).toContainText('Over');
  await expect(app.budgetCard('dining')).toContainText('$5 over');

  expect((await db.row('SELECT amount FROM budgets WHERE user_id = ? AND category = ?', [account.id, 'dining'])).amount).toBe(50);
  await app.reload();
  await app.nav('budgets');
  await expect(app.budgetCard('dining')).toContainText('of $50');
});

test('reset asks first, and only replaces data when confirmed', async ({ signedIn: app, page, account, db }) => {
  await db.createTx(account.id, { merchant: 'Keep Me' });
  await app.reload();

  page.once('dialog', d => d.dismiss());
  await app.openMenu();
  await page.getByRole('menuitem', { name: 'Reset sample data' }).click();
  await app.nav('transactions');
  await expect(app.row('Keep Me')).toBeVisible();

  page.once('dialog', d => { expect(d.message()).toContain('cannot be undone'); d.accept(); });
  await app.openMenu();
  await page.getByRole('menuitem', { name: 'Reset sample data' }).click();
  await expect(app.toast).toHaveText('Sample data restored');
  await expect(app.row('Keep Me')).toHaveCount(0);
  const { n } = await db.row('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?', [account.id]);
  expect(n).toBeGreaterThan(50);
});

test('theme choice persists across reloads', async ({ signedIn: app, page }) => {
  const html = page.locator('html');
  const initial = await html.getAttribute('data-theme');
  const flipped = initial === 'dark' ? 'light' : 'dark';
  await page.getByRole('button', { name: `Switch to ${flipped} theme` }).click();
  await expect(html).toHaveAttribute('data-theme', flipped);
  await app.reload();
  await expect(html).toHaveAttribute('data-theme', flipped);
});

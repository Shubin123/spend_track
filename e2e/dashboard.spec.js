'use strict';
// Dashboard numbers, budgets, reset, and preferences.
const { test, expect } = require('./support/fixtures');
const { assertCleared } = require('./support/reset');
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

  const before = (await db.row('SELECT amount FROM budgets WHERE user_id = ? AND category = ?', [account.id, 'dining'])).amount;
  const limit = page.getByLabel('Dining monthly limit');

  // Clicking the card edits the limit in place, and nothing is saved until the change is confirmed.
  await app.budgetCard('dining').click();
  await limit.fill('50');
  await limit.press('Enter');
  await expect(page.locator('#confirmDialog')).toContainText('to $50 a month');
  await page.locator('#confirmDialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(limit).toBeVisible();
  expect((await db.row('SELECT amount FROM budgets WHERE user_id = ? AND category = ?', [account.id, 'dining'])).amount).toBe(before);

  await limit.press('Enter');
  await page.getByRole('button', { name: 'Change budget' }).click();
  await expect(app.toast).toHaveText('Dining budget set to $50');
  await expect(app.budgetCard('dining')).toContainText('Over');
  await expect(app.budgetCard('dining')).toContainText('$5 over');

  expect((await db.row('SELECT amount FROM budgets WHERE user_id = ? AND category = ?', [account.id, 'dining'])).amount).toBe(50);
  await app.reload();
  await app.nav('budgets');
  await expect(app.budgetCard('dining')).toContainText('of $50');
});

test('use default budgets populates standard limits and allows setting a budget', async ({ signedIn: app, page, account, db }) => {
  await app.nav('budgets');
  await page.locator('#useDefaultBudgets').click();
  await page.getByRole('button', { name: 'Use defaults' }).click();
  await expect(app.toast).toContainText('Default budgets applied');
  await expect(app.budgetCard('dining')).toContainText('of $400');
  await expect(app.budgetCard('housing')).toContainText('of $2,000');

  // Individual card default shortcut, in the dialog behind the pencil button
  await page.getByRole('button', { name: 'Edit Dining budget' }).click();
  await page.locator('#bAmount').fill('100');
  await expect(page.locator('#bDefaultBtn')).toBeVisible();
  await page.locator('#bDefaultBtn').click();
  await expect(page.locator('#bAmount')).toHaveValue('400');
  await page.locator('#budgetForm').getByRole('button', { name: 'Save' }).click();
  await expect(app.toast).toHaveText('Dining budget set to $400');
});

test('reset asks first, and clears data only when confirmed', async ({ signedIn: app, page, account, db }) => {
  await db.createTx(account.id, { merchant: 'Keep Me' });
  await db.createTx(account.id, { type: 'income', category: 'income', amount: 1000 });
  await app.reload();

  page.once('dialog', d => d.dismiss());
  await app.openMenu();
  await page.getByRole('menuitem', { name: 'Reset data' }).click();
  await app.nav('transactions');
  await expect(app.row('Keep Me')).toBeVisible();

  page.once('dialog', d => { expect(d.message()).toBe('Reset all financial data? This cannot be undone.'); d.accept(); });
  await app.openMenu();
  await page.getByRole('menuitem', { name: 'Reset data' }).click();
  await expect(app.toast).toHaveText('Financial data reset');
  await expect(app.row('Keep Me')).toHaveCount(0);
  const { n } = await db.row('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?', [account.id]);
  expect(n).toBe(0);
  await assertCleared(app, page);
  await app.reload();
  await assertCleared(app, page);
});

test('theme choice persists across reloads', async ({ signedIn: app, page }) => {
  const html = page.locator('html');
  for (const theme of ['Pastel', 'Twilight', 'Honey', 'Pastel']) {
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: theme }).click();
    await expect(html).toHaveAttribute('data-theme', theme.toLowerCase());
  }
  await app.reload();
  await expect(html).toHaveAttribute('data-theme', 'pastel');
  await page.getByRole('button', { name: 'Theme' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Pastel' })).toHaveAttribute('aria-checked', 'true');
});

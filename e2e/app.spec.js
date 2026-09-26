'use strict';
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');

const PASSWORD = 'e2e-' + crypto.randomBytes(9).toString('base64url');
const newEmail = () => `e2e-${crypto.randomBytes(5).toString('hex')}@example.test`;
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time like the app

async function signUp(page, { name = 'Ada Lovelace', email = newEmail(), sample = false } = {}) {
  await page.goto('./');
  await expect(page.locator('#auth')).toBeVisible();
  await page.locator('#authSwitch').click();
  await page.locator('#aName').fill(name);
  await page.locator('#aEmail').fill(email);
  await page.locator('#aPassword').fill(PASSWORD);
  await page.locator('#aSample').setChecked(sample);
  await page.locator('#authSubmit').click();
  await expect(page.locator('#auth')).toBeHidden();
  return email;
}

async function addTx(page, { merchant, amount, category = 'dining', type = 'expense' }) {
  await page.locator('#addBtn').click();
  await page.locator(`#txType button[data-type="${type}"]`).click();
  await page.locator('#fAmount').fill(String(amount));
  await page.locator('#fMerchant').fill(merchant);
  await page.locator('#fCategory').selectOption(category);
  await page.locator('#fDate').fill(today());
  await page.locator('#saveTx').click();
  await expect(page.locator('#txDialog')).not.toBeVisible();
}

const row = (page, merchant) => page.locator('#txGroups .tx', { hasText: merchant });
const goTo = (page, view) => page.locator(`.nav-item[data-view="${view}"]`).click();

test('signs up and lands on the dashboard connected to the API', async ({ page }) => {
  const email = await signUp(page, { sample: true });
  await expect(page.locator('#account')).toContainText('Ada Lovelace');
  await expect(page.locator('#account')).toContainText(email);
  await expect(page.locator('#account')).not.toContainText('Demo mode');
  await expect(page.locator('#kpis')).not.toBeEmpty();
  await expect(page.locator('#recentList .tx').first()).toBeVisible();
});

test('add, edit, delete and undo a transaction; changes survive reload', async ({ page }) => {
  await signUp(page);
  const merchant = 'E2E Bakery ' + crypto.randomBytes(3).toString('hex');
  await addTx(page, { merchant, amount: 12.34 });
  await expect(page.locator('#toast')).toContainText(`Added $12.34 at ${merchant}`);

  await goTo(page, 'transactions');
  await expect(row(page, merchant)).toContainText('12.34');
  await page.reload();
  await goTo(page, 'transactions');
  await expect(row(page, merchant)).toContainText('12.34'); // persisted in MySQL

  await row(page, merchant).click();
  await page.locator('#fAmount').fill('20');
  await page.locator('#saveTx').click();
  await expect(page.locator('#toast')).toContainText('Transaction updated');
  await expect(row(page, merchant)).toContainText('20.00');

  await row(page, merchant).click();
  await page.locator('#deleteTx').click();
  await expect(row(page, merchant)).toHaveCount(0);
  await page.locator('#toast button', { hasText: 'Undo' }).click();
  await expect(row(page, merchant)).toContainText('20.00');

  await page.reload();
  await goTo(page, 'transactions');
  await expect(row(page, merchant)).toHaveCount(1);
});

test('search and type filters narrow the list', async ({ page }) => {
  await signUp(page);
  await addTx(page, { merchant: 'Filter Coffee', amount: 4.5 });
  await addTx(page, { merchant: 'Filter Payroll', amount: 1000, type: 'income', category: 'income' });
  await goTo(page, 'transactions');
  await page.locator('#searchInput').fill('coffee');
  await expect(page.locator('#txGroups .tx')).toHaveCount(1);
  await page.locator('#searchInput').fill('');
  await page.locator('#typeFilter button[data-type="income"]').click();
  await expect(page.locator('#txGroups .tx')).toHaveCount(1);
  await expect(page.locator('#txGroups .tx')).toContainText('Filter Payroll');
});

test('budget edits persist', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'budgets');
  await page.locator('.budget-card[data-cat="dining"]').click();
  await page.locator('#bAmount').fill('777');
  await page.locator('#budgetForm button[type="submit"]').click();
  await expect(page.locator('#toast')).toContainText('budget set to $777');
  await page.reload();
  await goTo(page, 'budgets');
  await expect(page.locator('.budget-card[data-cat="dining"]')).toContainText('$777');
});

test('sign out, wrong password, and sign back in', async ({ page }) => {
  const email = await signUp(page);
  await addTx(page, { merchant: 'Session Check', amount: 9 });
  await page.locator('#logoutBtn').click();
  await expect(page.locator('#auth')).toBeVisible();
  await page.reload();
  await expect(page.locator('#auth')).toBeVisible(); // session really ended

  await page.locator('#aEmail').fill(email);
  await page.locator('#aPassword').fill('not-the-password');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#authError')).toContainText('Incorrect email or password');

  await page.locator('#aPassword').fill(PASSWORD);
  await page.locator('#authSubmit').click();
  await expect(page.locator('#auth')).toBeHidden();
  await goTo(page, 'transactions');
  await expect(row(page, 'Session Check')).toHaveCount(1);
});

test('two users cannot see each other\'s data', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signUp(a, { name: 'User A' });
  await addTx(a, { merchant: 'Private To A', amount: 5 });
  await signUp(b, { name: 'User B' });
  await goTo(b, 'transactions');
  await expect(b.locator('#txSummary')).toBeVisible();
  await expect(row(b, 'Private To A')).toHaveCount(0);
});

test('falls back to browser-only mode when the API is unreachable', async ({ page }) => {
  await page.route(/\/api\//, route => route.abort());
  await page.goto('./');
  await expect(page.locator('#account')).toContainText('Demo mode');
  await expect(page.locator('#auth')).toBeHidden();
  await expect(page.locator('#kpis')).not.toBeEmpty();
});

test('works on a phone-sized screen @mobile', async ({ page }) => {
  await signUp(page, { sample: true });
  await expect(page.locator('#mobileLogout')).toBeVisible();
  await page.locator('.tabbar button[data-view="budgets"]').click();
  await expect(page.locator('#budgetGrid .budget-card').first()).toBeVisible();
});

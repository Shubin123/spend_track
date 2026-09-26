'use strict';
// Browser-only fallback and the mobile layout.
const { test, expect } = require('./support/fixtures');

test('with the API unreachable the site runs in browser-only mode and keeps data locally', async ({ app, page }) => {
  await page.route(/\/api\//, route => route.abort('connectionrefused'));
  await app.open();
  await expect(app.accountPanel).toContainText('Demo mode');
  await expect(app.authScreen).toBeHidden();
  await expect(page.locator('#kpis')).not.toBeEmpty();

  await app.addTx({ amount: 3.21, merchant: 'Local Only Kiosk' });
  await app.reload();
  await app.nav('transactions');
  await expect(app.row('Local Only Kiosk')).toContainText('$3.21');
});

test.describe('mobile @mobile', () => {
  test('tab bar navigation and adding a transaction work on a phone', async ({ signedIn: app, page, account, db }) => {
    await expect(page.locator('.tabbar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await app.nav('budgets');
    await expect(page.locator('#budgetGrid .budget-card').first()).toBeVisible();
    await app.addTx({ amount: 7, merchant: 'Food Truck' });
    await expect(app.txDialog).toBeHidden();
    expect(await db.row('SELECT amount FROM transactions WHERE user_id = ? AND merchant = ?', [account.id, 'Food Truck'])).toEqual({ amount: 7 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no horizontal scrolling').toBeLessThanOrEqual(0);
  });
});

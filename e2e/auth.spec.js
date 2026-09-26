'use strict';
// Accounts through the real UI: sign-up, sign-in, sign-out, session loss.
const { test, expect, factory } = require('./support/fixtures');

test.describe('sign up', () => {
  test('with sample data lands on a populated dashboard', async ({ app, page }) => {
    const email = factory.track(factory.uniqueEmail('e2e'));
    await app.open();
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.locator('#aName').fill('Grace Hopper');
    await page.locator('#aEmail').fill(email);
    await page.locator('#aPassword').fill(factory.PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(app.authScreen).toBeHidden();
    await expect(app.toast).toContainText('Welcome, Grace!');
    await expect(app.accountPanel).toContainText('Grace Hopper');
    await expect(page.locator('#recentList .tx').first()).toBeVisible();
    await factory.cleanup();
  });

  test('without sample data starts empty', async ({ app, page }) => {
    const email = factory.track(factory.uniqueEmail('e2e'));
    await app.open();
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.locator('#aName').fill('Empty Account');
    await page.locator('#aEmail').fill(email);
    await page.locator('#aPassword').fill(factory.PASSWORD);
    await page.getByLabel('Start with sample data').uncheck();
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(app.authScreen).toBeHidden();
    await app.nav('transactions');
    await expect(page.locator('#txGroups')).toContainText('No transactions match');
    await factory.cleanup();
  });

  test('shows server validation errors and keeps the form usable', async ({ app, page, account }) => {
    await app.open();
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.locator('#aName').fill('Dup');
    await page.locator('#aEmail').fill(account.email);
    await page.locator('#aPassword').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(app.authError).toHaveText('Password must be 8–72 characters.');

    await page.locator('#aPassword').fill(factory.PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(app.authError).toHaveText('An account with that email already exists.');
    await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });
});

test.describe('sign in and out', () => {
  test('wrong password is rejected, right password signs in, sign-out ends the session', async ({ app, page, account }) => {
    await app.open();
    await expect(app.authScreen).toBeVisible();

    await app.signIn(account.email, 'not-the-password');
    await expect(app.authError).toHaveText('Incorrect email or password.');
    await expect(app.authScreen).toBeVisible();

    await app.signIn(account.email, account.password);
    await expect(app.authScreen).toBeHidden();
    await expect(app.toast).toContainText('Welcome back, Ada!');
    await expect(app.accountPanel).toContainText(account.email);

    await app.signOut();
    await expect(app.authScreen).toBeVisible();
    await app.reload();
    await expect(app.authScreen).toBeVisible(); // the session is gone server-side, not just hidden
  });

  test('a session revoked elsewhere sends you to sign-in and nothing is saved', async ({ signedIn: app, page, account, db }) => {
    await db.revokeSessions(account.id);
    await app.addTx({ amount: 5, merchant: 'Should Not Save' });

    await expect(app.authScreen).toBeVisible();
    await expect(app.authError).toHaveText('Your session expired. Please sign in again.');
    await expect(app.txDialog).toBeHidden();
    const { n } = await db.row('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?', [account.id]);
    expect(n).toBe(0);

    await app.signIn(account.email, account.password);
    await expect(app.authScreen).toBeHidden();
    await expect(page.locator('#kpis')).not.toBeEmpty();
  });
});

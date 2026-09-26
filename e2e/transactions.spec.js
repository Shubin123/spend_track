'use strict';
// Transactions through the UI, verified against what MySQL actually stored.
const { test, expect, factory } = require('./support/fixtures');

const today = factory.isoDate();
const firstOfLastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString('en-CA'); })();
const stored = (db, userId, merchant) => db.row('SELECT merchant, amount, category, type, tx_date AS date, version FROM transactions WHERE user_id = ? AND merchant = ?', [userId, merchant]);

test('add a transaction: shown immediately, saved to MySQL, survives reload', async ({ signedIn: app, page, account, db }) => {
  await app.addTx({ amount: '12.34', merchant: 'Corner Bakery', category: 'groceries', note: 'bread' });
  await expect(app.txDialog).toBeHidden();
  await expect(app.toast).toHaveText('Added $12.34 at Corner Bakery');
  await expect(page.locator('#recentList')).toContainText('Corner Bakery');

  expect(await stored(db, account.id, 'Corner Bakery')).toEqual({ merchant: 'Corner Bakery', amount: 12.34, category: 'groceries', type: 'expense', date: today, version: 1 });

  await app.reload();
  await app.nav('transactions');
  await expect(app.row('Corner Bakery')).toContainText('−$12.34');
  await expect(app.row('Corner Bakery')).toContainText('Groceries · bread');
});

test('income is recorded with a plus sign', async ({ signedIn: app, account, db }) => {
  await app.addTx({ type: 'income', amount: 2500, merchant: 'Payroll', category: 'income' });
  await app.nav('transactions');
  await expect(app.row('Payroll')).toContainText('+$2,500.00');
  expect((await stored(db, account.id, 'Payroll')).type).toBe('income');
});

test('the "n" shortcut opens the add dialog, but not while typing', async ({ signedIn: app, page }) => {
  await page.keyboard.press('n');
  await expect(app.txDialog).toBeVisible();
  await expect(page.locator('#txDialogTitle')).toHaveText('Add transaction');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await app.nav('transactions');
  await page.locator('#searchInput').fill('n');
  await expect(app.txDialog).toBeHidden();
});

test.describe('with controlled timers', () => {
  test.use({ fakeClock: true });

  test('typing in the dialog is never redirected to another field (regression: deferred autofocus)', async ({ signedIn: app, page }) => {
    await page.clock.pauseAt(new Date(Date.now() + 5000)); // freeze time: timers fire only when we say
    await page.locator('#addBtn').click();
    await page.locator('#fMerchant').click(); // the user moves on before any timer runs
    await page.clock.runFor(1000); // now let any pending focus timer fire
    await page.keyboard.type('Typed Slowly');
    await expect(page.locator('#fMerchant')).toHaveValue('Typed Slowly');
    await expect(page.locator('#fAmount')).toHaveValue('');
  });
});

test('edit, delete, and undo are all persisted', async ({ signedIn: app, page, account, db }) => {
  await db.createTx(account.id, { merchant: 'Gym', amount: 40, category: 'health' });
  await app.reload();
  await app.nav('transactions');

  await app.editTx('Gym', { amount: '45.5', merchant: 'Gym Plus' });
  await expect(app.toast).toHaveText('Transaction updated');
  await expect(app.row('Gym Plus')).toContainText('$45.50');
  expect(await stored(db, account.id, 'Gym Plus')).toMatchObject({ amount: 45.5, version: 2 });

  await app.row('Gym Plus').click();
  await app.txDialog.getByRole('button', { name: 'Delete' }).click();
  await expect(app.row('Gym Plus')).toHaveCount(0);
  await expect(app.toast).toContainText('Deleted Gym Plus');
  expect(await stored(db, account.id, 'Gym Plus')).toBeUndefined();

  await app.toast.getByRole('button', { name: 'Undo' }).click();
  await expect(app.row('Gym Plus')).toContainText('$45.50');
  expect(await stored(db, account.id, 'Gym Plus')).toMatchObject({ amount: 45.5, category: 'health' });
});

test('an edit that conflicts with another device shows the latest copy instead of overwriting', async ({ signedIn: app, page, account, db }) => {
  const tx = await db.createTx(account.id, { merchant: 'Shared Dinner', amount: 60 });
  await app.reload();
  await app.nav('transactions');
  await db.editElsewhere(tx.id, { merchant: 'Shared Dinner (phone)', amount: 75 }); // saved on another device

  await app.editTx('Shared Dinner', { amount: '99' });
  await expect(app.toast).toHaveText('This transaction was changed somewhere else. Showing the latest version.');
  await expect(app.row('Shared Dinner (phone)')).toContainText('$75.00');
  expect(await db.row('SELECT merchant, amount, version FROM transactions WHERE id = ?', [tx.id]))
    .toEqual({ merchant: 'Shared Dinner (phone)', amount: 75, version: 2 });
});

test('a failed save keeps the dialog open, shows the error, and adds nothing', async ({ signedIn: app, page, account, db }) => {
  await page.route(/\/api\/transactions$/, route => route.abort('internetdisconnected'));
  await app.addTx({ amount: 8, merchant: 'Offline Lunch' });
  await expect(app.toast).toHaveText('Network error. Check your connection and try again.');
  await expect(app.txDialog).toBeVisible();
  await expect(page.locator('#recentList')).not.toContainText('Offline Lunch');

  await page.unroute(/\/api\/transactions$/);
  await app.txDialog.getByRole('button', { name: 'Save' }).click(); // retry with the same form
  await expect(app.txDialog).toBeHidden();
  expect(await stored(db, account.id, 'Offline Lunch')).toMatchObject({ amount: 8 });
});

test('search, type, and category filters narrow the list', async ({ signedIn: app, page, account, db }) => {
  await db.createTx(account.id, { merchant: 'Blue Bottle Coffee', category: 'dining', amount: 5 });
  await db.createTx(account.id, { merchant: 'Whole Foods', category: 'groceries', amount: 80 });
  await db.createTx(account.id, { merchant: 'Acme Payroll', type: 'income', category: 'income', amount: 3000 });
  await app.reload();
  await app.nav('transactions');
  await expect(app.txList).toHaveCount(3);

  await page.locator('#searchInput').fill('coffee');
  await expect(app.txList).toHaveCount(1);
  await expect(app.txList).toContainText('Blue Bottle Coffee');
  await page.locator('#searchInput').fill('');

  await page.locator('#typeFilter button[data-type="income"]').click();
  await expect(app.txList).toHaveCount(1);
  await expect(app.txList).toContainText('Acme Payroll');
  await page.locator('#typeFilter button[data-type="all"]').click();

  await page.locator('#catFilter').selectOption('groceries');
  await expect(app.txList).toHaveCount(1);
  await expect(app.txList).toContainText('Whole Foods');
});

test('month navigation shows each month\'s transactions', async ({ signedIn: app, page, account, db }) => {
  test.skip(firstOfLastMonth.slice(0, 7) === today.slice(0, 7), 'date math edge');
  await db.createTx(account.id, { merchant: 'This Month Rent', category: 'housing', amount: 1500 });
  await db.createTx(account.id, { merchant: 'Last Month Rent', category: 'housing', amount: 1400, date: firstOfLastMonth });
  await app.reload();
  await app.nav('transactions');
  await expect(app.row('This Month Rent')).toBeVisible();
  await expect(app.row('Last Month Rent')).toHaveCount(0);

  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(app.row('Last Month Rent')).toBeVisible();
  await expect(app.row('This Month Rent')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(app.row('This Month Rent')).toBeVisible();
});

test('CSV export contains the month\'s transactions, quoted safely', async ({ signedIn: app, page, account, db }) => {
  await db.createTx(account.id, { merchant: 'Say "Cheese" Deli', amount: 9.5, note: 'a, b' });
  await db.createTx(account.id, { merchant: 'Payroll', type: 'income', category: 'income', amount: 1000 });
  await app.reload();
  await app.nav('transactions');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export CSV/ }).click()]);
  expect(download.suggestedFilename()).toBe(`spend-track-${today.slice(0, 7)}.csv`);
  const lines = (await (await download.createReadStream()).toArray()).join('').split('\n');
  expect(lines[0]).toBe('"Date","Merchant","Category","Type","Amount","Note"');
  expect(lines).toContain(`"${today}","Say ""Cheese"" Deli","Dining","expense","9.50","a, b"`);
  expect(lines).toContain(`"${today}","Payroll","Income","income","1000.00",""`);
  expect(lines).toHaveLength(3);
});

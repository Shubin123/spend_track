'use strict';
const { expect } = require('@playwright/test');

async function assertCleared(app, page) {
  for (const period of ['day', 'week', 'month', 'year']) {
    await app.nav('dashboard');
    await page.locator(`[data-period="${period}"]`).click();
    await expect(app.spent).toHaveText('$0.00');
    await expect(app.stat('Money in')).toHaveText('$0.00');
    await expect(app.stat('Net')).toHaveText('$0.00');
    if (period === 'month') await expect(app.stat('Budget left')).toHaveText('$0 of $0');
    await expect(page.locator('#donutChart .donut-path')).toHaveCount(0);
    await expect(page.locator('#donutChart .c-name')).toHaveText('Nothing spent');
    await expect(page.locator('#rankList .rank-row')).toHaveCount(0);
    await app.nav('transactions');
    await expect(app.txList).toHaveCount(0);
    await expect(page.locator('#txSummary dd')).toHaveText(['0', '$0.00', '$0.00']);
  }
  await app.nav('budgets');
  await expect(page.locator('#budgetHero .center b')).toHaveText('0%');
  for (const card of await page.locator('.budget-card').all()) {
    await expect(card.locator('.amounts b')).toHaveText('$0');
    await expect(card.locator('.meter i')).toHaveAttribute('style', /width:0%/);
    await expect(card.locator('.amounts .muted')).toHaveText('of $0');
    await expect(card.locator('.status')).toHaveText('No budget');
    await expect(card.locator('.foot span').last()).toHaveText('0%');
  }
}

module.exports = { assertCleared };

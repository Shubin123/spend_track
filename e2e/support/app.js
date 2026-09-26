'use strict';
// Page object for Spend Track. Locators prefer roles and visible text; ids are used
// where the markup has no accessible name.
const { expect } = require('@playwright/test');

class App {
  constructor(page) {
    this.page = page;
    this.accountPanel = page.locator('#account');
    this.toast = page.locator('#toast');
    this.authScreen = page.locator('#auth');
    this.authError = page.locator('#authError');
    this.txDialog = page.locator('#txDialog');
    this.txList = page.locator('#txGroups .tx');
    this.viewTitle = page.locator('#viewTitle');
  }

  // Both wait until the app has finished booting (session checked, data loaded).
  async open() { await this.page.goto('./'); await this.ready(); }
  async reload() { await this.page.reload(); await this.ready(); }
  ready() { return expect(this.page.locator('html')).toHaveAttribute('data-state', 'ready'); }

  async signOut() { await this.page.locator('#logoutBtn:visible, #mobileLogout:visible').first().click(); }

  // Desktop sidebar or mobile tab bar, whichever is visible.
  async nav(view) {
    await this.page.locator(`.nav-item[data-view="${view}"]:visible, .tabbar button[data-view="${view}"]:visible`).first().click();
    await expect(this.page.locator(`#view-${view}`)).toBeVisible();
  }

  row(merchant) { return this.page.locator('#txGroups .tx', { hasText: merchant }); }
  kpi(label) { return this.page.locator('#kpis .kpi', { has: this.page.locator('.label', { hasText: label }) }).locator('.value'); }
  budgetCard(category) { return this.page.locator(`.budget-card[data-cat="${category}"]`); }

  async fillTx({ type, amount, merchant, category, date, note }) {
    if (type) await this.txDialog.getByRole('button', { name: type === 'income' ? 'Income' : 'Expense', exact: true }).click();
    if (amount !== undefined) await this.page.locator('#fAmount').fill(String(amount));
    if (merchant !== undefined) await this.page.locator('#fMerchant').fill(merchant);
    if (category) await this.page.locator('#fCategory').selectOption(category);
    if (date) await this.page.locator('#fDate').fill(date);
    if (note !== undefined) await this.page.locator('#fNote').fill(note);
  }

  async addTx(tx) {
    await this.page.locator('#addBtn').click();
    await expect(this.txDialog).toBeVisible();
    await this.fillTx({ category: 'dining', ...tx });
    await this.txDialog.getByRole('button', { name: 'Save' }).click();
  }

  async editTx(merchant, changes) {
    await this.row(merchant).click();
    await expect(this.txDialog).toBeVisible();
    await this.fillTx(changes);
    await this.txDialog.getByRole('button', { name: 'Save' }).click();
  }

  async signIn(email, password) {
    await this.page.locator('#aEmail').fill(email);
    await this.page.locator('#aPassword').fill(password);
    await this.page.locator('#authSubmit').click();
  }
}

module.exports = { App };

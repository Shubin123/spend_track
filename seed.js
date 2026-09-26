// Category config and sample-data generator, shared by the browser (window.SpendSeed)
// and the Node server (require('./seed')).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpendSeed = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = {
    housing:       { name: 'Housing',       icon: '🏠', color: '#6b3cf0' },
    groceries:     { name: 'Groceries',     icon: '🛒', color: '#2d6bff' },
    dining:        { name: 'Dining',        icon: '🍜', color: '#d93a9a' },
    transport:     { name: 'Transport',     icon: '🚗', color: '#19a7ce' },
    utilities:     { name: 'Utilities',     icon: '💡', color: '#a48bf7' },
    entertainment: { name: 'Entertainment', icon: '🎬', color: '#f08bc6' },
    shopping:      { name: 'Shopping',      icon: '🛍️', color: '#e8a13a' },
    health:        { name: 'Health',        icon: '💪', color: '#8a86a8' },
    travel:        { name: 'Travel',        icon: '✈️', color: '#b35ad6' },
    income:        { name: 'Income',        icon: '💰', color: '#0b8454' },
  };
  const EXPENSE_CATS = Object.keys(CATEGORIES).filter(k => k !== 'income');
  const DEFAULT_BUDGETS = {
    housing: 2000, groceries: 600, dining: 400, transport: 250, utilities: 300,
    entertainment: 120, shopping: 300, health: 120, travel: 400,
  };

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const daysIn = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const addMonths = (key, n) => { const [y, m] = key.split('-').map(Number); return monthKey(new Date(y, m - 1 + n, 1)); };

  function mulberry32(a) {
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Seven months of realistic transactions ending at `today` (no future dates).
  function generate(today = new Date(), seedValue = 42) {
    const rnd = mulberry32(seedValue);
    const r = (a, b) => a + rnd() * (b - a);
    const ri = (a, b) => Math.floor(r(a, b + 1));
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const TODAY = ymd(today), THIS_MONTH = monthKey(today);
    const txs = [];
    const add = (date, merchant, category, amount, type = 'expense', note = '') => {
      if (date > TODAY) return;
      txs.push({ date, merchant, category, amount: Math.round(amount * 100) / 100, type, note });
    };

    for (let i = 6; i >= 0; i--) {
      const mk = addMonths(THIS_MONTH, -i);
      const dim = daysIn(mk);
      const d = n => `${mk}-${pad(Math.min(n, dim))}`;
      const rd = () => d(ri(1, dim));

      add(d(1), 'Acme Corp Payroll', 'income', 3850, 'income', 'Salary');
      add(d(15), 'Acme Corp Payroll', 'income', 3850, 'income', 'Salary');
      if (rnd() < 0.35) add(rd(), 'Upwork', 'income', r(300, 900), 'income', 'Freelance');

      add(d(1), 'Parkview Apartments', 'housing', 1950, 'expense', 'Rent');
      add(d(5), 'PG&E', 'utilities', r(78, 145));
      add(d(12), 'Comcast Xfinity', 'utilities', 70);
      add(d(20), 'Verizon Wireless', 'utilities', 55);
      add(d(8), 'Netflix', 'entertainment', 15.49);
      add(d(18), 'Spotify', 'entertainment', 11.99);
      add(d(3), 'Equinox', 'health', 49, 'expense', 'Membership');

      for (let k = ri(7, 10); k--;) add(rd(), pick(["Trader Joe's", 'Whole Foods', 'Safeway', 'Costco', 'Berkeley Bowl']), 'groceries', r(22, 150));
      for (let k = ri(12, 17); k--;) add(rd(), pick(['Blue Bottle Coffee', 'Chipotle', 'Sweetgreen', 'Tartine Bakery', 'Kin Khao', 'DoorDash', 'Philz Coffee', 'Nopa']), 'dining', r(6, 72));
      for (let k = ri(5, 9); k--;) add(rd(), pick(['Uber', 'Lyft', 'Shell', 'Clipper Card', 'Chevron']), 'transport', r(9, 58));
      for (let k = ri(1, 3); k--;) add(rd(), pick(['AMC Theatres', 'Steam', 'Ticketmaster', 'Apple TV+']), 'entertainment', r(9, 65));
      for (let k = ri(2, 5); k--;) add(rd(), pick(['Amazon', 'Target', 'Uniqlo', 'Apple Store', 'IKEA']), 'shopping', r(14, 175));
      if (rnd() < 0.6) add(rd(), pick(['CVS Pharmacy', 'Walgreens', 'One Medical']), 'health', r(12, 60));
      if (rnd() < 0.4) {
        add(rd(), pick(['United Airlines', 'Alaska Airlines', 'Delta']), 'travel', r(240, 460), 'expense', 'Flight');
        add(rd(), pick(['Airbnb', 'Marriott', 'Hotel Zetta']), 'travel', r(180, 420));
      }
    }
    return { txs, budgets: { ...DEFAULT_BUDGETS } };
  }

  return { CATEGORIES, EXPENSE_CATS, DEFAULT_BUDGETS, generate };
});

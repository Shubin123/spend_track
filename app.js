(() => {
  'use strict';

  // ---------- Config ----------
  const CATEGORIES = {
    housing:       { name: 'Housing',       icon: '🏠', color: '#6366f1' },
    groceries:     { name: 'Groceries',     icon: '🛒', color: '#10b981' },
    dining:        { name: 'Dining',        icon: '🍜', color: '#f59e0b' },
    transport:     { name: 'Transport',     icon: '🚗', color: '#3b82f6' },
    utilities:     { name: 'Utilities',     icon: '💡', color: '#8b5cf6' },
    entertainment: { name: 'Entertainment', icon: '🎬', color: '#ec4899' },
    shopping:      { name: 'Shopping',      icon: '🛍️', color: '#f97316' },
    health:        { name: 'Health',        icon: '💪', color: '#14b8a6' },
    travel:        { name: 'Travel',        icon: '✈️', color: '#0ea5e9' },
    income:        { name: 'Income',        icon: '💰', color: '#059669' },
  };
  const EXPENSE_CATS = Object.keys(CATEGORIES).filter(k => k !== 'income');
  const DEFAULT_BUDGETS = {
    housing: 2000, groceries: 600, dining: 400, transport: 250, utilities: 300,
    entertainment: 120, shopping: 300, health: 120, travel: 400,
  };
  const STORE_KEY = 'spendtrack.v1';

  // ---------- Utils ----------
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const addMonths = (key, n) => { const [y, m] = key.split('-').map(Number); return monthKey(new Date(y, m - 1 + n, 1)); };
  const daysIn = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const monthName = (key, opts = { month: 'long', year: 'numeric' }) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', opts);
  };
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const money = (n, whole) => (whole ? usd0 : usd).format(n);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const sum = arr => arr.reduce((a, b) => a + b, 0);
  const svgEl = (w, h, inner) => `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;

  const today = new Date();
  const TODAY = ymd(today);
  const THIS_MONTH = monthKey(today);

  // ---------- Demo data ----------
  function mulberry32(a) {
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function seed() {
    const rnd = mulberry32(42);
    const r = (a, b) => a + rnd() * (b - a);
    const ri = (a, b) => Math.floor(r(a, b + 1));
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const txs = [];
    const add = (date, merchant, category, amount, type = 'expense', note = '') => {
      if (date > TODAY) return;
      txs.push({ id: uid(), date, merchant, category, amount: Math.round(amount * 100) / 100, type, note });
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

  // ---------- State ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.txs) && data.budgets) return data;
      }
    } catch (_) { /* storage unavailable */ }
    return seed();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ txs: state.txs, budgets: state.budgets })); } catch (_) {}
  }

  const state = {
    ...load(),
    month: THIS_MONTH,
    view: 'dashboard',
    filter: { q: '', cat: 'all', type: 'all' },
  };

  // ---------- Selectors ----------
  const inMonth = (mk) => state.txs.filter(t => t.date.startsWith(mk));
  const expensesOf = mk => inMonth(mk).filter(t => t.type === 'expense');
  const incomeOf = mk => inMonth(mk).filter(t => t.type === 'income');
  const totalBudget = () => sum(EXPENSE_CATS.map(c => state.budgets[c] || 0));
  const byCategory = mk => {
    const out = {};
    for (const t of expensesOf(mk)) out[t.category] = (out[t.category] || 0) + t.amount;
    return out;
  };
  // Days of the month that have elapsed (full month for past months).
  const elapsedDays = mk => mk === THIS_MONTH ? today.getDate() : (mk < THIS_MONTH ? daysIn(mk) : 0);
  const earliestMonth = () => state.txs.reduce((m, t) => t.date.slice(0, 7) < m ? t.date.slice(0, 7) : m, THIS_MONTH);

  // ---------- Tooltip / toast ----------
  const tip = $('#tooltip');
  function showTip(e, html) {
    tip.innerHTML = html;
    tip.classList.add('show');
    const { innerWidth: W } = window;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY - r.height - 10;
    if (x + r.width > W - 8) x = e.clientX - r.width - 14;
    if (y < 8) y = e.clientY + 16;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  const hideTip = () => tip.classList.remove('show');

  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { action.fn(); el.classList.remove('show'); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
  }

  // ---------- Rendering: shared ----------
  function txRow(t) {
    const c = CATEGORIES[t.category] || CATEGORIES.shopping;
    const sign = t.type === 'income' ? '+' : '−';
    const dateStr = parse(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `<li class="tx" data-id="${t.id}">
      <div class="tx-icon" style="background:${c.color}1f">${c.icon}</div>
      <div class="tx-main"><div class="m">${esc(t.merchant)}</div>
        <div class="c">${c.name}${t.note ? ' · ' + esc(t.note) : ''} · ${dateStr}</div></div>
      <div class="tx-amt ${t.type === 'income' ? 'in' : ''}">${sign}${money(t.amount)}</div>
    </li>`;
  }

  function splitMoney(n) {
    const [whole, cents] = money(n).split('.');
    return `${whole}<span class="cents">.${cents}</span>`;
  }

  function render() {
    $('#monthLabel').textContent = monthName(state.month);
    $('#nextMonth').disabled = state.month >= THIS_MONTH;
    $('#prevMonth').disabled = state.month <= earliestMonth();
    const titles = {
      dashboard: ['Dashboard', 'Your money at a glance'],
      transactions: ['Transactions', 'Every dollar in and out'],
      budgets: ['Budgets', 'Monthly limits by category'],
    };
    const [t, s] = titles[state.view];
    $('#viewTitle').textContent = t;
    $('#viewSubtitle').textContent = s;
    $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + state.view));
    $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    ({ dashboard: renderDashboard, transactions: renderTransactions, budgets: renderBudgets })[state.view]();
  }

  // ---------- Dashboard ----------
  function renderDashboard() {
    const mk = state.month, prev = addMonths(mk, -1);
    const elapsed = elapsedDays(mk);
    const spent = sum(expensesOf(mk).map(t => t.amount));
    const income = sum(incomeOf(mk).map(t => t.amount));
    // Compare against last month at the same point in the month.
    const prevSame = sum(expensesOf(prev).filter(t => parse(t.date).getDate() <= elapsed).map(t => t.amount));
    const delta = prevSame ? (spent - prevSame) / prevSame : 0;
    const net = income - spent;
    const rate = income ? net / income : 0;
    const budget = totalBudget();
    const left = budget - spent;
    const daysLeft = daysIn(mk) - elapsed;
    const usedPct = budget ? spent / budget : 0;

    const deltaPill = prevSame
      ? `<span class="pill ${delta > 0 ? 'neg' : 'pos'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta * 100).toFixed(1)}%</span><span class="sub">vs. same point last month</span>`
      : `<span class="pill neutral">No prior data</span>`;

    $('#kpis').innerHTML = `
      <div class="card kpi"><div class="label">Spent</div><div class="value num">${splitMoney(spent)}</div>${deltaPill}</div>
      <div class="card kpi"><div class="label">Income</div><div class="value num">${splitMoney(income)}</div>
        <span class="pill neutral">${incomeOf(mk).length} deposits</span></div>
      <div class="card kpi"><div class="label">Net saved</div><div class="value num" style="color:${net >= 0 ? 'var(--pos)' : 'var(--neg)'}">${net < 0 ? '−' : ''}${splitMoney(Math.abs(net))}</div>
        <span class="pill ${rate >= 0.2 ? 'pos' : rate >= 0 ? 'neutral' : 'neg'}">${(rate * 100).toFixed(0)}% savings rate</span></div>
      <div class="card kpi"><div class="label">Budget left</div><div class="value num" style="color:${left < 0 ? 'var(--neg)' : 'inherit'}">${left < 0 ? '−' : ''}${splitMoney(Math.abs(left))}</div>
        <span class="sub" style="margin:0">${mk === THIS_MONTH && daysLeft > 0 && left > 0 ? `${money(left / daysLeft, true)}/day for ${daysLeft} days` : `${(usedPct * 100).toFixed(0)}% of ${money(budget, true)} used`}</span>
        <div class="meter ${usedPct > 1 ? 'over' : usedPct > 0.85 ? 'warn' : ''}"><i style="width:${Math.min(usedPct, 1) * 100}%"></i></div></div>`;

    renderPace(mk, prev, budget);
    renderDonut(mk);
    renderBars(mk);
    const recent = inMonth(mk).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
    $('#recentList').innerHTML = recent.length ? recent.map(txRow).join('') : `<div class="empty">No transactions this month</div>`;
  }

  function cumulative(mk, upto) {
    const daily = Array(daysIn(mk) + 1).fill(0);
    for (const t of expensesOf(mk)) daily[parse(t.date).getDate()] += t.amount;
    const out = [0];
    for (let d = 1; d <= upto; d++) out[d] = out[d - 1] + daily[d];
    return out;
  }

  function niceMax(v) {
    if (v <= 0) return 100;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function renderPace(mk, prev, budget) {
    const W = 640, H = 260, L = 52, R = 12, T = 12, B = 28;
    const dim = daysIn(mk);
    const cur = cumulative(mk, elapsedDays(mk));
    const prv = cumulative(prev, daysIn(prev));
    const max = niceMax(Math.max(budget, cur[cur.length - 1] || 0, prv[prv.length - 1] || 0) * 1.05);
    const x = d => L + (d / dim) * (W - L - R);
    const y = v => T + (1 - v / max) * (H - T - B);
    const line = arr => arr.map((v, d) => `${d ? 'L' : 'M'}${x(Math.min(d, dim)).toFixed(1)},${y(v).toFixed(1)}`).join('');

    let grid = '', axis = '';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
      axis += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${money(v, true).replace(',000', 'k')}</text>`;
    }
    [1, 8, 15, 22, dim].forEach(d => { axis += `<text x="${x(d)}" y="${H - 8}" text-anchor="middle">${monthName(mk, { month: 'short' })} ${d}</text>`; });

    const curPath = line(cur);
    const lastD = cur.length - 1;
    const area = cur.length > 1 ? `${curPath}L${x(lastD)},${y(0)}L${x(0)},${y(0)}Z` : '';
    const svg = svgEl(W, H, `
      <defs><linearGradient id="gCur" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="var(--accent)" stop-opacity=".25"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient></defs>
      <g class="grid">${grid}</g><g class="axis">${axis}</g>
      <line x1="${x(0)}" y1="${y(0)}" x2="${x(dim)}" y2="${y(budget)}" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="5 5"/>
      <path d="${line(prv)}" fill="none" stroke="var(--prev)" stroke-width="2"/>
      <path d="${area}" fill="url(#gCur)"/>
      <path d="${curPath}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
      ${lastD > 0 ? `<circle cx="${x(lastD)}" cy="${y(cur[lastD])}" r="4.5" fill="var(--surface)" stroke="var(--accent)" stroke-width="2.5"/>` : ''}
      <line class="hover-line" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-width="1" opacity="0"/>
      <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>`);
    const el = $('#paceChart');
    el.innerHTML = svg;
    const s = el.querySelector('svg'), hl = s.querySelector('.hover-line');
    const hit = s.querySelector('.hit');
    hit.onmousemove = e => {
      const box = s.getBoundingClientRect();
      const px = (e.clientX - box.left) / box.width * W;
      const d = Math.max(1, Math.min(dim, Math.round((px - L) / (W - L - R) * dim)));
      hl.setAttribute('x1', x(d)); hl.setAttribute('x2', x(d)); hl.setAttribute('opacity', '.5');
      const c = cur[d], p = prv[Math.min(d, prv.length - 1)];
      showTip(e, `<div style="opacity:.7;margin-bottom:4px">${monthName(mk, { month: 'short' })} ${d}</div>
        ${c !== undefined ? `<div>This month <b>${money(c)}</b></div>` : ''}
        <div>Last month <b>${money(p)}</b></div><div>Budget pace <b>${money(budget * d / dim)}</b></div>`);
    };
    hit.onmouseleave = () => { hl.setAttribute('opacity', '0'); hideTip(); };
  }

  function renderDonut(mk) {
    const data = byCategory(mk);
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const total = sum(entries.map(e => e[1]));
    const S = 200, cx = 100, cy = 100, r = 86, ir = 60;
    let a0 = -Math.PI / 2, paths = '';
    const arc = (a1, a2) => {
      const large = a2 - a1 > Math.PI ? 1 : 0;
      const p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
      return `M${p(r, a1)}A${r},${r} 0 ${large} 1 ${p(r, a2)}L${p(ir, a2)}A${ir},${ir} 0 ${large} 0 ${p(ir, a1)}Z`;
    };
    for (const [cat, v] of entries) {
      const a1 = a0 + (v / total) * Math.PI * 2 - (entries.length > 1 ? 0.012 : 0);
      paths += `<path class="donut-path" data-cat="${cat}" d="${entries.length === 1 ? arc(a0, a0 + Math.PI * 1.9999) : arc(a0, a1)}" fill="${CATEGORIES[cat].color}"/>`;
      a0 += (v / total) * Math.PI * 2;
    }
    const el = $('#donutChart');
    el.innerHTML = total ? svgEl(S, S, `${paths}
      <text x="100" y="94" text-anchor="middle" fill="var(--muted)" font-size="11">Total spent</text>
      <text x="100" y="116" text-anchor="middle" fill="var(--text)" font-size="20" font-weight="700">${money(total, true)}</text>`)
      : `<div class="empty">No spending</div>`;

    $('#catList').innerHTML = entries.map(([cat, v]) => `<li data-cat="${cat}">
      <span class="dot" style="background:${CATEGORIES[cat].color}"></span><span>${CATEGORIES[cat].name}</span>
      <b class="num">${money(v, true)}</b><span class="pct">${((v / total) * 100).toFixed(0)}%</span></li>`).join('');

    const highlight = cat => {
      el.classList.toggle('dim', !!cat);
      el.querySelectorAll('.donut-path').forEach(p => p.classList.toggle('hl', p.dataset.cat === cat));
      $$('#catList li').forEach(li => li.classList.toggle('hl', li.dataset.cat === cat));
    };
    el.querySelectorAll('.donut-path').forEach(p => {
      p.onmousemove = e => { highlight(p.dataset.cat); showTip(e, `${CATEGORIES[p.dataset.cat].name} <b>${money(data[p.dataset.cat])}</b>`); };
      p.onmouseleave = () => { highlight(null); hideTip(); };
      p.onclick = () => goToCategory(p.dataset.cat);
    });
    $$('#catList li').forEach(li => {
      li.onmouseenter = () => highlight(li.dataset.cat);
      li.onmouseleave = () => highlight(null);
      li.onclick = () => goToCategory(li.dataset.cat);
      li.style.cursor = 'pointer';
    });
  }

  function renderBars(mk) {
    const W = 640, H = 240, L = 52, R = 12, T = 12, B = 28;
    const months = Array.from({ length: 6 }, (_, i) => addMonths(mk, i - 5));
    const rows = months.map(m => ({ m, out: sum(expensesOf(m).map(t => t.amount)), inc: sum(incomeOf(m).map(t => t.amount)) }));
    const max = niceMax(Math.max(...rows.map(r => Math.max(r.out, r.inc)), 1));
    const y = v => T + (1 - v / max) * (H - T - B);
    const slot = (W - L - R) / 6, bw = Math.min(26, slot / 3.2);
    let grid = '', axis = '', bars = '';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
      axis += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${money(v, true).replace(',000', 'k')}</text>`;
    }
    rows.forEach((r, i) => {
      const cx = L + slot * i + slot / 2;
      const sel = r.m === mk;
      axis += `<text x="${cx}" y="${H - 8}" text-anchor="middle" ${sel ? 'font-weight="700" style="fill:var(--text)"' : ''}>${monthName(r.m, { month: 'short' })}</text>`;
      bars += `<g class="bar-g" data-i="${i}" style="cursor:pointer">
        <rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" fill="${sel ? 'var(--accent-soft)' : 'transparent'}" rx="8" opacity=".6"/>
        <rect x="${cx - bw - 2}" y="${y(r.out)}" width="${bw}" height="${Math.max(0, y(0) - y(r.out))}" rx="5" fill="var(--accent)"/>
        <rect x="${cx + 2}" y="${y(r.inc)}" width="${bw}" height="${Math.max(0, y(0) - y(r.inc))}" rx="5" fill="var(--pos)" opacity=".8"/>
      </g>`;
    });
    const el = $('#barChart');
    el.innerHTML = svgEl(W, H, `<g class="grid">${grid}</g><g class="axis">${axis}</g>${bars}`);
    el.querySelectorAll('.bar-g').forEach(g => {
      const r = rows[+g.dataset.i];
      g.onmousemove = e => showTip(e, `<div style="opacity:.7;margin-bottom:4px">${monthName(r.m)}</div>
        <div>Spent <b>${money(r.out)}</b></div><div>Income <b>${money(r.inc)}</b></div>
        <div>Net <b>${money(r.inc - r.out)}</b></div>`);
      g.onmouseleave = hideTip;
      g.onclick = () => { if (r.out || r.inc) { state.month = r.m; render(); } };
    });
  }

  function goToCategory(cat) {
    hideTip();
    state.filter = { q: '', cat, type: 'all' };
    $('#searchInput').value = '';
    state.view = 'transactions';
    render();
  }

  // ---------- Transactions ----------
  function renderTransactions() {
    const { q, cat, type } = state.filter;
    const sel = $('#catFilter');
    sel.innerHTML = `<option value="all">All categories</option>` +
      Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}">${c.icon} ${c.name}</option>`).join('');
    sel.value = cat;
    $$('#typeFilter button').forEach(b => b.classList.toggle('active', b.dataset.type === type));

    const needle = q.trim().toLowerCase();
    const list = inMonth(state.month)
      .filter(t => cat === 'all' || t.category === cat)
      .filter(t => type === 'all' || t.type === type)
      .filter(t => !needle || t.merchant.toLowerCase().includes(needle) || (t.note || '').toLowerCase().includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date) || a.merchant.localeCompare(b.merchant));

    const out = sum(list.filter(t => t.type === 'expense').map(t => t.amount));
    const inc = sum(list.filter(t => t.type === 'income').map(t => t.amount));
    $('#txSummary').innerHTML = `
      <div><span>Transactions</span><b>${list.length}</b></div>
      <div><span>Money out</span><b>${money(out)}</b></div>
      <div><span>Money in</span><b style="color:var(--pos)">${money(inc)}</b></div>
      ${list.length ? `<div><span>Largest</span><b>${money(Math.max(...list.filter(t => t.type === 'expense').map(t => t.amount), 0))}</b></div>` : ''}`;

    if (!list.length) {
      $('#txGroups').innerHTML = `<div class="empty"><div class="big">🔍</div>No transactions match your filters.</div>`;
      return;
    }
    const groups = {};
    for (const t of list) (groups[t.date] ||= []).push(t);
    $('#txGroups').innerHTML = Object.entries(groups).map(([date, txs]) => {
      const net = sum(txs.map(t => t.type === 'income' ? t.amount : -t.amount));
      const label = date === TODAY ? 'Today' : parse(date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      return `<div class="day-head"><span>${label}</span><span class="num">${net >= 0 ? '+' : '−'}${money(Math.abs(net))}</span></div>
        <ul class="tx-list">${txs.map(txRow).join('')}</ul>`;
    }).join('');
  }

  function exportCsv() {
    const rows = [['Date', 'Merchant', 'Category', 'Type', 'Amount', 'Note']];
    inMonth(state.month).sort((a, b) => a.date.localeCompare(b.date))
      .forEach(t => rows.push([t.date, t.merchant, CATEGORIES[t.category].name, t.type, t.amount.toFixed(2), t.note || '']));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `spend-track-${state.month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Exported ${rows.length - 1} transactions`);
  }

  // ---------- Budgets ----------
  function renderBudgets() {
    const mk = state.month;
    const spentBy = byCategory(mk);
    const elapsed = elapsedDays(mk), dim = daysIn(mk);
    const budget = totalBudget();
    const spent = sum(EXPENSE_CATS.map(c => spentBy[c] || 0));
    const pct = budget ? spent / budget : 0;
    const projected = mk === THIS_MONTH && elapsed ? spent / elapsed * dim : spent;
    const circ = 2 * Math.PI * 58;
    const ringColor = pct > 1 ? 'var(--neg)' : pct > 0.85 ? 'var(--warn)' : 'var(--accent)';

    const overCats = EXPENSE_CATS.filter(c => state.budgets[c] && (spentBy[c] || 0) > state.budgets[c]);
    const note = mk === THIS_MONTH
      ? (projected > budget
        ? `⚠️ At this pace you'll spend ${money(projected, true)} — ${money(projected - budget, true)} over budget.`
        : `✨ On track: projected ${money(projected, true)}, leaving ${money(budget - projected, true)} unspent.`)
      : (spent > budget ? `Finished ${money(spent - budget, true)} over budget.` : `Finished ${money(budget - spent, true)} under budget. Nice work!`);

    $('#budgetHero').innerHTML = `
      <div class="ring">
        <svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="58" stroke="var(--surface-2)" stroke-width="14" fill="none"/>
          <circle cx="70" cy="70" r="58" stroke="${ringColor}" stroke-width="14" fill="none" stroke-linecap="round"
            stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - Math.min(pct, 1))}" style="transition:stroke-dashoffset .8s"/></svg>
        <div class="center"><div><b>${(pct * 100).toFixed(0)}%</b><span>of budget</span></div></div>
      </div>
      <div class="hero-stats">
        <div><div class="label">Spent</div><div class="v">${money(spent, true)}</div></div>
        <div><div class="label">Budget</div><div class="v">${money(budget, true)}</div></div>
        <div><div class="label">${mk === THIS_MONTH ? 'Projected' : 'Over-budget categories'}</div>
          <div class="v" style="color:${mk === THIS_MONTH ? (projected > budget ? 'var(--neg)' : 'var(--pos)') : 'inherit'}">${mk === THIS_MONTH ? money(projected, true) : overCats.length}</div></div>
        <div class="hero-note">${note}</div>
      </div>`;

    $('#budgetGrid').innerHTML = EXPENSE_CATS.map(cat => {
      const c = CATEGORIES[cat], b = state.budgets[cat] || 0, s = spentBy[cat] || 0;
      const p = b ? s / b : 0;
      const proj = mk === THIS_MONTH && elapsed ? s / elapsed * dim : s;
      let status;
      if (!b) status = `<span class="pill neutral">No budget</span>`;
      else if (s > b) status = `<span class="pill neg">Over</span>`;
      else if (mk === THIS_MONTH && proj > b * 1.02 && cat !== 'housing') status = `<span class="pill neg" style="background:var(--surface-2);color:var(--warn)">At risk</span>`;
      else status = `<span class="pill pos">On track</span>`;
      return `<div class="card budget-card" data-cat="${cat}">
        <div class="top"><div class="tx-icon" style="background:${c.color}1f">${c.icon}</div><div class="name">${c.name}</div><div class="status">${status}</div></div>
        <div class="amounts"><b>${money(s, true)}</b><span class="muted">of ${money(b, true)}</span></div>
        <div class="meter ${p > 1 ? 'over' : p > 0.85 ? 'warn' : ''}"><i style="width:${Math.min(p, 1) * 100}%;${p <= .85 ? `background:${c.color}` : ''}"></i></div>
        <div class="foot"><span>${b ? (s <= b ? `${money(b - s, true)} left` : `${money(s - b, true)} over`) : 'Tap to set'}</span><span>${b ? (p * 100).toFixed(0) + '%' : ''}</span></div>
      </div>`;
    }).join('');
  }

  // ---------- Dialogs ----------
  const txDialog = $('#txDialog');
  let editingId = null, formType = 'expense';

  function setFormType(type) {
    formType = type;
    $$('#txType button').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    const cats = type === 'income' ? ['income'] : EXPENSE_CATS;
    const cur = $('#fCategory').value;
    $('#fCategory').innerHTML = cats.map(k => `<option value="${k}">${CATEGORIES[k].icon} ${CATEGORIES[k].name}</option>`).join('');
    if (cats.includes(cur)) $('#fCategory').value = cur;
  }

  function openTx(tx) {
    editingId = tx ? tx.id : null;
    $('#txDialogTitle').textContent = tx ? 'Edit transaction' : 'Add transaction';
    $('#deleteTx').classList.toggle('hidden', !tx);
    setFormType(tx ? tx.type : 'expense');
    $('#fAmount').value = tx ? tx.amount.toFixed(2) : '';
    $('#fMerchant').value = tx ? tx.merchant : '';
    $('#fCategory').value = tx ? tx.category : (state.filter.cat !== 'all' && state.filter.cat !== 'income' ? state.filter.cat : 'dining');
    const defDate = state.month === THIS_MONTH ? TODAY : `${state.month}-${pad(daysIn(state.month))}`;
    $('#fDate').value = tx ? tx.date : defDate;
    $('#fDate').max = TODAY;
    $('#fNote').value = tx ? tx.note || '' : '';
    txDialog.showModal();
    setTimeout(() => $('#fAmount').focus(), 50);
  }

  $('#txForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = parseFloat($('#fAmount').value);
    if (!(amount > 0)) return;
    const data = {
      amount: Math.round(amount * 100) / 100,
      merchant: $('#fMerchant').value.trim(),
      category: $('#fCategory').value,
      date: $('#fDate').value,
      note: $('#fNote').value.trim(),
      type: formType,
    };
    if (editingId) Object.assign(state.txs.find(t => t.id === editingId), data);
    else state.txs.push({ id: uid(), ...data });
    save();
    txDialog.close();
    state.month = data.date.slice(0, 7);
    render();
    toast(editingId ? 'Transaction updated' : `Added ${money(data.amount)} at ${data.merchant}`);
  });
  $('#cancelTx').onclick = () => txDialog.close();
  $('#deleteTx').onclick = () => {
    const idx = state.txs.findIndex(t => t.id === editingId);
    const [removed] = state.txs.splice(idx, 1);
    save(); txDialog.close(); render();
    toast(`Deleted ${removed.merchant}`, { label: 'Undo', fn: () => { state.txs.push(removed); save(); render(); } });
  };
  $$('#txType button').forEach(b => b.onclick = () => setFormType(b.dataset.type));

  const budgetDialog = $('#budgetDialog');
  let editingCat = null;
  $('#budgetGrid').addEventListener('click', e => {
    const card = e.target.closest('.budget-card');
    if (!card) return;
    editingCat = card.dataset.cat;
    $('#bCatName').textContent = CATEGORIES[editingCat].name;
    $('#bAmount').value = state.budgets[editingCat] || 0;
    budgetDialog.showModal();
    setTimeout(() => $('#bAmount').select(), 50);
  });
  $('#budgetForm').addEventListener('submit', e => {
    e.preventDefault();
    state.budgets[editingCat] = Math.max(0, Math.round(+$('#bAmount').value || 0));
    save(); budgetDialog.close(); render();
    toast(`${CATEGORIES[editingCat].name} budget set to ${money(state.budgets[editingCat], true)}`);
  });
  $('#cancelBudget').onclick = () => budgetDialog.close();
  [txDialog, budgetDialog].forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  // ---------- Wiring ----------
  $$('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; render(); window.scrollTo(0, 0); });
  $$('[data-goto]').forEach(b => b.onclick = () => { state.view = b.dataset.goto; render(); });
  $('#prevMonth').onclick = () => { state.month = addMonths(state.month, -1); render(); };
  $('#nextMonth').onclick = () => { if (state.month < THIS_MONTH) { state.month = addMonths(state.month, 1); render(); } };
  $('#addBtn').onclick = () => openTx(null);
  document.addEventListener('click', e => {
    const row = e.target.closest('.tx');
    if (row) openTx(state.txs.find(t => t.id === row.dataset.id));
  });
  $('#searchInput').addEventListener('input', e => { state.filter.q = e.target.value; renderTransactions(); });
  $('#catFilter').addEventListener('change', e => { state.filter.cat = e.target.value; renderTransactions(); });
  $$('#typeFilter button').forEach(b => b.onclick = () => { state.filter.type = b.dataset.type; renderTransactions(); });
  $('#exportCsv').onclick = exportCsv;
  $('#resetData').onclick = () => {
    if (!confirm('Reset to demo data? Your changes will be lost.')) return;
    Object.assign(state, seed(), { month: THIS_MONTH });
    save(); render(); toast('Demo data restored');
  };

  // Theme: explicit choice wins, otherwise follow the OS.
  const root = document.documentElement;
  const applyTheme = t => root.setAttribute('data-theme', t);
  let theme;
  try { theme = localStorage.getItem('spendtrack.theme'); } catch (_) {}
  applyTheme(theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#themeToggle').onclick = () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('spendtrack.theme', next); } catch (_) {}
  };

  document.addEventListener('keydown', e => {
    if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !txDialog.open && !budgetDialog.open && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); openTx(null);
    }
  });

  save();
  render();
})();

(() => {
  'use strict';

  // ---------- Config ----------
  const { CATEGORIES, EXPENSE_CATS } = window.SpendSeed;
  const STORE_KEY = 'spendtrack.v1';
  const LANDING_KEY = 'spendtrack.seenLanding';
  const MAX_REPEATS = 60;

  // ---------- Utils ----------
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const daysIn = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const dayDiff = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const fmtDate = (s, opts) => parse(s).toLocaleDateString('en-US', opts);
  const monthName = (key, opts = { month: 'long', year: 'numeric' }) => fmtDate(`${key}-01`, opts);
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const money = (n, whole) => (whole ? usd0 : usd).format(n);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const sum = arr => arr.reduce((a, b) => a + b, 0);
  const svgEl = (w, h, inner) => `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage unavailable */ } },
  };

  const today = new Date();
  const TODAY = ymd(today);
  const THIS_MONTH = monthKey(today);

  // ---------- Periods ----------
  // A period (day/week/month/year) plus an anchor date inside it defines the range on screen.
  function rangeOf(period, anchor) {
    if (period === 'day') return { start: anchor, end: anchor };
    if (period === 'week') {
      const start = addDays(anchor, -((parse(anchor).getDay() + 6) % 7)); // weeks start on Monday
      return { start, end: addDays(start, 6) };
    }
    if (period === 'month') { const mk = anchor.slice(0, 7); return { start: `${mk}-01`, end: `${mk}-${pad(daysIn(mk))}` }; }
    const y = anchor.slice(0, 4);
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  // Moves `date` by n units, clamping to the end of shorter months (Jan 31 + 1 month = Feb 28).
  function shiftDate(unit, date, n) {
    if (unit === 'day') return addDays(date, n);
    if (unit === 'week') return addDays(date, 7 * n);
    const d = parse(date);
    const first = new Date(d.getFullYear(), d.getMonth() + (unit === 'month' ? n : 12 * n), 1);
    const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return ymd(new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), dim)));
  }
  function rangeLabel(period, r) {
    if (period === 'day') return r.start === TODAY ? 'Today' : fmtDate(r.start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (period === 'week') {
      const a = parse(r.start), b = parse(r.end);
      const endStr = a.getMonth() === b.getMonth() ? b.getDate() : fmtDate(r.end, { month: 'short', day: 'numeric' });
      return `${fmtDate(r.start, { month: 'short', day: 'numeric' })} – ${endStr}, ${b.getFullYear()}`;
    }
    if (period === 'month') return monthName(r.start.slice(0, 7));
    return r.start.slice(0, 4);
  }

  // ---------- Data layer ----------
  // "api": served by the Node server, data lives in MySQL per signed-in user.
  // "local": static hosting (e.g. GitHub Pages), data lives in this browser only.
  let mode = 'local';
  let user = null;

  function localSeed() {
    const s = SpendSeed.generate(today);
    return { txs: s.txs.map(t => ({ id: uid(), ...t })), budgets: s.budgets };
  }
  function loadLocal() {
    try {
      const raw = storage.get(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.txs) && data.budgets) return data;
      }
    } catch (_) { /* corrupt data: start fresh */ }
    return localSeed();
  }
  function saveLocal() {
    if (mode !== 'local') return;
    storage.set(STORE_KEY, JSON.stringify({ txs: state.txs, budgets: state.budgets }));
  }

  // The API is same-origin when the Node server serves the page. On static hosting
  // (GitHub Pages) it's the URL in api-config.js, called with a bearer token, not a cookie.
  const REMOTE_API = String(window.SPEND_TRACK_API || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'spendtrack.token';
  let apiBase = ''; // '' = same origin
  const getToken = () => storage.get(TOKEN_KEY);
  const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (_) {} };

  function apiFetch(base, method, path, body) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    const token = base && getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch((base ? base + '/api/' : 'api/') + path, {
      method, headers, credentials: base ? 'omit' : 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  }

  async function api(method, path, body) {
    let res;
    try {
      res = await apiFetch(apiBase, method, path, body);
    } catch (_) {
      throw Object.assign(new Error('Network error. Check your connection and try again.'), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (data.token) setToken(data.token);
    if (res.status === 401 && apiBase) setToken(null);
    if (res.status === 401 && !path.startsWith('auth/')) showAuth('Your session expired. Log in again to continue.');
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
    return data;
  }

  const state = {
    txs: [],
    budgets: {},
    period: 'month',
    anchor: TODAY,
    view: 'dashboard',
    rankBy: 'category',
    filter: { q: '', cat: 'all', type: 'all' },
  };

  async function loadRemote() {
    const d = await api('GET', 'data');
    state.txs = d.transactions;
    state.budgets = d.budgets;
  }

  // Every mutation hits the server first; local state changes only after it succeeds,
  // so the screen never shows data that wasn't saved.
  const store = {
    async add(data) {
      if (mode === 'api') {
        const { transaction } = await api('POST', 'transactions', data);
        state.txs.push(transaction);
        return transaction;
      }
      const t = { id: uid(), ...data };
      state.txs.push(t);
      saveLocal();
      return t;
    },
    async update(id, data) {
      if (mode === 'api') {
        const cur = state.txs.find(t => t.id === id);
        try {
          const { transaction } = await api('PUT', 'transactions/' + id, { ...data, version: cur.version });
          Object.assign(cur, transaction);
        } catch (e) {
          // 409: someone else saved first; adopt the server's copy. 404: it was deleted elsewhere.
          if (e.status === 409 && e.data.transaction) Object.assign(cur, e.data.transaction);
          if (e.status === 404) state.txs = state.txs.filter(t => t.id !== id);
          throw e;
        }
        return;
      }
      Object.assign(state.txs.find(t => t.id === id), data);
      saveLocal();
    },
    async remove(id) {
      if (mode === 'api') {
        try { await api('DELETE', 'transactions/' + id); }
        catch (e) { if (e.status !== 404) throw e; }
      }
      const removed = state.txs.find(t => t.id === id);
      state.txs = state.txs.filter(t => t.id !== id);
      saveLocal();
      return removed;
    },
    async setBudget(cat, amount) {
      if (mode === 'api') await api('PUT', 'budgets/' + cat, { amount });
      state.budgets[cat] = amount;
      saveLocal();
    },
    async reset() {
      if (mode === 'api') {
        await api('POST', 'reset', {});
        await loadRemote();
      } else {
        Object.assign(state, localSeed());
        saveLocal();
      }
    },
  };

  // ---------- Selectors ----------
  // Entries dated after today are "upcoming": listed, but not counted until their day arrives.
  const posted = t => t.date <= TODAY;
  const inRange = r => state.txs.filter(t => t.date >= r.start && t.date <= r.end);
  const expenses = list => list.filter(t => t.type === 'expense');
  const incomes = list => list.filter(t => t.type === 'income');
  const total = list => sum(list.map(t => t.amount));
  const sumBy = (list, key) => {
    const out = {};
    for (const t of list) out[t[key]] = (out[t[key]] || 0) + t.amount;
    return out;
  };
  const totalBudget = () => sum(EXPENSE_CATS.map(c => state.budgets[c] || 0));
  // Days of the month that have elapsed (full month for past months).
  const elapsedDays = mk => mk === THIS_MONTH ? today.getDate() : (mk < THIS_MONTH ? daysIn(mk) : 0);
  const earliestDate = () => state.txs.reduce((m, t) => t.date < m ? t.date : m, TODAY);
  const latestDate = () => state.txs.reduce((m, t) => t.date > m ? t.date : m, TODAY);
  // Budgets are monthly, so that view always steps by month.
  const curPeriod = () => state.view === 'budgets' ? 'month' : state.period;
  const curRange = () => rangeOf(curPeriod(), state.anchor);

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
    const income = t.type === 'income';
    const detail = [c.name, t.note ? esc(t.note) : '', posted(t) ? '' : fmtDate(t.date, { month: 'short', day: 'numeric', year: 'numeric' })]
      .filter(Boolean).join(', ');
    return `<li><button class="tx${posted(t) ? '' : ' upcoming'}" data-id="${t.id}">
      <i class="dot" style="background:${c.color}"></i>
      <span class="tx-main"><span class="m">${esc(t.merchant)}</span><span class="c">${detail}</span></span>
      <span class="tx-amt ${income ? 'gain' : 'loss'}">${income ? '+' : '−'}${money(t.amount)}</span>
    </button></li>`;
  }

  function splitMoney(n) {
    const [whole, cents] = money(n).split('.');
    return `${whole}<span class="cents">.${cents}</span>`;
  }

  const VIEW_TITLES = { dashboard: 'Overview', transactions: 'History', budgets: 'Budgets' };

  function render() {
    const period = curPeriod(), r = curRange();
    $('#periodLabel').textContent = rangeLabel(period, r);
    $('#prevPeriod').disabled = r.start <= earliestDate();
    $('#nextPeriod').disabled = r.end >= latestDate();
    $('#periodSeg').classList.toggle('hidden', state.view === 'budgets');
    $$('#periodSeg button').forEach(b => {
      const on = b.dataset.period === state.period;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    $('#viewTitle').textContent = VIEW_TITLES[state.view];
    $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + state.view));
    $$('.nav [data-view], .tabbar [data-view]').forEach(b => {
      const on = b.dataset.view === state.view;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    ({ dashboard: renderDashboard, transactions: renderTransactions, budgets: renderBudgets })[state.view]();
  }

  // ---------- Overview ----------
  function renderDashboard() {
    const period = state.period, r = curRange();
    const list = inRange(r);
    const done = list.filter(posted);
    const upcoming = list.filter(t => !posted(t));
    const spent = total(expenses(done)), income = total(incomes(done)), net = income - spent;
    const isCurrent = r.start <= TODAY && TODAY <= r.end;

    // Compare with the previous period, up to the same point when this one is still running.
    const prevR = rangeOf(period, shiftDate(period, r.start, -1));
    const prevCut = isCurrent ? addDays(prevR.start, dayDiff(r.start, TODAY)) : prevR.end;
    const prevSpent = total(expenses(inRange(prevR)).filter(t => t.date <= prevCut && posted(t)));
    let delta = '';
    if (prevSpent && r.start <= TODAY) {
      const d = (spent - prevSpent) / prevSpent;
      const than = !isCurrent ? rangeLabel(period, prevR) : period === 'day' ? 'yesterday' : `at this point last ${period}`;
      delta = `<span class="delta ${d > 0 ? 'loss' : 'gain'}">${Math.abs(d * 100).toFixed(0)}% ${d > 0 ? 'more' : 'less'} than ${than}</span>`;
    }

    const label = isCurrent
      ? { day: 'Spent today', week: 'Spent this week', month: 'Spent this month', year: 'Spent this year' }[period]
      : `Spent ${period === 'day' ? 'on' : period === 'week' ? '' : 'in'} ${rangeLabel(period, r)}`.replace('  ', ' ');

    let budgetStat = '';
    if (period === 'month') {
      const budget = totalBudget(), left = budget - spent, used = budget ? spent / budget : 0;
      budgetStat = `<div><dt>Budget left</dt><dd class="${left < 0 ? 'loss' : ''}">${left < 0 ? '−' : ''}${money(Math.abs(left), true)}
        <small>of ${money(budget, true)}</small></dd>
        <div class="meter ${used > 1 ? 'over' : used > 0.85 ? 'warn' : ''}"><i style="width:${Math.min(used, 1) * 100}%"></i></div></div>`;
    }

    $('#totals').innerHTML = `
      <div class="hero-total">
        <span class="lbl">${label}</span>
        <b class="big">${splitMoney(spent)}</b>
        ${delta}
      </div>
      <dl class="stats">
        <div><dt>Money in</dt><dd class="${income ? 'gain' : ''}">${income ? '+' : ''}${money(income)}</dd></div>
        <div><dt>Net</dt><dd class="${net > 0 ? 'gain' : net < 0 ? 'loss' : ''}">${net > 0 ? '+' : net < 0 ? '−' : ''}${money(Math.abs(net))}</dd></div>
        ${budgetStat}
        ${upcoming.length ? `<div><dt>Upcoming</dt><dd>${upcoming.length}<small>not counted yet</small></dd></div>` : ''}
      </dl>`;

    const byCat = sumBy(expenses(done), 'category');
    renderDonut(byCat);
    renderRanking(expenses(done));
  }

  // Pie + ranking share hover highlighting by category.
  function highlight(cat) {
    $('#donutChart').classList.toggle('dim', !!cat);
    $$('#donutChart .donut-path').forEach(p => p.classList.toggle('hl', p.dataset.cat === cat));
    $$('#rankList .rank-row').forEach(li => li.classList.toggle('hl', !!cat && li.dataset.cat === cat));
  }

  function renderDonut(data) {
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const all = sum(entries.map(e => e[1]));
    const cx = 100, cy = 100, r = 84, ir = 58;
    let a0 = -Math.PI / 2, paths = '';
    const arc = (a1, a2) => {
      const large = a2 - a1 > Math.PI ? 1 : 0;
      const p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
      return `M${p(r, a1)}A${r},${r} 0 ${large} 1 ${p(r, a2)}L${p(ir, a2)}A${ir},${ir} 0 ${large} 0 ${p(ir, a1)}Z`;
    };
    for (const [cat, v] of entries) {
      const a1 = a0 + (v / all) * Math.PI * 2 - (entries.length > 1 ? 0.014 : 0);
      paths += `<path class="donut-path" data-cat="${cat}" d="${entries.length === 1 ? arc(a0, a0 + Math.PI * 1.9999) : arc(a0, a1)}" fill="${CATEGORIES[cat].color}"/>`;
      a0 += (v / all) * Math.PI * 2;
    }
    const el = $('#donutChart');
    el.innerHTML = svgEl(200, 200, `
      <defs><linearGradient id="donutTrack" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="var(--violet)"/><stop offset=".5" stop-color="var(--blue)"/><stop offset="1" stop-color="var(--magenta)"/>
      </linearGradient></defs>
      <circle cx="100" cy="100" r="95" fill="none" stroke="url(#donutTrack)" stroke-width="1.5"/>
      ${all ? paths : `<circle cx="100" cy="100" r="71" fill="none" stroke="var(--sunk)" stroke-width="26"/>`}
      <text class="c-name" x="100" y="94" text-anchor="middle" fill="var(--muted)" font-size="11"></text>
      <text class="c-pct" x="100" y="119" text-anchor="middle" fill="var(--ink)" font-size="24" font-weight="600" letter-spacing="-.5"></text>`);
    // The center names the hovered slice, or the largest one when nothing is hovered.
    const setCenter = cat => {
      el.querySelector('.c-name').textContent = cat ? CATEGORIES[cat].name : 'Nothing spent';
      el.querySelector('.c-pct').textContent = cat ? `${Math.round((data[cat] / all) * 100)}%` : money(0, true);
    };
    setCenter(entries.length ? entries[0][0] : null);
    el.onmouseleave = () => setCenter(entries.length ? entries[0][0] : null);

    el.querySelectorAll('.donut-path').forEach(p => {
      p.onmousemove = e => { highlight(p.dataset.cat); setCenter(p.dataset.cat); showTip(e, `${CATEGORIES[p.dataset.cat].name} <b>${money(data[p.dataset.cat])}</b>`); };
      p.onmouseleave = () => { highlight(null); hideTip(); };
      p.onclick = () => goToHistory({ cat: p.dataset.cat });
    });
  }

  function renderRanking(exp) {
    const byMerchant = state.rankBy === 'merchant';
    const rows = Object.entries(sumBy(exp, byMerchant ? 'merchant' : 'category')).sort((a, b) => b[1] - a[1]).slice(0, 9);
    const all = total(exp), top = rows.length ? rows[0][1] : 0;
    // A merchant takes the color of the category it is most often filed under.
    const catOf = m => {
      const counts = sumBy(exp.filter(t => t.merchant === m).map(t => ({ ...t, amount: 1 })), 'category');
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    };
    $('#rankBy').value = state.rankBy;
    $('#rankList').innerHTML = rows.length ? rows.map(([key, v], i) => {
      const cat = byMerchant ? catOf(key) : key;
      const color = CATEGORIES[cat].color;
      return `<li><button class="rank-row" data-key="${esc(key)}" data-cat="${cat}">
        <span class="rank-n">${i + 1}</span>
        <span class="rank-name"><i class="dot" style="background:${color}"></i><span>${byMerchant ? esc(key) : CATEGORIES[key].name}</span></span>
        <span class="rank-amt">${money(v)}</span>
        <span class="rank-pct">${Math.round((v / all) * 100)}%</span>
        <span class="rank-bar"><i style="width:${(v / top) * 100}%;background:${color}"></i></span>
      </button></li>`;
    }).join('') : `<li class="empty">No spending in this period. Add an entry to start your ranking.</li>`;

    $$('#rankList .rank-row').forEach(row => {
      row.onmouseenter = () => highlight(row.dataset.cat);
      row.onmouseleave = () => highlight(null);
      row.onclick = () => goToHistory(byMerchant ? { q: row.dataset.key } : { cat: row.dataset.key });
    });
  }

  function goToHistory(filter) {
    hideTip();
    state.filter = { q: '', cat: 'all', type: 'all', ...filter };
    $('#searchInput').value = state.filter.q;
    state.view = 'transactions';
    render();
  }

  // ---------- History ----------
  function renderTransactions() {
    const { q, cat, type } = state.filter;
    const r = curRange();
    const sel = $('#catFilter');
    sel.innerHTML = `<option value="all">All categories</option>` +
      Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}">${c.name}</option>`).join('');
    sel.value = cat;
    $$('#typeFilter button').forEach(b => {
      const on = b.dataset.type === type;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });

    const needle = q.trim().toLowerCase();
    const list = inRange(r)
      .filter(t => cat === 'all' || t.category === cat)
      .filter(t => type === 'all' || t.type === type)
      .filter(t => !needle || t.merchant.toLowerCase().includes(needle) || (t.note || '').toLowerCase().includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date) || a.merchant.localeCompare(b.merchant));
    const done = list.filter(posted);
    const upcoming = list.filter(t => !posted(t)).reverse(); // soonest first

    const out = total(expenses(done)), inc = total(incomes(done));
    const largest = Math.max(0, ...expenses(done).map(t => t.amount));
    $('#txSummary').innerHTML = `
      <div><dt>Entries</dt><dd>${done.length}</dd></div>
      <div><dt>Money out</dt><dd class="${out ? 'loss' : ''}">${out ? '−' : ''}${money(out)}</dd></div>
      <div><dt>Money in</dt><dd class="${inc ? 'gain' : ''}">${inc ? '+' : ''}${money(inc)}</dd></div>
      ${largest ? `<div><dt>Largest expense</dt><dd>${money(largest)}</dd></div>` : ''}
      ${upcoming.length ? `<div><dt>Upcoming</dt><dd>${upcoming.length}</dd></div>` : ''}`;

    if (!list.length) {
      const filtered = needle || cat !== 'all' || type !== 'all';
      $('#txGroups').innerHTML = `<div class="empty">${filtered
        ? 'No entries match these filters. Clear the search or pick another category.'
        : `Nothing logged for ${rangeLabel(curPeriod(), r)}. Use Add entry to log spending or income.`}</div>`;
      return;
    }
    const groups = {};
    for (const t of done) (groups[t.date] ||= []).push(t);
    const netOf = txs => {
      const n = sum(txs.map(t => t.type === 'income' ? t.amount : -t.amount));
      return `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
    };
    $('#txGroups').innerHTML =
      (upcoming.length ? `<div class="day-head upcoming"><span>Upcoming</span><span class="num">${netOf(upcoming)}</span></div>
        <ul class="tx-list">${upcoming.map(txRow).join('')}</ul>` : '') +
      Object.entries(groups).map(([date, txs]) => {
        const label = date === TODAY ? 'Today' : fmtDate(date, { weekday: 'long', month: 'short', day: 'numeric' });
        return `<div class="day-head"><span>${label}</span><span class="num">${netOf(txs)}</span></div>
          <ul class="tx-list">${txs.map(txRow).join('')}</ul>`;
      }).join('');
  }

  function exportCsv() {
    const period = curPeriod(), r = curRange();
    const rows = [['Date', 'Merchant', 'Category', 'Type', 'Amount', 'Note']];
    inRange(r).sort((a, b) => a.date.localeCompare(b.date))
      .forEach(t => rows.push([t.date, t.merchant, CATEGORIES[t.category].name, t.type, t.amount.toFixed(2), t.note || '']));
    const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const name = { day: r.start, week: `week-of-${r.start}`, month: r.start.slice(0, 7), year: r.start.slice(0, 4) }[period];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `spend-track-${name}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Exported ${rows.length - 1} entries`);
  }

  // ---------- Budgets ----------
  function renderBudgets() {
    const mk = state.anchor.slice(0, 7);
    const spentBy = sumBy(expenses(inRange(rangeOf('month', state.anchor)).filter(posted)), 'category');
    const elapsed = elapsedDays(mk), dim = daysIn(mk);
    const budget = totalBudget();
    const spent = sum(EXPENSE_CATS.map(c => spentBy[c] || 0));
    const pct = budget ? spent / budget : 0;
    const projected = mk === THIS_MONTH && elapsed ? spent / elapsed * dim : spent;
    const circ = 2 * Math.PI * 58;
    const ringColor = pct > 1 ? 'var(--loss)' : pct > 0.85 ? 'var(--warn)' : 'var(--violet)';

    const overCats = EXPENSE_CATS.filter(c => state.budgets[c] && (spentBy[c] || 0) > state.budgets[c]);
    let note, good;
    if (mk === THIS_MONTH) {
      good = projected <= budget;
      note = good
        ? `On track: projected ${money(projected, true)}, leaving ${money(budget - projected, true)} unspent.`
        : `At this pace you'll spend ${money(projected, true)}, which is ${money(projected - budget, true)} over budget.`;
    } else if (mk > THIS_MONTH) {
      good = true;
      note = 'This month hasn’t started yet.';
    } else {
      good = spent <= budget;
      note = good ? `Finished ${money(budget - spent, true)} under budget.` : `Finished ${money(spent - budget, true)} over budget.`;
    }

    $('#budgetHero').innerHTML = `
      <div class="ring">
        <svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="58" stroke="var(--sunk)" stroke-width="14" fill="none"/>
          <circle cx="70" cy="70" r="58" stroke="${ringColor}" stroke-width="14" fill="none" stroke-linecap="round"
            stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - Math.min(pct, 1))}" style="transition:stroke-dashoffset .8s"/></svg>
        <div class="center"><div><b>${(pct * 100).toFixed(0)}%</b><span>of budget</span></div></div>
      </div>
      <div class="hero-stats">
        <div><div class="label">Spent</div><div class="v">${money(spent, true)}</div></div>
        <div><div class="label">Budget</div><div class="v">${money(budget, true)}</div></div>
        <div><div class="label">${mk === THIS_MONTH ? 'Projected' : 'Categories over'}</div>
          <div class="v ${mk === THIS_MONTH ? (projected > budget ? 'loss' : 'gain') : overCats.length ? 'loss' : ''}">${mk === THIS_MONTH ? money(projected, true) : overCats.length}</div></div>
        <div class="hero-note ${good ? 'gain' : 'loss'}">${note}</div>
      </div>`;

    $('#budgetGrid').innerHTML = EXPENSE_CATS.map(cat => {
      const c = CATEGORIES[cat], b = state.budgets[cat] || 0, s = spentBy[cat] || 0;
      const p = b ? s / b : 0;
      const proj = mk === THIS_MONTH && elapsed ? s / elapsed * dim : s;
      let status;
      if (!b) status = `<span class="status">No budget</span>`;
      else if (s > b) status = `<span class="status loss">Over</span>`;
      else if (mk === THIS_MONTH && proj > b * 1.02 && cat !== 'housing') status = `<span class="status warn">At risk</span>`;
      else status = `<span class="status gain">On track</span>`;
      return `<button class="panel budget-card" data-cat="${cat}" aria-label="Edit ${c.name} budget">
        <div class="top"><i class="dot" style="background:${c.color}"></i><div class="name">${c.name}</div>${status}</div>
        <div class="amounts"><b>${money(s, true)}</b><span class="muted">of ${money(b, true)}</span></div>
        <div class="meter ${p > 1 ? 'over' : p > 0.85 ? 'warn' : ''}"><i style="width:${Math.min(p, 1) * 100}%;${p <= .85 ? `background:${c.color}` : ''}"></i></div>
        <div class="foot"><span>${b ? (s <= b ? `${money(b - s, true)} left` : `${money(s - b, true)} over`) : 'Select to set a limit'}</span><span>${b ? (p * 100).toFixed(0) + '%' : ''}</span></div>
      </button>`;
    }).join('');
  }

  // ---------- Add / edit dialog ----------
  const txDialog = $('#txDialog');
  let editingId = null, formType = 'expense';

  function setFormType(type) {
    formType = type;
    $$('#txType button').forEach(b => {
      const on = b.dataset.type === type;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    const income = type === 'income';
    $('#fMerchantLabel').textContent = income ? 'From' : 'Paid to';
    $('#fMerchant').placeholder = income ? 'e.g. Acme Corp Payroll' : 'e.g. Blue Bottle Coffee';
    const cats = income ? ['income'] : EXPENSE_CATS;
    const cur = $('#fCategory').value;
    $('#fCategory').innerHTML = cats.map(k => `<option value="${k}">${CATEGORIES[k].name}</option>`).join('');
    if (cats.includes(cur)) $('#fCategory').value = cur;
  }

  // Dates for a repeating entry: `count` occurrences, `every` units apart, from `start`.
  // Each date is computed from the start so month-end days don't drift (Jan 31, Feb 28, Mar 31).
  const occurrences = (start, every, unit, count) => Array.from({ length: count }, (_, i) => shiftDate(unit, start, every * i));

  function repeatPlan() {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || lo));
    const every = clamp($('#fEvery').value, 1, 365);
    const count = clamp($('#fReps').value, 2, MAX_REPEATS);
    const unit = $('#fUnit').value, start = $('#fDate').value;
    return { every, count, unit, dates: start ? occurrences(start, every, unit, count) : [] };
  }

  function updateRepeat() {
    const on = !editingId && $('#fRepeat').checked;
    $('#repeatFields').classList.toggle('hidden', !on);
    $('#fDateLabel').textContent = on ? 'Starting date' : 'Date';
    const { every, dates } = repeatPlan();
    [...$('#fUnit').options].forEach(o => { o.textContent = o.value + (every === 1 ? '' : 's'); });
    const amount = parseFloat($('#fAmount').value) || 0;
    const fmt = s => fmtDate(s, { month: 'short', day: 'numeric', year: 'numeric' });
    $('#repeatPreview').textContent = on && dates.length
      ? `${dates.length} entries from ${fmt(dates[0])} to ${fmt(dates[dates.length - 1])}${amount ? `, ${money(amount * dates.length)} in total` : ''}.`
      : '';
    $('#saveTx').textContent = on && dates.length ? `Save ${dates.length} entries` : 'Save';
  }

  function openTx(tx) {
    editingId = tx ? tx.id : null;
    $('#txDialogTitle').textContent = tx ? 'Edit entry' : 'Add entry';
    $('#deleteTx').classList.toggle('hidden', !tx);
    $('#repeatBox').classList.toggle('hidden', !!tx);
    $('#fRepeat').checked = false;
    setFormType(tx ? tx.type : 'expense');
    $('#fAmount').value = tx ? tx.amount.toFixed(2) : '';
    $('#fMerchant').value = tx ? tx.merchant : '';
    $('#fCategory').value = tx ? tx.category : (state.filter.cat !== 'all' && state.filter.cat !== 'income' ? state.filter.cat : 'dining');
    const r = curRange();
    $('#fDate').value = tx ? tx.date : (r.start <= TODAY && TODAY <= r.end ? TODAY : r.start > TODAY ? r.start : r.end);
    $('#fNote').value = tx ? tx.note || '' : '';
    updateRepeat();
    txDialog.showModal();
    // Focus synchronously: a deferred focus can fire after the user (or autofill) has
    // moved to another field and redirect their typing into Amount.
    $('#fAmount').focus();
  }

  $('#txForm').addEventListener('submit', async e => {
    e.preventDefault();
    const amount = parseFloat($('#fAmount').value);
    if (!(amount > 0)) return $('#fAmount').focus();
    if (!$('#fMerchant').value.trim()) return $('#fMerchant').focus();
    if (!$('#fDate').value) return $('#fDate').focus();
    const data = {
      amount: Math.round(amount * 100) / 100,
      merchant: $('#fMerchant').value.trim(),
      category: $('#fCategory').value,
      date: $('#fDate').value,
      note: $('#fNote').value.trim(),
      type: formType,
    };
    const id = editingId, btn = $('#saveTx');
    const repeat = !id && $('#fRepeat').checked;
    const dates = repeat ? repeatPlan().dates : [data.date];
    if (dates[dates.length - 1] > '2100-12-31') return toast('The last repeat falls after 2100. Use fewer repeats.');
    btn.disabled = true;
    let saved = 0;
    try {
      if (id) await store.update(id, data);
      else for (const date of dates) { await store.add({ ...data, date }); saved++; }
      txDialog.close();
      state.anchor = data.date;
      toast(id ? 'Entry updated'
        : repeat ? `Added ${saved} repeating entries for ${data.merchant}`
        : `Added ${money(data.amount)} ${data.type === 'income' ? 'from' : 'at'} ${data.merchant}`);
    } catch (err) {
      if (saved) {
        txDialog.close();
        toast(`Saved ${saved} of ${dates.length} entries. ${err.message}`);
      } else {
        if (err.status === 409 || err.status === 404) txDialog.close();
        if (err.status !== 401) toast(err.message);
      }
    } finally {
      btn.disabled = false;
      render();
    }
  });
  $('#cancelTx').onclick = () => txDialog.close();
  $('#deleteTx').onclick = async () => {
    try {
      const removed = await store.remove(editingId);
      txDialog.close();
      render();
      if (!removed) return;
      const { id: _id, version: _v, ...copy } = removed;
      toast(`Deleted ${removed.merchant}`, { label: 'Undo', fn: async () => {
        try { await store.add(copy); render(); } catch (err) { if (err.status !== 401) toast(err.message); }
      } });
    } catch (err) {
      if (err.status !== 401) toast(err.message);
    }
  };
  $$('#txType button').forEach(b => b.onclick = () => setFormType(b.dataset.type));
  // Amount and count fields accept digits (plus one decimal point where cents are allowed).
  // A type="number" input would also take "e", "+" and "-", and pasted text needs the same cleanup.
  function digitsOnly(el, decimals) {
    const clean = v => {
      v = v.replace(decimals ? /[^\d.]/g : /\D/g, '');
      const dot = v.indexOf('.');
      return dot < 0 ? v : v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, decimals);
    };
    el.addEventListener('input', () => {
      const v = el.value, cleaned = clean(v);
      if (cleaned === v) return;
      const caret = clean(v.slice(0, el.selectionStart)).length;
      el.value = cleaned;
      el.setSelectionRange(caret, caret);
    });
  }
  digitsOnly($('#fAmount'), 2);
  digitsOnly($('#fEvery'), 0);
  digitsOnly($('#fReps'), 0);
  digitsOnly($('#bAmount'), 0);
  ['#fRepeat', '#fEvery', '#fUnit', '#fReps', '#fDate', '#fAmount'].forEach(s => $(s).addEventListener('input', updateRepeat));

  const budgetDialog = $('#budgetDialog');
  let editingCat = null;
  $('#budgetGrid').addEventListener('click', e => {
    const card = e.target.closest('.budget-card');
    if (!card) return;
    editingCat = card.dataset.cat;
    $('#bCatName').textContent = CATEGORIES[editingCat].name;
    $('#bAmount').value = state.budgets[editingCat] || 0;
    budgetDialog.showModal();
    $('#bAmount').select();
  });
  $('#budgetForm').addEventListener('submit', async e => {
    e.preventDefault();
    const cat = editingCat, amount = Math.max(0, Math.round(+$('#bAmount').value || 0));
    try {
      await store.setBudget(cat, amount);
      budgetDialog.close();
      render();
      toast(`${CATEGORIES[cat].name} budget set to ${money(amount, true)}`);
    } catch (err) {
      if (err.status !== 401) toast(err.message);
    }
  });
  $('#cancelBudget').onclick = () => budgetDialog.close();
  [txDialog, budgetDialog].forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  // ---------- Wiring ----------
  $$('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; render(); window.scrollTo(0, 0); });
  $$('#periodSeg button').forEach(b => b.onclick = () => { state.period = b.dataset.period; render(); });
  const step = n => {
    const next = shiftDate(curPeriod(), state.anchor, n);
    const r = rangeOf(curPeriod(), next);
    // Land on today when stepping into the current period, so "day" and "week" stay aligned with it.
    state.anchor = r.start <= TODAY && TODAY <= r.end ? TODAY : next;
    render();
  };
  $('#prevPeriod').onclick = () => step(-1);
  $('#nextPeriod').onclick = () => step(1);
  $('#addBtn').onclick = () => openTx(null);
  $('#rankBy').addEventListener('change', e => { state.rankBy = e.target.value; renderDashboard(); });
  document.addEventListener('click', e => {
    const row = e.target.closest('.tx');
    if (row) openTx(state.txs.find(t => t.id === row.dataset.id));
  });
  $('#searchInput').addEventListener('input', e => { state.filter.q = e.target.value; renderTransactions(); });
  $('#catFilter').addEventListener('change', e => { state.filter.cat = e.target.value; renderTransactions(); });
  $$('#typeFilter button').forEach(b => b.onclick = () => { state.filter.type = b.dataset.type; renderTransactions(); });
  $('#exportCsv').onclick = exportCsv;

  // Account menu
  const menu = $('#accountMenu'), avatarBtn = $('#avatarBtn');
  const setMenu = open => { menu.classList.toggle('hidden', !open); avatarBtn.setAttribute('aria-expanded', open); };
  avatarBtn.onclick = e => { e.stopPropagation(); setMenu(menu.classList.contains('hidden')); };
  document.addEventListener('click', e => { if (!menu.contains(e.target)) setMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.classList.contains('hidden')) { setMenu(false); avatarBtn.focus(); } });

  $('#resetData').onclick = async () => {
    setMenu(false);
    const msg = mode === 'api'
      ? 'Replace all entries in your account with sample data? This cannot be undone.'
      : 'Reset to sample data? Your changes will be lost.';
    if (!confirm(msg)) return;
    try {
      await store.reset();
      state.anchor = TODAY;
      render();
      toast('Sample data restored');
    } catch (err) {
      if (err.status !== 401) toast(err.message);
    }
  };

  // Theme: explicit choice wins, otherwise follow the OS.
  const root = document.documentElement;
  const applyTheme = t => {
    root.setAttribute('data-theme', t);
    $('#themeToggle').setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  };
  applyTheme(storage.get('spendtrack.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#themeToggle').onclick = () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    storage.set('spendtrack.theme', next);
  };

  const overlayOpen = () => !$('#auth').classList.contains('hidden') || !$('#landing').classList.contains('hidden');
  document.addEventListener('keydown', e => {
    if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !overlayOpen() && !txDialog.open && !budgetDialog.open && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); openTx(null);
    }
  });

  // ---------- Front page ----------
  function showLanding() {
    $('#landing').classList.remove('hidden');
  }
  $('#getStarted').onclick = () => {
    $('#landing').classList.add('hidden');
    if (mode === 'api' && !user) return showAuth();
    storage.set(LANDING_KEY, '1');
  };

  // ---------- Log in / create account ----------
  let authMode = 'login';
  function setAuthMode(m) {
    authMode = m;
    const signup = m === 'signup';
    $('#authTitle').textContent = signup ? 'Create your account' : 'Log in';
    $('#authSub').textContent = signup ? 'Your entries sync to every device you log in on.' : 'Welcome back. Log in to see your spending.';
    $('#authSubmit').textContent = signup ? 'Create account' : 'Log in';
    $('#authSwitchText').textContent = signup ? 'Already have an account?' : 'Don’t have an account?';
    $('#authSwitch').textContent = signup ? 'Log in' : 'Create one';
    ['#nameField', '#confirmField', '#sampleField'].forEach(s => $(s).classList.toggle('hidden', !signup));
    $('#aPassword').autocomplete = signup ? 'new-password' : 'current-password';
    $('#authError').classList.add('hidden');
  }
  function showAuth(message) {
    user = null;
    state.txs = [];
    [txDialog, budgetDialog].forEach(d => d.open && d.close());
    setMenu(false);
    renderAccount();
    setAuthMode(authMode);
    if (message) { $('#authError').textContent = message; $('#authError').classList.remove('hidden'); }
    $('#landing').classList.add('hidden');
    $('#auth').classList.remove('hidden');
    $(authMode === 'signup' ? '#aName' : '#aEmail').focus();
  }
  const hideAuth = () => $('#auth').classList.add('hidden');

  function renderAccount() {
    const el = $('#account');
    const signedIn = mode === 'api' && user;
    $('#logoutBtn').classList.toggle('hidden', !signedIn);
    if (signedIn) {
      const initials = user.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      avatarBtn.textContent = initials;
      el.innerHTML = `<b>${esc(user.name)}</b><span>${esc(user.email)}</span>`;
    } else {
      avatarBtn.textContent = '?';
      el.innerHTML = mode === 'local' ? `<b>Demo mode</b><span>Your data stays in this browser</span>` : '';
    }
  }

  $('#authSwitch').onclick = () => {
    setAuthMode(authMode === 'login' ? 'signup' : 'login');
    $(authMode === 'signup' ? '#aName' : '#aEmail').focus();
  };
  $('#authBack').onclick = () => { hideAuth(); showLanding(); };
  $('#authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#authSubmit'), errEl = $('#authError');
    const fail = msg => { errEl.textContent = msg; errEl.classList.remove('hidden'); };
    const body = { email: $('#aEmail').value.trim(), password: $('#aPassword').value };
    if (authMode === 'signup') {
      if (body.password !== $('#aPassword2').value) return fail('Passwords don’t match. Type the same password in both fields.');
      Object.assign(body, { name: $('#aName').value.trim(), sample: $('#aSample').checked });
    }
    errEl.classList.add('hidden');
    btn.disabled = true;
    try {
      const d = await api('POST', 'auth/' + authMode, body);
      user = d.user;
      await loadRemote();
      Object.assign(state, { anchor: TODAY, view: 'dashboard', filter: { q: '', cat: 'all', type: 'all' } });
      $('#aPassword').value = '';
      $('#aPassword2').value = '';
      hideAuth();
      renderAccount();
      render();
      toast(`${authMode === 'signup' ? 'Welcome' : 'Welcome back'}, ${user.name.split(' ')[0]}`);
    } catch (err) {
      fail(err.message);
    } finally {
      btn.disabled = false;
    }
  });
  $('#logoutBtn').onclick = async () => {
    setMenu(false);
    await api('POST', 'auth/logout', {}).catch(() => {});
    setToken(null);
    authMode = 'login';
    showAuth();
  };

  // Returns true if an API answers at `base` ('' = same origin) and switches to it.
  async function probe(base) {
    const res = await apiFetch(base, 'GET', 'auth/me');
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    if (!isJson || !(res.ok || res.status === 401)) return false;
    apiBase = base;
    mode = 'api';
    if (res.ok) {
      user = (await res.json()).user;
      await loadRemote();
    } else if (base) setToken(null);
    return true;
  }

  // Use the API server if one is reachable; otherwise stay in browser-only mode.
  async function boot() {
    let found = await probe('').catch(() => false);
    if (!found && REMOTE_API) {
      found = await probe(REMOTE_API).catch(() => false);
      if (!found) toast('The sync server is offline, so this is browser-only mode.');
    }
    if (mode === 'local') Object.assign(state, loadLocal());
    renderAccount();
    if (mode === 'api' && !user) return showLanding();
    if (mode === 'local' && !storage.get(LANDING_KEY)) showLanding();
    render();
  }

  // data-state="ready" tells tests (and anything else) that boot has finished.
  boot().catch(err => {
    renderAccount();
    render();
    toast(err.message || 'Could not load your data.');
  }).finally(() => { document.documentElement.dataset.state = 'ready'; });
})();

const $ = (id) => document.getElementById(id);
const esc = App.esc;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const state = {
  settings: null,
  view: 'dashboard',
  calMonth: null,
  lastUnread: null,
};

const cur = () => (state.settings ? state.settings.currency : '₹');
const money = (n) => App.money(n, cur());
const SLOT_SHORT = { first: '1st Half', second: '2nd Half', full: 'Full Day' };
const statusPill = (s) => `<span class="pill ${s}">${{ pending: '⏳ Pending', approved: '✅ Approved', cancelled: '✕ Cancelled' }[s]}</span>`;
const payPill = (b) => (b.status === 'approved' ? `<span class="pill ${b.payment_status}">${b.payment_status === 'paid' ? '💳 Paid' : 'Unpaid'}</span>` : '');

// ---------- modal ----------
function modal(title, body, { submitText = 'Save', onSubmit, wide = false } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <form class="modal" style="${wide ? 'max-width:720px' : ''}" novalidate>
      <div class="modal-head"><h3>${title}</h3><button type="button" data-close aria-label="Close">×</button></div>
      <div class="modal-body">${body}</div>
      ${onSubmit ? `<div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary">${submitText}</button></div>` : ''}
    </form>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.hasAttribute('data-close')) close(); });
  const form = bg.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    const btn = form.querySelector('.modal-foot .btn-primary');
    btn.disabled = true;
    try {
      if ((await onSubmit(Object.fromEntries(new FormData(form)), form)) !== false) close();
    } catch (err) {
      App.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  return { el: bg, form, close };
}

// ---------- auth ----------
async function boot() {
  state.settings = await App.settings().catch(() => null);
  document.querySelectorAll('[data-s]').forEach((el) => { el.textContent = state.settings?.[el.dataset.s] || ''; });
  const { admin, demo } = await App.api('api/admin/me');
  state.demo = demo;
  $('demoNote').classList.toggle('hidden', !demo);
  $('pwField').classList.toggle('hidden', demo);
  $('pw').required = !demo;
  $('loginBtn').textContent = demo ? 'Proceed to Admin Dashboard →' : 'Log in';
  $('demoPill').classList.toggle('hidden', !demo);
  $('demoBanner').classList.toggle('hidden', !demo);
  $('login').classList.toggle('hidden', admin);
  $('app').classList.toggle('hidden', !admin);
  if (admin) startApp();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await App.api('api/admin/login', { method: 'POST', body: { password: $('pw').value } });
    $('pw').value = '';
    boot();
  } catch (err) {
    $('loginError').textContent = err.message;
    $('loginError').classList.remove('hidden');
  }
});

$('logout').onclick = async () => {
  await App.api('api/admin/logout', { method: 'POST' });
  location.reload();
};

// Any 401 while using the app sends you back to login.
const _api = App.api;
App.api = async (...args) => {
  try { return await _api(...args); } catch (err) {
    if (err.status === 401 && !String(args[0]).endsWith('/me')) { location.reload(); }
    throw err;
  }
};

// ---------- navigation ----------
const TITLES = {
  dashboard: 'Dashboard', bookings: 'Bookings', calendar: 'Calendar & Free Dates', revenue: 'Revenue',
  banners: 'Banner Management', gallery: 'Gallery', testimonials: 'Testimonials', settings: 'Settings',
};
const LOADERS = {
  dashboard: loadDashboard, bookings: loadBookings, calendar: loadCalendar, revenue: loadRevenue,
  banners: loadBanners, gallery: loadGallery, testimonials: loadTestimonials, settings: loadSettings,
};

function show(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'view-' + view));
  document.querySelectorAll('#sideNav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('viewTitle').textContent = TITLES[view];
  $('sidebar').classList.remove('open');
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  LOADERS[view]().catch((e) => App.toast(e.message, 'error'));
}
const reload = () => { LOADERS[state.view]().catch((e) => App.toast(e.message, 'error')); refreshCounts(); };

$('sideNav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.view); });
$('burger').onclick = () => $('sidebar').classList.toggle('open');
const themeBtn = $('themeToggle');
const paintTheme = () => { const d = document.documentElement.dataset.theme === 'dark'; themeBtn.textContent = d ? '☀️' : '🌙'; themeBtn.title = d ? 'Switch to light theme' : 'Switch to dark theme'; };
paintTheme();
themeBtn.onclick = () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('sb-theme', root.dataset.theme); } catch { /* storage blocked */ }
  paintTheme();
  if (state.view === 'revenue') drawChart();
};
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (!g) return;
  if (g.dataset.status) $('fStatus').value = g.dataset.status;
  show(g.dataset.goto);
});

function startApp() {
  const now = new Date();
  state.calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  $('fMonth').value = '';
  const y = now.getFullYear();
  $('revYear').innerHTML = [y + 1, y, y - 1, y - 2].map((v) => `<option ${v === y ? 'selected' : ''}>${v}</option>`).join('');
  const initial = location.hash.slice(1);
  show(TITLES[initial] ? initial : 'dashboard');
  pollNotifications();
  setInterval(pollNotifications, 20000);
}

// ---------- notifications ----------
async function pollNotifications() {
  const { unread, items } = await App.api('api/admin/notifications').catch(() => ({ unread: 0, items: [] }));
  $('bellBadge').textContent = unread || '';
  document.title = (unread ? `(${unread}) ` : '') + 'Studio Admin';
  if (state.lastUnread !== null && unread > state.lastUnread && items[0]) {
    App.toast('🔔 ' + items[0].message, 'ok');
    chime();
    reload();
  } else {
    refreshCounts();
  }
  state.lastUnread = unread;
  state.notifs = items;
}

function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.15);
      o.stop(ctx.currentTime + i * 0.15 + 0.3);
    });
  } catch { /* audio not allowed until user interacts */ }
}

$('bell').onclick = async (e) => {
  e.stopPropagation();
  const pop = $('notifPop');
  if (!pop.classList.contains('hidden')) return pop.classList.add('hidden');
  const items = state.notifs || [];
  pop.innerHTML = `<h4>Notifications</h4>` + (items.map((n) => `
    <div class="notif-item ${n.read ? '' : 'unread'}">${n.type === 'booking' ? '🎸' : '💬'} ${esc(n.message)}
      <small>${new Date(n.created_at.replace(' ', 'T') + 'Z').toLocaleString('en-IN')}</small></div>`).join('') || '<div class="empty">No notifications yet</div>');
  pop.classList.remove('hidden');
  if (items.some((n) => !n.read)) {
    await App.api('api/admin/notifications/read', { method: 'POST' });
    $('bellBadge').textContent = '';
    state.lastUnread = 0;
    document.title = 'Studio Admin';
  }
};
document.addEventListener('click', (e) => { if (!e.target.closest('#notifPop')) $('notifPop').classList.add('hidden'); });

async function refreshCounts() {
  const [stats, testis] = await Promise.all([App.api('api/admin/stats'), App.api('api/admin/testimonials')]).catch(() => [null, null]);
  if (stats) $('pendingCount').textContent = stats.pending || '';
  if (testis) $('reviewCount').textContent = testis.filter((t) => !t.approved).length || '';
}

// ---------- booking table + actions ----------
function bookingTable(list, { compact = false } = {}) {
  if (!list.length) return '<div class="empty">No bookings found</div>';
  return `<table class="data"><thead><tr>
      ${compact ? '' : '<th>Booking ID</th>'}<th>Date</th><th>Slot</th><th>Name</th>${compact ? '' : '<th>Contact</th>'}
      <th class="num">Amount</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((b) => `<tr>
      ${compact ? '' : `<td><a href="#" data-act="view" data-id="${b.id}" style="color:var(--accent);font-weight:500">${esc(b.ref)}</a></td>`}
      <td style="white-space:nowrap">${App.fmtDate(b.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
      <td><span class="pill slot">${SLOT_SHORT[b.slot]}</span></td>
      <td><a href="#" data-act="view" data-id="${b.id}"><b>${esc(b.name)}</b></a><br><small class="muted">${esc(b.group_type)}${b.event_type ? ' · ' + esc(b.event_type) : ''}</small></td>
      ${compact ? '' : `<td style="font-size:13px">${esc(b.phone)}<br><small class="muted">${esc(b.email)}</small></td>`}
      <td class="num">${money(b.amount)}</td>
      <td>${statusPill(b.status)} ${payPill(b)}</td>
      <td><div class="actions">${actionButtons(b)}</div></td>
    </tr>`).join('')}</tbody></table>`;
}

function actionButtons(b) {
  const out = [];
  if (b.status !== 'approved') out.push(`<button class="btn btn-green btn-sm" data-act="approve" data-id="${b.id}">Approve</button>`);
  if (b.status !== 'cancelled') out.push(`<button class="btn btn-ghost btn-sm" data-act="cancel" data-id="${b.id}" style="color:var(--red)">Cancel</button>`);
  if (b.status === 'approved') out.push(b.payment_status === 'paid'
    ? `<button class="btn btn-ghost btn-sm" data-act="unpaid" data-id="${b.id}">Mark unpaid</button>`
    : `<button class="btn btn-outline btn-sm" data-act="paid" data-id="${b.id}">Mark paid</button>`);
  return out.join('');
}

const bookingCache = new Map();
const remember = (list) => { list.forEach((b) => bookingCache.set(String(b.id), b)); return list; };

document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act]');
  if (!a || !a.dataset.id || !['approve', 'cancel', 'paid', 'unpaid', 'view'].includes(a.dataset.act)) return;
  e.preventDefault();
  const id = a.dataset.id;
  const b = bookingCache.get(id);
  const act = a.dataset.act;
  if (act === 'view') return viewBooking(b);
  if (act === 'cancel' && !confirm(`Cancel booking ${b ? b.ref + ' for ' + b.name : ''}? The slot will become free again.`)) return;
  const body = { approve: { status: 'approved' }, cancel: { status: 'cancelled' }, paid: { payment_status: 'paid' }, unpaid: { payment_status: 'unpaid' } }[act];
  try {
    await App.api(`api/admin/bookings/${id}`, { method: 'PATCH', body });
    App.toast({ approve: 'Booking approved – customer notified', cancel: 'Booking cancelled – customer notified', paid: 'Marked as paid', unpaid: 'Marked as unpaid' }[act], 'ok');
    document.querySelector('.modal-bg')?.remove();
    reload();
  } catch (err) { App.toast(err.message, 'error'); }
});

function viewBooking(b) {
  if (!b) return;
  const row = (k, v) => (v ? `<div class="sum-row"><span>${k}</span><b>${v}</b></div>` : '');
  const s = App.slotInfo(state.settings)[b.slot];
  const m = modal(`Booking ${esc(b.ref)}`, `
    ${row('Status', statusPill(b.status) + ' ' + payPill(b))}
    ${row('Date', App.fmtDate(b.date))}
    ${row('Slot', `${esc(s.name)} · ${esc(s.time)}`)}
    ${row('Name', `${esc(b.name)} (${esc(b.group_type)})`)}
    ${row('Phone', `<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a> · <a href="https://wa.me/${esc(b.phone.replace(/\D/g, ''))}" target="_blank" style="color:var(--green)">WhatsApp</a>`)}
    ${row('Email', `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`)}
    ${row('Purpose', esc(b.event_type))}
    ${row('People', esc(b.attendees))}
    ${row('Notes', esc(b.notes))}
    ${row('Booked via', b.source === 'admin' ? 'Admin (walk-in / phone)' : 'Website')}
    ${row('Booked on', new Date(b.created_at.replace(' ', 'T') + 'Z').toLocaleString('en-IN'))}
    <div class="field" style="margin-top:14px"><label>Amount (${esc(cur())})</label><input name="amount" type="number" min="0" value="${b.amount}"></div>
    <div class="actions" style="margin-top:14px">${actionButtons(b)}</div>`,
  { submitText: 'Save amount', onSubmit: async (f) => {
    await App.api(`api/admin/bookings/${b.id}`, { method: 'PATCH', body: { amount: f.amount } });
    App.toast('Amount updated', 'ok');
    reload();
  } });
  return m;
}

function newBookingModal(prefill = {}) {
  const s = App.slotInfo(state.settings);
  modal('New booking (walk-in / phone)', `
    <div class="form-grid">
      <div class="field"><label>Date <span class="req">*</span></label><input name="date" type="date" required value="${prefill.date || ''}"></div>
      <div class="field"><label>Slot <span class="req">*</span></label><select name="slot">
        ${['first', 'second', 'full'].map((k) => `<option value="${k}" ${prefill.slot === k ? 'selected' : ''}>${esc(s[k].name)} (${esc(s[k].time)})</option>`).join('')}</select></div>
      <div class="field"><label>Name of Band / Individual / Group <span class="req">*</span></label><input name="name" required></div>
      <div class="field"><label>Type</label><select name="group_type"><option>Band</option><option>Individual</option><option>Group</option></select></div>
      <div class="field"><label>Contact number</label><input name="phone" type="tel"></div>
      <div class="field"><label>Email</label><input name="email" type="email"></div>
      <div class="field"><label>Purpose</label><input name="event_type" placeholder="Jamming session, celebration…"></div>
      <div class="field"><label>Amount (blank = standard price)</label><input name="amount" type="number" min="0"></div>
      <div class="field full"><label>Notes</label><textarea name="notes"></textarea></div>
      <label class="full"><input type="checkbox" name="payment_status" value="paid"> Payment already received</label>
    </div>
    <p class="note">Bookings created here are approved immediately.</p>`,
  { submitText: 'Create booking', onSubmit: async (f) => {
    if (!f.date || !f.name) { App.toast('Date and name are required', 'error'); return false; }
    const r = await App.api('api/admin/bookings', { method: 'POST', body: f });
    App.toast(`Booking ${r.ref} created`, 'ok');
    reload();
  } });
}
$('newBooking').onclick = () => newBookingModal();

// ---------- dashboard ----------
async function loadDashboard() {
  const [st, pending] = await Promise.all([App.api('api/admin/stats'), App.api('api/admin/bookings?status=pending')]);
  remember(pending); remember(st.upcoming); remember(st.todays);
  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' });
  $('kpis').innerHTML = `
    <div class="kpi ${st.pending ? 'attention' : ''}"><div class="label">Pending approvals</div><div class="value">${st.pending}</div><div class="sub">${st.pending ? 'Needs your action' : 'All caught up'}</div></div>
    <div class="kpi"><div class="label">Bookings in ${monthName}</div><div class="value">${st.month_bookings}</div><div class="sub">Pending + approved</div></div>
    <div class="kpi"><div class="label">${monthName} revenue</div><div class="value">${money(st.month_revenue)}</div><div class="sub">Approved bookings</div></div>
    <div class="kpi"><div class="label">Collected</div><div class="value">${money(st.month_collected)}</div><div class="sub">${money(st.month_revenue - st.month_collected)} still due</div></div>
    <div class="kpi"><div class="label">Free dates left in ${monthName}</div><div class="value">${st.free_dates}</div><div class="sub">+ ${st.partly_free_dates} with a half day open</div></div>`;
  $('dashPending').innerHTML = bookingTable(pending.slice().sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8), { compact: true });
  $('dashToday').innerHTML = st.todays.length
    ? st.todays.map((b) => `<div class="sum-row"><span><span class="pill slot">${SLOT_SHORT[b.slot]}</span> <a href="#" data-act="view" data-id="${b.id}"><b>${esc(b.name)}</b></a></span><b>${statusPill(b.status)}</b></div>`).join('')
    : '<div class="empty">No sessions today – the room is free.</div>';
  $('dashUpcoming').innerHTML = bookingTable(st.upcoming);
}

// ---------- bookings ----------
async function loadBookings() {
  const q = new URLSearchParams();
  if ($('fMonth').value) q.set('month', $('fMonth').value);
  if ($('fStatus').value) q.set('status', $('fStatus').value);
  if ($('fSearch').value.trim()) q.set('q', $('fSearch').value.trim());
  const list = remember(await App.api('api/admin/bookings?' + q));
  $('bookingTable').innerHTML = bookingTable(list);
}
['fMonth', 'fStatus'].forEach((id) => $(id).addEventListener('change', loadBookings));
let searchTimer;
$('fSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadBookings, 300); });
$('fClear').onclick = () => { $('fMonth').value = ''; $('fStatus').value = ''; $('fSearch').value = ''; loadBookings(); };

// ---------- calendar ----------
async function loadCalendar() {
  const m = state.calMonth;
  const key = `${m.getFullYear()}-${App.pad(m.getMonth() + 1)}`;
  $('acalTitle').textContent = m.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const list = remember(await App.api(`api/admin/bookings?month=${key}`));
  const active = list.filter((b) => b.status !== 'cancelled').sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
  const today = App.ymd(new Date());
  const byDate = {};
  active.forEach((b) => (byDate[b.date] ||= []).push(b));

  const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('');
  html += '<div class="day blank"></div>'.repeat(m.getDay());
  const free = [], half = [];
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${key}-${App.pad(d)}`;
    const bs = byDate[ds] || [];
    const first = bs.some((b) => b.slot !== 'second'), second = bs.some((b) => b.slot !== 'first');
    const cls = !first && !second ? 'free' : first && second ? 'full' : 'partial';
    if (ds >= today) {
      if (cls === 'free') free.push(ds);
      if (cls === 'partial') half.push({ ds, open: first ? 'second' : 'first' });
    }
    html += `<div class="day ${cls} ${ds < today ? 'past' : ''} ${ds === today ? 'today' : ''}" data-date="${ds}" data-open="${!first ? 'first' : !second ? 'second' : ''}">
      <div class="d">${d}${cls === 'free' && ds >= today ? '<em>Free</em>' : ''}</div>
      ${bs.map((b) => `<div class="chip ${b.status}" data-act="view" data-id="${b.id}" title="${esc(b.name)} – ${SLOT_SHORT[b.slot]} (${b.status})">${SLOT_SHORT[b.slot].replace(' Half', '')} · ${esc(b.name)}</div>`).join('')}
    </div>`;
  }
  $('acal').innerHTML = html;

  $('freeDates').innerHTML = (free.length || half.length)
    ? `<p class="muted" style="margin-top:0;font-size:13px">Click a date to add a walk-in / phone booking.</p>
       <div class="free-list">${free.map((ds) => `<button data-new="${ds}" data-slot="full">${App.fmtDate(ds, { weekday: 'short', day: 'numeric', month: 'short' })}</button>`).join('')}
       ${half.map((h) => `<button class="half" data-new="${h.ds}" data-slot="${h.open}">${App.fmtDate(h.ds, { day: 'numeric', month: 'short' })} · ${SLOT_SHORT[h.open]} free</button>`).join('')}</div>`
    : '<div class="empty">No free dates left this month.</div>';

  const approvedSum = active.filter((b) => b.status === 'approved').reduce((s, b) => s + b.amount, 0);
  $('monthSummary').textContent = `${active.length} active · ${money(approvedSum)} approved`;
  $('monthBookings').innerHTML = bookingTable(active, { compact: true });
}
$('acal').addEventListener('click', (e) => {
  if (e.target.closest('[data-act]')) return;
  const day = e.target.closest('.day');
  if (day && day.dataset.open && day.dataset.date >= App.ymd(new Date())) newBookingModal({ date: day.dataset.date, slot: day.classList.contains('free') ? 'full' : day.dataset.open });
});
$('freeDates').addEventListener('click', (e) => { const b = e.target.closest('[data-new]'); if (b) newBookingModal({ date: b.dataset.new, slot: b.dataset.slot }); });
$('acalPrev').onclick = () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1); loadCalendar(); };
$('acalNext').onclick = () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1); loadCalendar(); };
$('acalToday').onclick = () => { const n = new Date(); state.calMonth = new Date(n.getFullYear(), n.getMonth(), 1); loadCalendar(); };

// ---------- revenue ----------
let revData = null;
async function loadRevenue() {
  revData = await App.api(`api/admin/revenue?year=${$('revYear').value}`);
  const t = revData.months.reduce((a, m) => {
    for (const k of ['revenue', 'collected', 'pipeline', 'approved_count', 'full_count', 'half_count', 'cancelled_count']) a[k] = (a[k] || 0) + m[k];
    return a;
  }, {});
  $('revKpis').innerHTML = `
    <div class="kpi"><div class="label">Revenue ${revData.year}</div><div class="value">${money(t.revenue)}</div><div class="sub">${t.approved_count} approved sessions</div></div>
    <div class="kpi"><div class="label">Collected</div><div class="value">${money(t.collected)}</div><div class="sub">Marked as paid</div></div>
    <div class="kpi ${t.revenue - t.collected > 0 ? 'attention' : ''}"><div class="label">Outstanding</div><div class="value">${money(t.revenue - t.collected)}</div><div class="sub">Approved but unpaid</div></div>
    <div class="kpi"><div class="label">Pending pipeline</div><div class="value">${money(t.pipeline)}</div><div class="sub">Awaiting approval</div></div>
    <div class="kpi"><div class="label">Session mix</div><div class="value">${t.full_count} / ${t.half_count}</div><div class="sub">Full day / half day · ${t.cancelled_count} cancelled</div></div>`;
  $('revChartTitle').textContent = `Monthly revenue · ${revData.year}`;
  drawChart();
  $('revTable').innerHTML = `<table class="data"><thead><tr><th>Month</th><th class="num">Sessions</th><th class="num">Full / Half</th><th class="num">Revenue</th><th class="num">Collected</th><th class="num">Outstanding</th><th class="num">Pending</th><th class="num">Cancelled</th></tr></thead><tbody>
    ${revData.months.map((m, i) => `<tr><td>${MONTHS[i]} ${revData.year}</td><td class="num">${m.approved_count}</td><td class="num">${m.full_count} / ${m.half_count}</td>
      <td class="num"><b>${money(m.revenue)}</b></td><td class="num">${money(m.collected)}</td><td class="num">${money(m.revenue - m.collected)}</td>
      <td class="num">${money(m.pipeline)}</td><td class="num">${m.cancelled_count}</td></tr>`).join('')}
    <tr style="font-weight:700"><td>Total</td><td class="num">${t.approved_count}</td><td class="num">${t.full_count} / ${t.half_count}</td><td class="num">${money(t.revenue)}</td><td class="num">${money(t.collected)}</td><td class="num">${money(t.revenue - t.collected)}</td><td class="num">${money(t.pipeline)}</td><td class="num">${t.cancelled_count}</td></tr>
    </tbody></table>`;
}
$('revYear').addEventListener('change', loadRevenue);

function niceStep(max) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
}
const compact = (n) => (n >= 100000 ? (n / 100000).toFixed(n % 100000 ? 1 : 0) + 'L' : n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : String(n));

function drawChart() {
  const host = $('revChart');
  if (!revData || !host.offsetWidth) return;
  const W = host.offsetWidth, H = 280, pad = { l: 52, r: 8, t: 16, b: 28 };
  const vals = revData.months.map((m) => m.revenue);
  const step = niceStep(Math.max(...vals, 1000));
  const top = Math.max(step * Math.ceil(Math.max(...vals, 1000) / step), step);
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const band = iw / 12, bw = Math.min(42, band * 0.6);
  const y = (v) => pad.t + ih - (v / top) * ih;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly revenue bar chart"><g class="grid axis">`;
  for (let v = 0; v <= top; v += step) {
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${esc(cur())}${compact(v)}</text>`;
  }
  svg += '</g><g class="axis">';
  vals.forEach((v, i) => {
    const cx = pad.l + band * i + band / 2;
    svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${MONTHS[i]}</text>`;
  });
  svg += '</g><g>';
  vals.forEach((v, i) => {
    const x = pad.l + band * i + (band - bw) / 2, yt = y(v), h = pad.t + ih - yt, r = Math.min(4, h);
    svg += v > 0
      ? `<path class="bar" data-i="${i}" d="M${x},${pad.t + ih} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${pad.t + ih} Z"/>`
      : `<path class="bar" data-i="${i}" d=""/>`;
  });
  // Full-height hit areas on top of the bars so hovering anywhere in a month's column shows its tooltip.
  vals.forEach((v, i) => {
    svg += `<rect class="bar-hit" data-i="${i}" x="${pad.l + band * i}" y="${pad.t}" width="${band}" height="${ih}"/>`;
  });
  svg += '</g></svg><div class="chart-tip hidden"></div>';
  host.innerHTML = svg;

  const tip = host.querySelector('.chart-tip');
  host.querySelectorAll('.bar-hit').forEach((hit) => {
    hit.addEventListener('mouseenter', () => {
      const i = Number(hit.dataset.i), m = revData.months[i];
      host.querySelectorAll('.bar').forEach((b) => b.classList.toggle('hl', Number(b.dataset.i) === i));
      tip.innerHTML = `${MONTHS[i]} ${revData.year}<b>${money(m.revenue)}</b>${m.approved_count} sessions · ${money(m.collected)} collected`;
      tip.style.left = `${pad.l + band * i + band / 2}px`;
      tip.style.top = `${Math.max(y(m.revenue) - 8, 40)}px`;
      tip.classList.remove('hidden');
    });
    hit.addEventListener('mouseleave', () => { tip.classList.add('hidden'); host.querySelectorAll('.bar.hl').forEach((b) => b.classList.remove('hl')); });
  });
}
window.addEventListener('resize', () => { if (state.view === 'revenue') drawChart(); });

// ---------- image helpers ----------
function readImage(file, maxW = 1280, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (file.size > 15 * 1024 * 1024) return reject(new Error(`${file.name} is too large`));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      if (file.type === 'image/gif') return resolve(reader.result);
      const img = new Image();
      img.onload = () => {
        // Downscale big photos so uploads stay quick and pages load fast.
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Not a valid image'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
// Uploads the photo plus a small copy the site uses for grids and tiles.
const uploadImage = async (file) => {
  const [dataUrl, thumbDataUrl] = await Promise.all([readImage(file), file.type === 'image/gif' ? null : readImage(file, 480, 0.68)]);
  return (await App.api('api/admin/upload', { method: 'POST', body: { dataUrl, thumbDataUrl } })).url;
};

// ---------- banners ----------
let bannerCache = [];
async function loadBanners() {
  bannerCache = await App.api('api/admin/banners');
  $('bannerList').innerHTML = bannerCache.map((b) => `
    <div class="banner-row ${b.active ? '' : 'inactive'}">
      <div class="thumb" style="background-image:url('${esc(App.thumb(b.image))}')"></div>
      <div>
        <h4>${esc(b.title)} ${b.active ? '<span class="pill approved">Live</span>' : '<span class="pill unpaid">Hidden</span>'}</h4>
        <p>${esc(b.subtitle || '')}</p>
        <p class="muted">${b.event_date ? '📅 ' + App.fmtDate(b.event_date) + ' · ' : ''}Button: ${esc(b.cta_text || '—')} → ${esc(b.cta_link || '—')} · Order ${b.sort}</p>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-banner-toggle="${b.id}">${b.active ? 'Hide' : 'Publish'}</button>
        <button class="btn btn-outline btn-sm" data-banner-edit="${b.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-banner-del="${b.id}" style="color:var(--red)">Delete</button>
      </div>
    </div>`).join('') || '<div class="card empty">No banners yet – add one to promote your next jam session.</div>';
}

function bannerModal(b = { active: 1, cta_text: 'Book Your Slot', cta_link: 'book.html', sort: bannerCache.length + 1 }) {
  const m = modal(b.id ? 'Edit banner' : 'New banner', `
    <div class="form-grid">
      <div class="field full"><label>Title <span class="req">*</span></label><input name="title" required maxlength="120" value="${esc(b.title || '')}"></div>
      <div class="field full"><label>Subtitle</label><input name="subtitle" maxlength="300" value="${esc(b.subtitle || '')}"></div>
      <div class="field"><label>Event date (optional)</label><input name="event_date" type="date" value="${esc(b.event_date || '')}"></div>
      <div class="field"><label>Display order</label><input name="sort" type="number" value="${b.sort ?? 0}"></div>
      <div class="field"><label>Button text</label><input name="cta_text" maxlength="40" value="${esc(b.cta_text || '')}"></div>
      <div class="field"><label>Button link</label><input name="cta_link" value="${esc(b.cta_link || '')}"></div>
      <div class="field full"><label>Banner image (wide, ~1240×400)</label>
        <div class="img-preview" id="bPreview" style="background-image:url('${esc(b.image || '')}')">${b.image ? '' : 'No image – a colour gradient will be used'}</div>
        <div style="display:flex;gap:8px;margin-top:8px"><input type="file" id="bFile" accept="image/*" style="flex:1"><button type="button" class="btn btn-ghost btn-sm" id="bClear">Remove image</button></div>
        <input type="hidden" name="image" value="${esc(b.image || '')}">
      </div>
      <label class="full"><input type="checkbox" name="active" value="1" ${b.active ? 'checked' : ''}> Show on website</label>
    </div>`,
  { wide: true, submitText: b.id ? 'Save banner' : 'Create banner', onSubmit: async (f) => {
    await App.api('api/admin/banners', { method: 'POST', body: { ...f, id: b.id, active: !!f.active } });
    App.toast('Banner saved', 'ok');
    loadBanners();
  } });
  const img = m.form.querySelector('[name=image]');
  const prev = m.form.querySelector('#bPreview');
  m.form.querySelector('#bFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    prev.textContent = 'Uploading…';
    try {
      img.value = await uploadImage(file);
      prev.style.backgroundImage = `url('${img.value}')`;
      prev.textContent = '';
    } catch (err) { prev.textContent = err.message; }
  });
  m.form.querySelector('#bClear').onclick = () => { img.value = ''; prev.style.backgroundImage = ''; prev.textContent = 'No image – a colour gradient will be used'; };
}
$('newBanner').onclick = () => bannerModal();
$('bannerList').addEventListener('click', async (e) => {
  const t = e.target;
  const find = (id) => bannerCache.find((b) => String(b.id) === id);
  if (t.dataset.bannerEdit) bannerModal(find(t.dataset.bannerEdit));
  if (t.dataset.bannerToggle) {
    const b = find(t.dataset.bannerToggle);
    await App.api('api/admin/banners', { method: 'POST', body: { ...b, active: !b.active } });
    loadBanners();
  }
  if (t.dataset.bannerDel && confirm('Delete this banner?')) {
    await App.api(`api/admin/banners/${t.dataset.bannerDel}`, { method: 'DELETE' });
    App.toast('Banner deleted', 'ok');
    loadBanners();
  }
});

// ---------- gallery ----------
let galleryItems = [], galleryCats = [], galleryFilter = 'All';
async function loadGallery() {
  const [items, pub] = await Promise.all([App.api('api/gallery'), App.api('api/settings')]);
  galleryItems = items;
  galleryCats = App.galleryCategories(pub, items);
  const sel = $('gUploadCat');
  const keep = sel.value;
  sel.innerHTML = galleryCats.map((c) => `<option>${esc(c)}</option>`).join('');
  if (galleryCats.includes(keep)) sel.value = keep;
  if (galleryFilter !== 'All' && !galleryCats.includes(galleryFilter)) galleryFilter = 'All';
  drawGallery();
}
function drawGallery() {
  $('gFilter').innerHTML = ['All', ...galleryCats].map((c) => {
    const n = c === 'All' ? galleryItems.length : galleryItems.filter((g) => g.category === c).length;
    return `<button class="chip ${c === galleryFilter ? 'on' : ''}" data-gcat="${esc(c)}">${esc(c)} <small>${n}</small></button>`;
  }).join('');
  const list = galleryFilter === 'All' ? galleryItems : galleryItems.filter((g) => g.category === galleryFilter);
  $('adminGallery').innerHTML = list.map((g) => `
    <div class="gi"><div class="img" style="background-image:url('${esc(App.thumb(g.image))}')"></div>
      <div class="meta"><input value="${esc(g.caption || '')}" placeholder="Caption" data-cap="${g.id}" title="Caption – saved when you leave the box">
      <button class="btn btn-ghost btn-sm" data-gdel="${g.id}" style="color:var(--red)" title="Delete">🗑</button></div>
      <div class="meta" style="padding-top:0"><select data-gcatsel="${g.id}" title="Section">
        ${galleryCats.map((c) => `<option ${c === g.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      ${g.credit ? `<div class="gi-credit">${esc(g.credit)}</div>` : ''}
    </div>`).join('') || '<div class="empty">No photos in this section yet – upload some above.</div>';
}
$('gFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-gcat]');
  if (!b) return;
  galleryFilter = b.dataset.gcat;
  if (galleryFilter !== 'All') $('gUploadCat').value = galleryFilter;
  drawGallery();
});
async function uploadGalleryFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  const category = $('gUploadCat').value;
  App.toast(`Uploading ${list.length} photo(s) to ${category}…`);
  for (const f of list) {
    try {
      const url = await uploadImage(f);
      await App.api('api/admin/gallery', { method: 'POST', body: { image: url, category, caption: f.name.replace(/.[^.]+$/, '').replace(/[-_]+/g, ' ') } });
    } catch (err) { App.toast(err.message, 'error'); }
  }
  App.toast('Gallery updated – edit captions below', 'ok');
  galleryFilter = category;
  loadGallery();
}
$('galleryFiles').addEventListener('change', (e) => { uploadGalleryFiles(e.target.files); e.target.value = ''; });
const dz = $('dropzone');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); uploadGalleryFiles(e.dataTransfer.files); });
$('adminGallery').addEventListener('change', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.cap) {
      await App.api(`api/admin/gallery/${t.dataset.cap}`, { method: 'PATCH', body: { caption: t.value } });
      galleryItems.find((g) => String(g.id) === t.dataset.cap).caption = t.value;
      App.toast('Caption saved', 'ok');
    }
    if (t.dataset.gcatsel) {
      await App.api(`api/admin/gallery/${t.dataset.gcatsel}`, { method: 'PATCH', body: { category: t.value } });
      galleryItems.find((g) => String(g.id) === t.dataset.gcatsel).category = t.value;
      App.toast(`Moved to ${t.value}`, 'ok');
      drawGallery();
    }
  } catch (err) { App.toast(err.message, 'error'); }
});
$('adminGallery').addEventListener('click', async (e) => {
  const id = e.target.dataset.gdel;
  if (id && confirm('Delete this photo?')) {
    await App.api(`api/admin/gallery/${id}`, { method: 'DELETE' });
    loadGallery();
  }
});

// ---------- testimonials ----------
async function loadTestimonials() {
  const list = await App.api('api/admin/testimonials');
  $('testiTable').innerHTML = list.length ? `<table class="data"><thead><tr><th>Name</th><th>Rating</th><th>Review</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((t) => `<tr>
      <td><b>${esc(t.name)}</b><br><small class="muted">${esc(t.band || '')}</small></td>
      <td style="color:#f5a623;white-space:nowrap">${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</td>
      <td style="max-width:460px;font-size:13px">${esc(t.message)}</td>
      <td>${t.approved ? '<span class="pill approved">Live on site</span>' : '<span class="pill pending">Awaiting approval</span>'}</td>
      <td><div class="actions">
        ${t.approved ? `<button class="btn btn-ghost btn-sm" data-tapprove="${t.id}" data-v="0">Hide</button>` : `<button class="btn btn-green btn-sm" data-tapprove="${t.id}" data-v="1">Approve</button>`}
        <button class="btn btn-ghost btn-sm" data-tdel="${t.id}" style="color:var(--red)">Delete</button></div></td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">No testimonials yet.</div>';
}
$('testiTable').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.tapprove) {
    await App.api(`api/admin/testimonials/${t.dataset.tapprove}`, { method: 'PATCH', body: { approved: t.dataset.v === '1' } });
    reload();
  }
  if (t.dataset.tdel && confirm('Delete this testimonial?')) {
    await App.api(`api/admin/testimonials/${t.dataset.tdel}`, { method: 'DELETE' });
    reload();
  }
});
$('newTesti').onclick = () => modal('Add testimonial', `
  <div class="form-grid">
    <div class="field"><label>Name <span class="req">*</span></label><input name="name" required></div>
    <div class="field"><label>Band / Group</label><input name="band"></div>
    <div class="field full"><label>Rating</label><select name="rating"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></div>
    <div class="field full"><label>Review <span class="req">*</span></label><textarea name="message" required></textarea></div>
  </div>`, { submitText: 'Add', onSubmit: async (f) => {
  await App.api('api/admin/testimonials', { method: 'POST', body: f });
  App.toast('Testimonial added', 'ok');
  reload();
} });

// ---------- settings ----------
function attrRow(a = { icon: '⭐', title: '', text: '' }) {
  return `<div class="attr-row"><input data-k="icon" value="${esc(a.icon)}"><input data-k="title" value="${esc(a.title)}" placeholder="Title"><input data-k="text" value="${esc(a.text)}" placeholder="Description"><button type="button" title="Remove" data-rm>×</button></div>`;
}
async function loadSettings() {
  const s = await App.api('api/admin/settings');
  $('demoToggle').checked = s.admin_demo_mode === '1';
  const form = $('settingsForm');
  for (const el of form.elements) if (el.name && s[el.name] !== undefined) el.value = s[el.name];
  let attrs = [];
  try { attrs = JSON.parse(s.attractions || '[]'); } catch {}
  $('attrRows').innerHTML = attrs.map(attrRow).join('');
}
$('addAttr').onclick = () => $('attrRows').insertAdjacentHTML('beforeend', attrRow());
$('attrRows').addEventListener('click', (e) => { if (e.target.hasAttribute('data-rm')) e.target.closest('.attr-row').remove(); });
$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  body.attractions = JSON.stringify([...document.querySelectorAll('#attrRows .attr-row')].map((r) =>
    Object.fromEntries([...r.querySelectorAll('input')].map((i) => [i.dataset.k, i.value.trim()]))).filter((a) => a.title));
  try {
    await App.api('api/admin/settings', { method: 'PUT', body });
    state.settings = await App.api('api/settings');
    document.querySelectorAll('[data-s]').forEach((el) => { el.textContent = state.settings[el.dataset.s] || ''; });
    App.toast('Settings saved – the website is updated', 'ok');
  } catch (err) { App.toast(err.message, 'error'); }
});
$('demoToggle').addEventListener('change', async (e) => {
  const on = e.target.checked;
  if (!on && !confirm('Turn off demo mode? The admin password will be required at next login (current password: the one set below, default admin123).')) { e.target.checked = true; return; }
  try {
    await App.api('api/admin/settings', { method: 'PUT', body: { admin_demo_mode: on ? '1' : '0' } });
    $('demoPill').classList.toggle('hidden', !on);
    $('demoBanner').classList.toggle('hidden', !on);
    App.toast(on ? 'Demo mode on – no password needed' : 'Demo mode off – password required at next login', 'ok');
  } catch (err) { e.target.checked = !on; App.toast(err.message, 'error'); }
});
$('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await App.api('api/admin/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    App.toast('Password updated', 'ok');
  } catch (err) { App.toast(err.message, 'error'); }
});

boot().catch((e) => App.toast(e.message, 'error'));

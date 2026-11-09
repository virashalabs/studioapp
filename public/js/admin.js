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
  const { admin, demo, super: sup } = await App.api('api/admin/me');
  state.demo = demo;
  // Superadmin: everything the admin has, plus the password panel in Settings.
  $('superCard').classList.toggle('hidden', !sup);
  if (sup) loadClearOpts();
  $('superBadge').classList.toggle('hidden', !sup);
  $('demoNote').classList.toggle('hidden', !demo);
  $('pwField').classList.toggle('hidden', demo);
  $('pw').required = !demo;
  $('user').required = !demo;
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
    await App.api('api/admin/login', { method: 'POST', body: { username: $('user').value, password: $('pw').value } });
    $('pw').value = '';
    boot();
  } catch (err) {
    $('loginError').textContent = err.message;
    $('loginError').classList.remove('hidden');
  }
});

$('forgotLink').onclick = async (e) => {
  e.preventDefault();
  if (!confirm('Send a password reset link to the admin email?')) return;
  try {
    const r = await App.api('api/admin/forgot', { method: 'POST' });
    alert(`A reset link has been sent to ${r.to}.\n\nOpen the email and tap "Set a new admin password". The link works for 30 minutes. Check the spam folder if you don't see it.`);
  } catch (err) { alert(err.message); }
};

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
  dashboard: 'Dashboard', events: 'Weekly Events', bookings: 'Bookings', calendar: 'Calendar & Free Dates', members: 'Members & Songs', revenue: 'Revenue',
  banners: 'Banner Management', gallery: 'Gallery', testimonials: 'Testimonials', settings: 'Settings',
};
const LOADERS = {
  dashboard: loadDashboard, bookings: loadBookings, calendar: loadCalendar, members: loadMembers, revenue: loadRevenue,
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
    <div class="notif-item ${n.read ? '' : 'unread'}">${n.type === 'booking' ? '🎸' : n.type === 'membership' ? '🎤' : '💬'} ${esc(n.message)}
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
  App.api('api/admin/members').then((d) => { $('memberAlertCount').textContent = d.members.filter((m) => m.requested || !m.approved || (m.claims && m.claims.length)).length || ''; }).catch(() => {});
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

$('resetAdminForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await App.api('api/admin/reset-admin-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    App.toast('Admin password changed', 'ok');
  } catch (err) { App.toast(err.message, 'error'); }
});
$('superPwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await App.api('api/admin/super-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    App.toast('Superadmin password changed', 'ok');
  } catch (err) { App.toast(err.message, 'error'); }
});

async function loadClearOpts() {
  try {
    const c = await App.api('api/admin/clear-data');
    const opt = (name, value, label, checked, type = 'checkbox') => `<label style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:14px"><input type="${type}" name="${name}" value="${value}" ${checked ? 'checked' : ''}> ${label}</label>`;
    $('clearOpts').innerHTML = `
      <div style="font-weight:600;font-size:13px;margin:4px 0">Singers</div>
      ${opt('singers', 'demo', `Demo singers only (Ram, Priya, Karthik, Meena, Arun, Divya) – <b>${c.demo_singers}</b>`, true, 'radio')}
      ${opt('singers', 'all', `<span style="color:var(--red)">All singers</span>, including ones added while testing – <b>${c.all_singers}</b>`, false, 'radio')}
      ${opt('singers', 'none', 'Keep all singers', false, 'radio')}
      <div style="font-weight:600;font-size:13px;margin:10px 0 4px">Other test data</div>
      ${opt('events', '1', `Weekly events, votes and line-ups – <b>${c.events}</b>`, true)}
      ${opt('bookings', '1', `Studio bookings – <b>${c.bookings}</b>`, true)}
      ${opt('reviews', '1', `Reviews / testimonials (the sample ones) – <b>${c.reviews}</b>`, true)}
      ${opt('notifications', '1', `Bell notifications – <b>${c.notifications}</b>`, true)}`;
  } catch { /* not superadmin */ }
}
$('clearForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  if (f.confirm !== 'DELETE') return App.toast('Type DELETE (in capitals) to confirm', 'error');
  if (!confirm('Delete the selected data permanently?')) return undefined;
  try {
    const r = await App.api('api/admin/clear-data', { method: 'POST', body: { confirm: 'DELETE', singers: f.singers, events: !!f.events, bookings: !!f.bookings, reviews: !!f.reviews, notifications: !!f.notifications } });
    const d = r.done;
    App.toast(`Cleared: ${[d.singers != null && `${d.singers} singers`, d.events != null && `${d.events} events`, d.bookings != null && `${d.bookings} bookings`, d.reviews != null && `${d.reviews} reviews`].filter(Boolean).join(', ') || 'nothing'}`, 'ok');
    e.target.reset();
    loadClearOpts();
  } catch (err) { App.toast(err.message, 'error'); }
  return undefined;
});

// ---------- members & songs ----------
let memberData = { members: [], plans: [] };
const fmtShort = (d) => App.fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
const monthLabel = (ym, opts = { month: 'long', year: 'numeric' }) => new Date(ym + '-01T00:00').toLocaleDateString('en-IN', opts);
const planPrice = (p) => Number(p.price) || 0;
const plansOf = (g) => memberData.plans.filter((p) => p.gender === g);
const limitLabel = (l) => (l == null ? 'Unlimited' : `${l} songs`);
const GENDERS = ['Male', 'Female'];

function usageCell(m) {
  const lim = m.plan_limit;
  const pct = lim == null ? 100 : Math.min(100, (m.month_count / lim) * 100);
  const cls = m.over_limit ? 'over' : m.remaining != null && m.remaining <= 3 ? 'warn' : '';
  return `<div style="min-width:130px"><b>${m.month_count}</b> <span class="muted">/ ${lim == null ? '∞' : lim}</span>
    <div class="meter ${cls}" style="margin:5px 0 0;height:6px"><span style="width:${pct}%"></span></div></div>`;
}
const FEE_PILL = { paid: ['approved', '✅ Paid'], due: ['pending', '⏳ Due'], overdue: ['cancelled', '⚠ Overdue'] };
function feePill(f) {
  const [cls, label] = FEE_PILL[f.status];
  return `<span class="pill ${cls}">${f.part_paid ? `${f.status === 'overdue' ? '⚠' : '⏳'} Balance ${money(f.balance)}` : label}</span>`;
}
function feeCell(m) {
  const f = m.fee, older = m.fee_overdue.filter((x) => x !== f.month);
  return `<div style="white-space:nowrap">${feePill(f)} <small class="muted">${money(f.amount)}</small><br>
    <small class="muted">${f.status === 'paid' ? `Paid ${App.fmtDate(f.paid_on, { day: 'numeric', month: 'short' })}` : `Pay before ${App.fmtDate(f.due_date, { day: 'numeric', month: 'short' })}`}</small>
    ${older.length ? `<br><span class="pill cancelled">Unpaid: ${older.map((x) => monthLabel(x, { month: 'short' })).join(', ')}</span>` : ''}</div>`;
}
function memberFlags(m) {
  return [
    m.requested ? `<span class="pill pending" title="The singer asked for this upgrade">🙋 Wants ${esc(m.requested.name)}</span>` : '',
    m.over_limit && m.suggested && !m.requested ? `<span class="pill cancelled">⚠ Over limit · suggest ${esc(m.suggested.name)}</span>` : '',
    !m.active ? '<span class="pill unpaid">Expired</span>' : '',
    !m.approved ? '<span class="pill pending" title="Joined through an event vote link">🆕 New – approve</span>' : '',
    m.claims && m.claims.length ? `<span class="pill paid" title="Singer says they paid by UPI">💳 UPI ref ${esc(m.claims[0].ref)}</span>` : '',
  ].join(' ');
}

async function loadMembers() {
  memberData = await App.api('api/admin/members');
  const ms = memberData.members;
  const kpi = (label, value, sub = '', attention = false) => `<div class="kpi ${attention ? 'attention' : ''}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  const over = ms.filter((m) => m.over_limit).length, reqs = ms.filter((m) => m.requested).length;
  const owing = ms.filter((m) => m.fee_due > 0), late = ms.filter((m) => m.fee_overdue.length);
  $('memberKpis').innerHTML = kpi('Members', ms.length, `${ms.filter((m) => m.active).length} active`)
    + kpi('Fees pending', money(owing.reduce((a, m) => a + m.fee_due, 0)),
      `${owing.length} member${owing.length === 1 ? '' : 's'} · ${late.length} overdue (pay before the ${ordinal(memberData.due_day)})`, late.length > 0)
    + kpi('Songs this month', ms.reduce((a, m) => a + m.month_count, 0), monthLabel(memberData.month))
    + kpi('Over their limit', over, 'Prompt to upgrade', over > 0)
    + kpi('Upgrade requests', reqs, 'From the singer portal', reqs > 0);
  drawMembers();
  drawPlansForm();
}

function drawMembers() {
  const q = $('mSearch').value.trim().toLowerCase(), g = $('mGender').value, f = $('mFilter').value;
  const list = memberData.members.filter((m) =>
    (!q || [m.name, m.member_no, m.phone].some((v) => String(v || '').toLowerCase().includes(q)))
    && (!g || m.gender === g)
    && (!f || (f === 'over' && m.over_limit) || (f === 'requests' && m.requested) || (f === 'expired' && !m.active)
      || (f === 'unpaid' && m.fee_due > 0) || (f === 'overdue' && m.fee_overdue.length)
      || (f === 'new' && !m.approved) || (f === 'claims' && m.claims && m.claims.length)));
  $('memberTable').innerHTML = list.length ? `<table class="data"><thead><tr><th>Member</th><th>Gender</th><th>Plan</th><th>Songs this month</th><th>Fee · ${monthLabel(memberData.month, { month: 'short' })}</th><th>Valid until</th><th></th></tr></thead><tbody>
    ${list.map((m) => `<tr>
      <td><a href="#" data-mview="${m.id}"><b>${esc(m.name)}</b></a><br><small class="muted">${esc(m.member_no)} · ${esc(m.phone)}</small></td>
      <td>${esc(m.gender)}</td>
      <td><b>${esc(m.plan_name)}</b><br><small class="muted">${money(m.plan_price)} / month</small></td>
      <td>${usageCell(m)}</td>
      <td>${feeCell(m)}</td>
      <td style="white-space:nowrap">${fmtShort(m.valid_until)}<br>${memberFlags(m)}</td>
      <td><div class="actions"><button class="btn btn-ghost btn-sm" data-mview="${m.id}">View</button><button class="btn btn-primary btn-sm" data-msongs="${m.id}">+ Songs</button>
        ${!m.approved ? `<button class="btn btn-outline btn-sm" data-mapprove="${m.id}">Approve</button>` : ''}
        ${m.claims && m.claims.length ? `<button class="btn btn-green btn-sm" data-mpay="${m.id}" data-month="${m.claims[0].month}">Confirm UPI</button>`
          : m.fee.status !== 'paid' ? `<button class="btn btn-green btn-sm" data-mpay="${m.id}" data-month="${m.fee.month}">Mark paid</button>` : ''}</div></td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">No members match.</div>';
}
['mSearch', 'mGender', 'mFilter'].forEach((id) => $(id).addEventListener('input', drawMembers));
$('memberTable').addEventListener('click', (e) => {
  const v = e.target.closest('[data-mview]'), s = e.target.closest('[data-msongs]'), pay = e.target.closest('[data-mpay]');
  const ap = e.target.closest('[data-mapprove]');
  if (ap) App.api(`api/admin/members/${ap.dataset.mapprove}/approve`, { method: 'POST' }).then(() => { App.toast('Singer approved', 'ok'); reload(); }).catch((err) => App.toast(err.message, 'error'));
  if (v) { e.preventDefault(); openMember(Number(v.dataset.mview)); }
  if (pay) markPaid(memberData.members.find((m) => m.id === Number(pay.dataset.mpay)), pay.dataset.month).then(reload).catch((err) => App.toast(err.message, 'error'));
  if (s) logSongs(memberData.members.find((m) => m.id === Number(s.dataset.msongs)));
});

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
async function markPaid(m, month) {
  const f = m.fees.find((x) => x.month === month) || m.fee;
  if (!confirm(`Record the ${monthLabel(month)} membership fee of ${money(f.part_paid ? f.balance : f.amount)} as paid by ${m.name}?`)) return;
  await App.api(`api/admin/members/${m.id}/payments`, { method: 'POST', body: { month } });
  App.toast(`${monthLabel(month)} fee recorded for ${m.name}`, 'ok');
}
async function changePlan(m, planKey) {
  const p = memberData.plans.find((x) => x.key === planKey);
  await App.api(`api/admin/members/${m.id}`, { method: 'PUT', body: { plan: planKey } });
  App.toast(`${m.name} is now on ${p.name} (${money(planPrice(p))} / month)`, 'ok');
}
// After songs are logged: if the singer is now over their limit, offer the next plan.
async function promptUpgrade(m) {
  if (!m.over_limit || !m.suggested) return false;
  const s = m.suggested;
  App.toast(`⚠ ${m.name} has sung ${m.month_count} songs this month – over the ${m.plan_name} limit of ${m.plan_limit}.`, 'error');
  const paidNow = m.fee.paid > 0 ? `\n\n${monthLabel(m.month)} is already paid (${money(m.fee.paid)}), so ${money(Math.max(0, s.price - m.fee.paid))} more will be due.` : '';
  if (!confirm(`${m.name} has crossed the ${m.plan_name} limit (${m.month_count} of ${m.plan_limit} songs this month).\n\nUpgrade to ${s.name} – ${limitLabel(s.limit)} / month for ${money(s.price)}?${paidNow}`)) return false;
  await changePlan(m, s.key);
  return true;
}

function logSongs(m, after) {
  const today = App.ymd(new Date());
  modal(`Log songs – ${esc(m.name)} (${esc(m.member_no)})`, `
    <div class="form-grid">
      <div class="field"><label>Date sung</label><input type="date" name="sung_on" value="${today}" max="${today}" required></div>
      <div class="field"><label>This month so far</label><div class="readonly-val">${m.month_count} of ${m.plan_limit == null ? 'unlimited' : m.plan_limit} songs (${esc(m.plan_name)})</div></div>
      <div class="field full"><label>Songs – one per line, optionally “Song – Movie/Album”</label>
        <textarea name="songs" required style="min-height:160px" placeholder="Ilaya Nila – Payanangal Mudivathillai&#10;Munbe Vaa – Sillunu Oru Kaadhal&#10;Vaseegara"></textarea></div>
    </div>`, { submitText: 'Save songs', onSubmit: async (f) => {
    const songs = f.songs.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [title, ...rest] = l.split(/\s+[–—-]\s+/);
      return { title: title.trim(), album: rest.join(' - ').trim() };
    });
    if (!songs.length) { App.toast('Add at least one song', 'error'); return false; }
    const r = await App.api(`api/admin/members/${m.id}/songs`, { method: 'POST', body: { sung_on: f.sung_on, songs } });
    App.toast(`${r.added} song${r.added === 1 ? '' : 's'} logged for ${m.name}`, 'ok');
    const done = () => { reload(); if (after) after(); };
    // The plan limit applies to the current month, so only prompt for songs logged in it.
    // Plans move up automatically when the month's songs pass the limit.
    if (r.upgraded) App.toast(`⬆ ${m.name} passed the ${m.plan_name} limit and moved up to ${r.upgraded} automatically`, 'ok');
    done();
  } });
}

function memberForm(m = null) {
  const gender = m ? m.gender : 'Male';
  // Each gender has its own tariff, so the plan list follows the selected gender.
  const opt = (g) => plansOf(g).map((p) => `<option value="${p.key}" ${m && m.plan === p.key ? 'selected' : ''}>${esc(p.name)} – ${limitLabel(p.limit)} – ${money(planPrice(p))}</option>`).join('');
  const v = (k) => esc(m && m[k] ? m[k] : '');
  const genderOpts = GENDERS.map((g) => `<option ${g === gender ? 'selected' : ''}>${g}</option>`).join('');
  const extra = m
    ? `<div class="field"><label>Valid until</label><input name="valid_until" type="date" value="${v('valid_until')}"></div>
       <div class="field"><label>Reset PIN (optional)</label><input name="pin" inputmode="numeric" maxlength="6" placeholder="4–6 digits"></div>`
    : `<div class="field"><label>Start date</label><input name="start_date" type="date" value="${App.ymd(new Date())}"></div>
       <div class="field"><label>PIN</label><input name="pin" inputmode="numeric" maxlength="6" placeholder="Default: last 4 digits of phone"></div>
       <label class="full" style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" name="paid" value="1" checked> First month's fee collected now</label>`;
  const { el } = modal(m ? `Edit ${esc(m.name)}` : 'New member', `
    <div class="form-grid">
      <div class="field"><label>Full name <span class="req">*</span></label><input name="name" required maxlength="80" value="${v('name')}"></div>
      <div class="field"><label>Gender <span class="req">*</span></label><select name="gender">${genderOpts}</select></div>
      <div class="field"><label>Contact number <span class="req">*</span></label><input name="phone" type="tel" required maxlength="20" value="${v('phone')}"></div>
      <div class="field"><label>Email</label><input name="email" type="email" maxlength="120" value="${v('email')}"></div>
      <div class="field"><label>Date of birth</label><input name="dob" type="date" value="${v('dob')}"></div>
      <div class="field"><label>Address</label><input name="address" maxlength="300" value="${v('address')}"></div>
      <div class="field full"><label>Membership plan</label><select name="plan" id="planSel">${opt(gender)}</select></div>
      ${extra}
    </div>`, { submitText: m ? 'Save' : 'Create member', wide: true, onSubmit: async (f) => {
    if (m) {
      await App.api(`api/admin/members/${m.id}`, { method: 'PUT', body: f });
      App.toast('Member updated', 'ok');
      reload();
      openMember(m.id);
    } else {
      const r = await App.api('api/admin/members', { method: 'POST', body: f });
      reload();
      await openMember(r.id);
      App.toast(`Member ${r.member_no} created – login PIN ${r.pin}`, 'ok');
    }
  } });
  // Switching gender swaps in that gender's plans; keep the same position in the list (e.g. Budget -> Budget).
  const g = el.querySelector('[name=gender]'), sel = el.querySelector('#planSel');
  g.addEventListener('change', () => { const i = sel.selectedIndex; sel.innerHTML = opt(g.value); sel.selectedIndex = Math.min(Math.max(i, 0), sel.options.length - 1); });
}
$('newMember').onclick = () => memberForm();

let memberModal = null;
async function openMember(id, month) {
  const d = await App.api(`api/admin/members/${id}`);
  const m = d.member;
  const studio = (state.settings && state.settings.studio_name) || 'Rhythm Rehearsal Studio';
  month = month && d.months.some((x) => x.month === month) ? month : d.months[0].month;
  const songs = d.songs.filter((s) => s.sung_on.startsWith(month)).slice().reverse(); // oldest first
  const lim = month === m.month ? m.plan_limit : null;
  const row = (k, val) => `<div class="sum-row"><span>${k}</span><b>${val}</b></div>`;
  const target = m.requested || m.suggested;
  let alert = '';
  if (m.over_limit && target) {
    alert = `<div class="alert alert-error upgrade-box" style="margin:12px 0 0">
      <span>⚠ ${m.month_count - m.plan_limit} over the ${esc(m.plan_name)} limit${m.requested ? ` · singer asked for <b>${esc(m.requested.name)}</b>` : ''}.</span>
      <button type="button" class="btn btn-primary btn-sm" data-act="upgrade" data-plan="${esc(target.key)}">Upgrade to ${esc(target.name)} · ${money(target.price)}</button></div>`;
  } else if (m.requested) {
    alert = `<div class="alert alert-warn upgrade-box" style="margin:12px 0 0"><span>🙋 Singer asked for <b>${esc(m.requested.name)}</b>.</span>
      <button type="button" class="btn btn-primary btn-sm" data-act="upgrade" data-plan="${esc(m.requested.key)}">Upgrade · ${money(m.requested.price)}</button></div>`;
  }
  const songRows = songs.map((s, i) => `<tr class="${lim != null && i >= lim ? 'over' : ''}"><td class="n">${i + 1}</td>
      <td style="white-space:nowrap">${App.fmtDate(s.sung_on, { day: 'numeric', month: 'short' })}</td>
      <td><b>${esc(s.title)}</b></td><td class="muted">${esc(s.album || '–')}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-delsong="${s.id}" title="Remove" style="color:var(--red)">×</button></td></tr>`).join('');
  const body = `
    <div class="member-modal">
      <div>
        ${MemberCard.html(m, studio)}
        <div class="actions" style="margin-top:12px"><button type="button" class="btn btn-outline btn-sm" data-act="card">⬇ Download card</button></div>
      </div>
      <div>
        ${row('Member no.', esc(m.member_no))}
        ${row('Gender', esc(m.gender))}
        ${row('Contact', `${esc(m.phone)}${m.email ? `<br><small class="muted">${esc(m.email)}</small>` : ''}`)}
        ${row('Plan', `${esc(m.plan_name)} · ${money(m.plan_price)} / month`)}
        ${row('Valid', `${fmtShort(m.start_date)} – ${fmtShort(m.valid_until)} ${m.active ? '' : '<span class="pill unpaid">Expired</span>'}`)}
        <div style="margin-top:12px"><span class="muted" style="font-size:13px">This month (${monthLabel(m.month)})</span>${usageCell(m)}</div>
        ${alert}
        <div class="actions" style="margin-top:14px">
          <button type="button" class="btn btn-primary btn-sm" data-act="songs">+ Log songs</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="edit">Edit details / plan</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="delete" style="color:var(--red)">Delete</button>
        </div>
      </div>
    </div>
    <h4 style="margin:22px 0 10px">Membership fees <span class="muted" style="font-weight:400">· to be paid before the ${ordinal(m.due_day)} of each month</span></h4>
    <table class="song-list"><thead><tr><th>Month</th><th>Fee</th><th>Status</th><th>Paid on</th><th></th></tr></thead><tbody>
      ${m.fees.map((f) => `<tr><td><b>${monthLabel(f.month)}</b></td><td>${money(f.amount)}</td><td>${feePill(f)}</td>
        <td>${f.paid_on ? App.fmtDate(f.paid_on, { day: 'numeric', month: 'short', year: 'numeric' }) : `<span class="muted">Pay before ${App.fmtDate(f.due_date, { day: 'numeric', month: 'short' })}</span>`}</td>
        <td style="text-align:right">${f.status !== 'paid' ? `<button type="button" class="btn btn-green btn-sm" data-pay="${f.month}">Mark paid</button>` : ''}
          ${f.paid_on ? `<button type="button" class="btn btn-ghost btn-sm" data-unpay="${f.month}" title="Undo this payment">Undo</button>` : ''}</td></tr>`).join('')}
    </tbody></table>
    <h4 style="margin:22px 0 10px">Songs sung <span class="muted" style="font-weight:400">· ${d.total} in the last 12 months (records kept 12 months)</span></h4>
    <div class="month-chips">${d.months.map((x) => `<button type="button" class="chip ${x.month === month ? 'on' : ''}" data-month="${x.month}">${monthLabel(x.month, { month: 'short', year: '2-digit' })} <small>${x.count}</small></button>`).join('')}</div>
    ${songs.length ? `<table class="song-list"><thead><tr><th>#</th><th>Date</th><th>Song</th><th>Movie / Album</th><th></th></tr></thead><tbody>${songRows}</tbody></table>`
      : `<div class="empty">No songs in ${monthLabel(month)}.</div>`}`;

  if (memberModal && document.body.contains(memberModal.el)) {
    memberModal.el.querySelector('.modal-head h3').textContent = `${m.name} · ${m.member_no}`;
    memberModal.el.querySelector('.modal-body').innerHTML = body;
  } else {
    memberModal = modal(esc(`${m.name} · ${m.member_no}`), body, { wide: true });
    memberModal.el.querySelector('.modal').style.maxWidth = '880px';
  }
  memberModal.el.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t || t.hasAttribute('data-close')) return;
    try {
      if (t.dataset.month) return openMember(id, t.dataset.month);
      if (t.dataset.pay) { await markPaid(m, t.dataset.pay); reload(); return openMember(id, month); }
      if (t.dataset.unpay) {
        if (!confirm(`Undo the ${monthLabel(t.dataset.unpay)} payment for ${m.name}?`)) return;
        await App.api(`api/admin/members/${id}/payments/${t.dataset.unpay}`, { method: 'DELETE' });
        reload();
        return openMember(id, month);
      }
      if (t.dataset.delsong) {
        if (!confirm('Remove this song from the record?')) return;
        await App.api(`api/admin/members/${id}/songs/${t.dataset.delsong}`, { method: 'DELETE' });
        reload();
        return openMember(id, month);
      }
      switch (t.dataset.act) {
        case 'card': return MemberCard.download(m, studio);
        case 'songs': return logSongs(m, () => openMember(id));
        case 'edit': memberModal.close(); return memberForm(m);
        case 'upgrade': await changePlan(m, t.dataset.plan); reload(); return openMember(id, month);
        case 'delete':
          if (!confirm(`Delete ${m.name} (${m.member_no}) and all their song records?`)) return;
          await App.api(`api/admin/members/${id}`, { method: 'DELETE' });
          memberModal.close();
          App.toast('Member deleted', 'ok');
          return reload();
        default: return undefined;
      }
    } catch (err) { App.toast(err.message, 'error'); }
  };
}

function drawPlansForm() {
  const group = (g) => {
    const list = plansOf(g), last = list.length - 1;
    return `<tr class="plans-group"><th colspan="3">${g} singers</th></tr>` + list.map((p, i) => `<tr data-key="${esc(p.key)}">
      <td><input data-k="name" value="${esc(p.name)}" maxlength="30" required></td>
      <td><input data-k="limit" type="number" min="1" value="${p.limit == null ? '' : p.limit}" ${i === last ? 'placeholder="Unlimited"' : 'required'}></td>
      <td><input data-k="price" type="number" min="0" value="${p.price}" required></td>
    </tr>`).join('');
  };
  $('plansTable').innerHTML = `<thead><tr><th>Plan name</th><th>Songs / month</th><th>Price / month (${esc(cur())})</th></tr></thead><tbody>
    ${GENDERS.map(group).join('')}</tbody>`;
  $('dueDay').value = memberData.due_day;
}
$('plansForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const plans = [...$('plansTable').querySelectorAll('tbody tr[data-key]')].map((tr) => ({ key: tr.dataset.key,
    ...Object.fromEntries([...tr.querySelectorAll('input')].map((i) => [i.dataset.k, i.dataset.k === 'limit' && i.value === '' ? null : i.value])) }));
  try {
    await App.api('api/admin/membership-plans', { method: 'PUT', body: { plans, due_day: $('dueDay').value } });
    App.toast('Plans saved – prices and limits are updated everywhere', 'ok');
    loadMembers();
  } catch (err) { App.toast(err.message, 'error'); }
});

boot().catch((e) => App.toast(e.message, 'error'));

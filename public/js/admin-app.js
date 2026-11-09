// Studio admin app (installable, phone-first). Quick daily jobs natively: dashboard, weekly event
// (open/close, who's in, take out, line-up on the spot, publish, count), fees (confirm UPI payments,
// WhatsApp reminders), singers (log songs, mark paid) and bookings (approve, cancel, paid).
// Everything else opens the full admin page inside the app.
const $ = (id) => document.getElementById(id);
const esc = App.esc;
let settings = {}, cache = {};

const money = (n) => App.money(n, settings.currency || '₹');
const dShort = (x) => App.fmtDate(x, { day: 'numeric', month: 'short' });
const dDay = (x) => App.fmtDate(x, { weekday: 'short', day: 'numeric', month: 'short' });
const monthName = (ym, o = { month: 'long', year: 'numeric' }) => new Date(ym + '-01T00:00').toLocaleDateString('en-IN', o);
const waNum = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };
const wa = (phone, text) => `https://wa.me/${waNum(phone)}?text=${encodeURIComponent(text)}`;
const first = (n) => String(n || '').split(' ')[0];
const today = () => App.ymd(new Date());
// Studio-specific features switched on in Admin → Settings → Features (no feature = always on).
const on = (f) => !f || settings['show_' + f] === '1';

const VIEWS = {
  home: { title: 'Dashboard', render: viewHome },
  event: { title: 'Weekly event', render: viewEvent, feat: 'weekly_event' },
  lineup: { title: 'Line-up', render: viewLineup, nav: 'event', feat: 'weekly_event' },
  fees: { title: 'Fees & payments', render: viewFees, feat: 'membership' },
  members: { title: 'Singers', render: viewMembers, feat: 'membership' },
  bookings: { title: 'Bookings', render: viewBookings },
  full: { title: 'All admin tools', frame: 'admin.html' },
};

// ---------- start / login ----------
async function boot() {
  settings = await App.settings().catch(() => ({}));
  App.applyFeatures(settings);
  const { admin, demo } = await App.api('api/admin/me').catch(() => ({ admin: false }));
  $('demoHint').classList.toggle('hidden', !demo);
  $('forgotLink').classList.toggle('hidden', !!demo);
  $('loginScreen').classList.toggle('hidden', admin);
  $('shell').classList.toggle('hidden', !admin);
  if (admin) { await loadAll(); route(); }
}

async function loadAll() {
  const [members, bookings, events] = await Promise.all([
    App.api('api/admin/members'), App.api('api/admin/bookings'), App.api('api/admin/events'),
  ]);
  cache = { members: members.members, plans: members.plans, bookings, events: events.events };
  const claims = cache.members.filter((m) => m.claims && m.claims.length).length;
  const pending = bookings.filter((b) => b.status === 'pending').length;
  $('feeCount').textContent = claims || '';
  $('bookCount').textContent = pending || '';
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('loginError');
  try {
    await App.api('api/admin/login', { method: 'POST', body: { username: $('aUser').value, password: $('aPw').value } });
    err.classList.add('hidden'); $('aPw').value = '';
    await boot();
  } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
});
App.eyes($('loginForm'));
$('forgotLink').onclick = async (e) => {
  e.preventDefault();
  if (!confirm('Send a password reset link to the admin email?')) return;
  try {
    const r = await App.api('api/admin/forgot', { method: 'POST' });
    alert(`A reset link has been sent to ${r.to}.\n\nOpen the email and tap "Set a new admin password". The link works for 30 minutes. Check the spam folder if you don't see it.`);
  } catch (err) { alert(err.message); }
};

// ---------- navigation ----------
function route() {
  if ($('shell').classList.contains('hidden')) return;
  const want = VIEWS[location.hash.slice(1).split('/')[0]];
  const key = want && on(want.feat) ? location.hash.slice(1).split('/')[0] : 'home';
  const v = VIEWS[key];
  $('viewTitle').textContent = v.title;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (v.nav || key)));
  closeDrawer();
  const frame = $('frame');
  if (v.frame) {
    $('view').classList.add('hidden'); frame.classList.remove('hidden');
    if (!frame.src) frame.src = v.frame;
  } else {
    frame.classList.add('hidden'); $('view').classList.remove('hidden');
    $('view').innerHTML = '<div class="app-loading">Loading…</div>';
    Promise.resolve(v.render()).catch((ex) => {
      if (ex.status === 401) return boot();
      $('view').innerHTML = `<div class="alert alert-error">${esc(ex.message)}</div>`;
      return undefined;
    });
    window.scrollTo(0, 0);
  }
}
window.addEventListener('hashchange', route);
const openDrawer = () => { document.body.classList.add('drawer-open'); $('scrim').hidden = false; $('menuBtn').setAttribute('aria-expanded', 'true'); };
function closeDrawer() { document.body.classList.remove('drawer-open'); $('scrim').hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); }
$('menuBtn').onclick = () => (document.body.classList.contains('drawer-open') ? closeDrawer() : openDrawer());
$('scrim').onclick = closeDrawer;
$('reloadBtn').onclick = async () => { await loadAll(); route(); App.toast('Up to date', 'ok'); };
let tx = null;
document.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (tx == null) return;
  const dx = e.changedTouches[0].clientX - tx;
  if (tx < 24 && dx > 60) openDrawer(); else if (document.body.classList.contains('drawer-open') && dx < -60) closeDrawer();
  tx = null;
}, { passive: true });
$('themeBtn').onclick = () => {
  const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('sb-theme', r.dataset.theme); } catch { /* storage blocked */ }
};
$('logoutBtn').onclick = async () => { await App.api('api/admin/logout', { method: 'POST' }).catch(() => {}); location.hash = ''; boot(); };

// Bottom sheet for quick forms.
function sheet(title, html, onSubmit, submitText = 'Save') {
  const bg = document.createElement('div');
  bg.className = 'app-sheet-bg';
  bg.innerHTML = `<form class="app-sheet" novalidate><div class="app-sheet-head"><h3>${title}</h3><button type="button" data-close aria-label="Close">×</button></div>${html}
    ${onSubmit ? `<button class="btn btn-primary btn-lg btn-block" style="margin-top:14px">${submitText}</button>` : ''}</form>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  bg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button.btn-primary'); if (btn) btn.disabled = true;
    try { if ((await onSubmit(Object.fromEntries(new FormData(e.target)), e.target)) !== false) close(); } catch (ex) { App.toast(ex.message, 'error'); } finally { if (btn) btn.disabled = false; }
  });
  return bg;
}

// ---------- current event ----------
function currentEventRow() {
  const t = today(), list = cache.events || [];
  return list.filter((e) => !e.done && e.event_date >= t).sort((a, b) => a.event_date.localeCompare(b.event_date))[0]
    || list.find((e) => !e.done) || list[0] || null;
}

// ---------- Dashboard ----------
function viewHome() {
  const t = today();
  const claims = cache.members.filter((m) => m.claims && m.claims.length);
  const unpaid = cache.members.filter((m) => m.fee.status !== 'paid');
  const overdue = unpaid.filter((m) => m.fee.status === 'overdue');
  const upgrades = cache.members.filter((m) => m.requested);
  const pending = cache.bookings.filter((b) => b.status === 'pending');
  const todays = cache.bookings.filter((b) => b.date === t && b.status !== 'cancelled');
  const ev = currentEventRow();
  const slot = (s) => (App.slotInfo(settings)[s] || {}).name || s;
  $('view').innerHTML = `
    <section class="app-hello"><h2>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'} 👋</h2><p>${dDay(t)}</p></section>
    <section class="app-stats ${on('membership') ? 'app-stats-4' : ''}">
      ${on('membership') ? `<a href="#fees"><small>Payments to confirm</small><b>${claims.length}</b><span>UPI "I've paid"</span></a>
      <a href="#fees"><small>Fees unpaid</small><b>${unpaid.length}</b><span>${overdue.length} overdue</span></a>` : ''}
      <a href="#bookings"><small>Bookings to approve</small><b>${pending.length}</b><span>${todays.length} today</span></a>
      ${on('membership') ? `<a href="#members"><small>Singers</small><b>${cache.members.length}</b><span>${upgrades.length} upgrade request${upgrades.length === 1 ? '' : 's'}</span></a>` : ''}
    </section>
    ${!on('weekly_event') ? '' : ev ? `<section class="app-card"><div class="app-card-head"><h3>🎤 ${esc(ev.title)}</h3><a href="#event">Manage ›</a></div>
      <p class="muted" style="margin:0 0 10px">📅 ${dDay(ev.event_date)}${ev.event_time ? ` · ${esc(ev.event_time)}` : ''}</p>
      <div class="app-row">${ev.done ? '<span class="app-pill ok">✔ Counted</span>' : ev.voting_open ? '<span class="app-pill ok">Open for singers</span>' : '<span class="app-pill">Closed</span>'}
        ${ev.published ? '<span class="app-pill ok">Line-up published</span>' : '<span class="app-pill warn">Line-up not published</span>'}</div>
      <div class="app-weeks" style="margin-top:12px"><div><small>In</small><b>${ev.going}</b></div><div><small>Out</small><b>${ev.not_going}</b></div><div><small>Sent songs</small><b>${ev.sent_songs}</b></div><div><small>Line-up</small><b>${ev.lineup}</b></div></div></section>`
      : '<section class="app-card"><h3>🎤 No event yet</h3><a class="btn btn-primary btn-block" href="#event">Create this week\'s event</a></section>'}
    ${on('membership') && claims.length ? `<section class="app-card"><div class="app-card-head"><h3>💰 Confirm payments</h3><a href="#fees">All ›</a></div>${claims.slice(0, 3).map(claimRow).join('')}</section>` : ''}
    ${todays.length || pending.length ? `<section class="app-card"><div class="app-card-head"><h3>📅 Bookings</h3><a href="#bookings">All ›</a></div>
      ${[...pending, ...todays.filter((b) => b.status !== 'pending')].slice(0, 4).map((b) => `<div class="app-item"><div><b>${esc(b.name)}</b><small>${dDay(b.date)} · ${esc(slot(b.slot))}</small></div><span class="app-pill ${b.status === 'pending' ? 'warn' : 'ok'}">${b.status === 'pending' ? 'To approve' : 'Today'}</span></div>`).join('')}</section>` : ''}
    ${on('membership') && upgrades.length ? `<section class="app-card"><h3>⭐ Upgrade requests</h3>${upgrades.map((m) => `<div class="app-item"><div><b>${esc(m.name)}</b><small>${esc(m.plan_name)} → ${esc(m.requested.name)} · ${m.month_count} songs this month</small></div><a class="btn btn-ghost btn-sm" href="#full">Open</a></div>`).join('')}</section>` : ''}`;
}

// ---------- Fees & payments ----------
function claimRow(m) {
  const c = m.claims[0];
  return `<div class="app-item"><div><b>${esc(m.name)}</b><small>${monthName(c.month, { month: 'short', year: 'numeric' })} · ${money(c.amount)} · UTR ${esc(c.ref)}</small></div>
    <div class="app-actions"><button type="button" class="btn btn-green btn-sm" data-confirm="${m.id}" data-month="${c.month}">✓ Paid</button><button type="button" class="btn btn-ghost btn-sm" data-reject="${m.id}" data-month="${c.month}" aria-label="Reject">✕</button></div></div>`;
}

function viewFees() {
  const claims = cache.members.filter((m) => m.claims && m.claims.length);
  const unpaid = cache.members.filter((m) => m.fee_due > 0).sort((a, b) => (b.fee.status === 'overdue') - (a.fee.status === 'overdue') || b.fee_due - a.fee_due);
  const paid = cache.members.filter((m) => m.fee.status === 'paid');
  const total = cache.members.reduce((a, m) => a + (m.fee.status === 'paid' ? m.fee.amount : 0), 0);
  const msg = (m) => `Hi ${first(m.name)}, a gentle reminder from Manik’s Demo Website: your membership fee of ${money(m.fee_due)} (${monthName(m.fee.month)}) is due before ${dShort(m.fee.due_date)}. Pay by GPay/UPI to ${settings.upi_id || 'demo@upi'} or in the app: ${new URL('app.html#pay', location.href).href}\nThank you! 🎤`;
  $('view').innerHTML = `
    <section class="app-stats"><div><small>${monthName(cache.members[0] ? cache.members[0].month : today().slice(0, 7), { month: 'long' })} collected</small><b>${money(total)}</b><span>${paid.length} paid</span></div>
      <div><small>Still to pay</small><b>${unpaid.length}</b><span>${money(unpaid.reduce((a, m) => a + m.fee_due, 0))}</span></div></section>
    <section class="app-card"><h3>💰 Payments to confirm <small class="muted">${claims.length}</small></h3>
      ${claims.length ? claims.map(claimRow).join('') : '<p class="muted" style="margin:0">Nothing waiting. When a singer taps "I\'ve paid" it shows here – check the UTR in your GPay and tap ✓ Paid.</p>'}</section>
    <section class="app-card"><h3>⏳ Unpaid <small class="muted">${unpaid.length}</small></h3>
      ${unpaid.length ? unpaid.map((m) => `<div class="app-item"><div><b>${esc(m.name)}</b><small class="${m.fee.status === 'overdue' ? 'bad' : ''}">${money(m.fee_due)} · ${m.fee.status === 'overdue' ? 'overdue' : `due ${dShort(m.fee.due_date)}`}</small></div>
        <div class="app-actions"><a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${wa(m.phone, msg(m))}">💬 Remind</a><button type="button" class="btn btn-ghost btn-sm" data-markpaid="${m.id}">Paid</button></div></div>`).join('')
        : '<p class="muted" style="margin:0">Everyone has paid 🎉</p>'}</section>`;
}

async function confirmPay(id, month) {
  await App.api(`api/admin/members/${id}/payments`, { method: 'POST', body: { month } });
  App.toast('Payment recorded', 'ok');
  await loadAll(); route();
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-confirm],[data-reject],[data-markpaid],[data-logsongs],[data-member],[data-bk],[data-takeout],[data-putback]');
  if (!t || !($('view').contains(t) || t.closest('.app-sheet'))) return;
  try {
    if (t.dataset.confirm) return await confirmPay(t.dataset.confirm, t.dataset.month);
    if (t.dataset.reject) {
      if (!confirm('Remove this payment note? (Only if you can\'t find the payment in GPay.)')) return undefined;
      await App.api(`api/admin/members/${t.dataset.reject}/claims/${t.dataset.month}`, { method: 'DELETE' });
      App.toast('Payment note removed', 'ok'); await loadAll(); return route();
    }
    if (t.dataset.markpaid) {
      const m = cache.members.find((x) => x.id === Number(t.dataset.markpaid));
      const months = m.fees.filter((f) => f.status !== 'paid');
      return sheet(`Mark paid – ${esc(m.name)}`, `<label class="ev-label">Month</label><select class="ev-input" name="month">${months.map((f) => `<option value="${f.month}">${monthName(f.month)} – ${money(f.balance)}</option>`).join('')}</select>
        <p class="muted app-small">Cash or UPI received – this records the fee as paid today.</p>`, (f) => confirmPay(m.id, f.month), 'Mark as paid');
    }
    if (t.dataset.logsongs) return logSongs(cache.members.find((x) => x.id === Number(t.dataset.logsongs)));
    if (t.dataset.member) return memberSheet(cache.members.find((x) => x.id === Number(t.dataset.member)));
    if (t.dataset.bk) return bookingAction(Number(t.dataset.bk), t.dataset.act);
    if (t.dataset.takeout) return takeOut(Number(t.dataset.takeout));
    if (t.dataset.putback) {
      await App.api(`api/admin/events/${evData.event.id}/votes/${t.dataset.putback}`, { method: 'PUT', body: { going: true } });
      App.toast('Put back in', 'ok'); return refreshEvent();
    }
  } catch (ex) { App.toast(ex.message, 'error'); }
  return undefined;
});

// ---------- Singers ----------
let memberQuery = '';
function viewMembers() {
  const q = memberQuery.toLowerCase();
  const list = cache.members.filter((m) => !q || `${m.name} ${m.member_no} ${m.phone}`.toLowerCase().includes(q));
  $('view').innerHTML = `<input class="ev-input app-search" id="mq" type="search" placeholder="🔍 Search name, number or RRS no." value="${esc(memberQuery)}">
    <section class="app-card">${list.map((m) => `<button type="button" class="app-item app-item-btn" data-member="${m.id}"><div><b>${esc(m.name)}</b><small>${esc(m.member_no)} · ${m.gender === 'Female' ? '♀' : '♂'} ${esc(m.plan_name)} · ${m.month_count}${m.plan_limit == null ? '' : `/${m.plan_limit}`} songs</small></div>
      <span class="app-pill ${m.fee.status === 'paid' ? 'ok' : m.fee.status === 'overdue' ? 'bad' : 'warn'}">${m.fee.status === 'paid' ? 'Paid' : m.fee.status === 'overdue' ? 'Overdue' : 'Due'}</span></button>`).join('') || '<p class="muted" style="margin:0">No singers found.</p>'}</section>`;
  const inp = $('mq');
  inp.oninput = () => { memberQuery = inp.value; const pos = inp.selectionStart; viewMembers(); $('mq').focus(); $('mq').setSelectionRange(pos, pos); };
}

function memberSheet(m) {
  sheet(esc(m.name), `<p class="muted" style="margin:0 0 10px">${esc(m.member_no)} · ${esc(m.gender)} · ${esc(m.phone)}</p>
    <div class="app-weeks"><div><small>Plan</small><b style="font-size:15px">${esc(m.plan_name)}</b></div><div><small>Songs</small><b>${m.month_count}</b><small class="muted">${m.plan_limit == null ? 'unlimited' : `of ${m.plan_limit}`}</small></div><div><small>Fee</small><b style="font-size:15px">${m.fee.status === 'paid' ? '✅' : money(m.fee_due)}</b></div></div>
    ${m.requested ? `<div class="alert alert-warn" style="margin:10px 0 0">Asked to upgrade to <b>${esc(m.requested.name)}</b> – change the plan in All admin tools → Members.</div>` : ''}
    <div class="app-grid2" style="margin-top:14px">
      <a class="btn btn-ghost" href="tel:${esc(String(m.phone).replace(/\s/g, ''))}">📞 Call</a>
      <a class="btn btn-ghost" target="_blank" rel="noopener" href="${wa(m.phone, `Hi ${first(m.name)}, `)}">💬 WhatsApp</a>
      <button type="button" class="btn btn-ghost" data-close data-logsongs="${m.id}">🎵 Log songs</button>
      ${m.fee_due > 0 ? `<button type="button" class="btn btn-ghost" data-close data-markpaid="${m.id}">💰 Mark paid</button>` : '<span></span>'}
    </div>`, null);
}
function logSongs(m) {
  sheet(`Log songs – ${esc(m.name)}`, `<label class="ev-label">Date sung</label><input class="ev-input" type="date" name="sung_on" value="${today()}" max="${today()}">
    <label class="ev-label">Songs – one per line (Song – Movie)</label><textarea class="ev-input" name="songs" rows="6" placeholder="Ilaya Nila – Payanangal Mudivathillai&#10;Munbe Vaa"></textarea>
    <p class="muted app-small">${m.month_count} songs this month${m.plan_limit == null ? '' : ` of ${m.plan_limit}`}. For event songs, use the line-up instead – they're counted automatically.</p>`, async (f) => {
    const songs = f.songs.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [title, ...rest] = l.split(/\s+[–-]\s+/); return { title, album: rest.join(' – ') }; });
    if (!songs.length) { App.toast('Add at least one song', 'error'); return false; }
    const r = await App.api(`api/admin/members/${m.id}/songs`, { method: 'POST', body: { sung_on: f.sung_on, songs } });
    App.toast(`${r.added} song${r.added === 1 ? '' : 's'} added${r.upgraded ? ` · moved up to ${r.upgraded}` : ''}`, 'ok');
    await loadAll(); route();
    return true;
  }, 'Add songs');
}

// ---------- Bookings ----------
let bookTab = 'pending';
function viewBookings() {
  const t = today(), slot = (s) => (App.slotInfo(settings)[s] || {}).name || s;
  const groups = {
    pending: cache.bookings.filter((b) => b.status === 'pending').sort((a, b) => a.date.localeCompare(b.date)),
    upcoming: cache.bookings.filter((b) => b.status === 'approved' && b.date >= t).sort((a, b) => a.date.localeCompare(b.date)),
    past: cache.bookings.filter((b) => b.date < t || b.status === 'cancelled').slice(0, 40),
  };
  const list = groups[bookTab];
  $('view').innerHTML = `<div class="app-chips">${[['pending', 'To approve'], ['upcoming', 'Upcoming'], ['past', 'Past & cancelled']].map(([k, l]) => `<button type="button" class="chip ${k === bookTab ? 'on' : ''}" data-btab="${k}">${l} <small>${groups[k].length}</small></button>`).join('')}</div>
    <section class="app-card">${list.length ? list.map((b) => `<div class="app-booking">
      <div class="app-item" style="border:0;padding:0"><div><b>${esc(b.name)}</b><small>${dDay(b.date)} · ${esc(slot(b.slot))} · ${esc(b.ref)}</small><small>${money(b.amount)} · ${b.payment_status === 'paid' ? '<span class="ok">paid</span>' : 'unpaid'}${b.status === 'cancelled' ? ' · <span class="bad">cancelled</span>' : ''}</small></div>
        <a class="btn btn-ghost btn-sm" href="tel:${esc(String(b.phone || '').replace(/\s/g, ''))}">📞</a></div>
      <div class="app-actions" style="margin-top:8px">${b.status === 'pending' ? `<button type="button" class="btn btn-green btn-sm" data-bk="${b.id}" data-act="approve">✓ Approve</button>` : ''}
        ${b.status !== 'cancelled' && b.payment_status !== 'paid' ? `<button type="button" class="btn btn-ghost btn-sm" data-bk="${b.id}" data-act="paid">💰 Paid</button>` : ''}
        ${b.status !== 'cancelled' && b.date >= t ? `<button type="button" class="btn btn-ghost btn-sm" data-bk="${b.id}" data-act="cancel" style="color:var(--red)">Cancel</button>` : ''}
        <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${wa(b.phone, `Hi ${first(b.name)}, about your booking ${b.ref} on ${dDay(b.date)}: `)}">💬</a></div></div>`).join('')
      : '<p class="muted" style="margin:0">Nothing here.</p>'}</section>`;
  $('view').querySelector('.app-chips').onclick = (e) => { const b = e.target.closest('[data-btab]'); if (b) { bookTab = b.dataset.btab; viewBookings(); } };
}

async function bookingAction(id, act) {
  if (act === 'cancel' && !confirm('Cancel this booking? The customer is emailed if they gave an email.')) return;
  const body = act === 'approve' ? { status: 'approved' } : act === 'cancel' ? { status: 'cancelled' } : { payment_status: 'paid' };
  await App.api(`api/admin/bookings/${id}`, { method: 'PATCH', body });
  App.toast(act === 'approve' ? 'Booking approved' : act === 'cancel' ? 'Booking cancelled' : 'Marked as paid', 'ok');
  await loadAll(); route();
}

// ---------- Weekly event ----------
let evData = null;
async function refreshEvent() { await loadAll(); route(); }

async function viewEvent() {
  const row = currentEventRow();
  if (!row) {
    $('view').innerHTML = `<section class="app-card"><h3>Create this week's event</h3>${eventFormHtml({})}</section>`;
    return bindEventForm(null);
  }
  evData = await App.api(`api/admin/events/${row.id}`);
  const e = evData.event, ins = evData.votes.filter((v) => v.going), outs = evData.votes.filter((v) => !v.going);
  const link = new URL(`event.html?id=${e.id}`, location.href).href;
  const when = `📅 ${dDay(e.event_date)}${e.event_time ? ` · ⏰ ${e.event_time}` : ''}${e.venue ? `\n📍 ${e.venue}` : ''}`;
  const msgs = {
    invite: `🎤 *${e.title}*\n${when}\n\nSinging this week? Tap the link, press *I'm in* and add your songs:\n${link}`,
    remind: `⏰ Reminder: *${e.title}* (${dDay(e.event_date)}) – if you're singing, tap I'm in and add your songs:\n${link}`,
    lineup: `📋 The line-up for *${e.title}* is ready! See your songs here:\n${link}`,
  };
  const share = (t) => `https://wa.me/?text=${encodeURIComponent(t)}`;
  const songsOf = (id) => evData.choices.filter((c) => c.member_id === id).length;
  const lu = {};
  for (const r of evData.lineup) for (const id of [r.male_id, r.female_id]) if (id) lu[id] = (lu[id] || 0) + 1;
  $('view').innerHTML = `
    <section class="app-card"><div class="app-ev-title"><b>${esc(e.title)}</b><small>${esc(when).replace('\n', '<br>')}</small></div>
      ${(cache.events || []).filter((x) => !x.done).length > 1 ? '<p class="muted app-small" style="margin:0 0 8px">Showing the next event. Other events: All admin tools → Weekly Events.</p>' : ''}
      <label class="app-switch"><input type="checkbox" data-flag="voting_open" ${e.voting_open ? 'checked' : ''}><span><b>Open for singers</b><small>Singers tap I'm in and add songs</small></span></label>
      <label class="app-switch"><input type="checkbox" data-flag="published" ${e.published ? 'checked' : ''}><span><b>Line-up published</b><small>Each singer sees only their own songs</small></span></label>
      <div class="app-grid2" style="margin-top:12px">
        <a class="btn btn-green btn-sm" target="_blank" rel="noopener" href="${share(msgs.invite)}">📣 Invite</a>
        <a class="btn btn-green btn-sm" target="_blank" rel="noopener" href="${share(msgs.remind)}">⏰ Reminder</a>
        <a class="btn btn-green btn-sm" target="_blank" rel="noopener" href="${share(msgs.lineup)}">📋 Line-up ready</a>
        <button type="button" class="btn btn-ghost btn-sm" id="copyLink">🔗 Copy link</button>
      </div></section>
    <a class="app-card app-link-card" href="#lineup">🎵 <span><b>Line-up · ${evData.lineup.length} song${evData.lineup.length === 1 ? '' : 's'}</b><br><small class="muted">Change pairs on the spot – songs are counted at 00:01 after the event</small></span><span>›</span></a>
    <section class="app-card"><h3>✅ In <small class="muted">${ins.length} · ${ins.filter((v) => v.gender === 'Male').length}♂ ${ins.filter((v) => v.gender === 'Female').length}♀</small></h3>
      ${ins.map((m) => `<div class="app-item"><div><b>${esc(m.name)}</b><small>${m.gender === 'Female' ? '♀' : '♂'} ${songsOf(m.id)} song${songsOf(m.id) === 1 ? '' : 's'} sent · ${lu[m.id] || 0} in line-up</small></div><button type="button" class="btn btn-ghost btn-sm" data-takeout="${m.id}" style="color:var(--red)">Take out</button></div>`).join('') || '<p class="muted" style="margin:0">Nobody yet – send the invite.</p>'}</section>
    ${outs.length ? `<section class="app-card"><h3>🙅 Out <small class="muted">${outs.length}</small></h3>${outs.map((m) => `<div class="app-item"><div><b>${esc(m.name)}</b><small>${m.admin_out ? `Taken out${m.note ? `: “${esc(m.note)}”` : ''}` : 'Not this week'}</small></div><button type="button" class="btn btn-ghost btn-sm" data-putback="${m.id}">Put back</button></div>`).join('')}</section>` : ''}
    <section class="app-card"><h3>Finish</h3><p class="muted app-small" style="margin-top:0">${e.done ? '✔ Songs counted. Changing the line-up re-counts automatically.' : 'Songs are counted from the final line-up automatically at 00:01 after the event.'}</p>
      ${e.event_date <= today() ? `<button type="button" class="btn btn-dark btn-block" id="countNow">${e.done ? 'Count again' : 'Count songs now'}</button>` : ''}
      <details style="margin-top:12px"><summary>Edit event details</summary>${eventFormHtml(e)}</details>
      <button type="button" class="btn btn-ghost btn-block" id="newEv" style="margin-top:10px">+ New event</button></section>`;
  $('view').querySelectorAll('[data-flag]').forEach((cb) => { cb.onchange = async () => {
    try { await App.api(`api/admin/events/${e.id}`, { method: 'PUT', body: { [cb.dataset.flag]: cb.checked } }); App.toast('Saved', 'ok'); await loadAll(); } catch (ex) { App.toast(ex.message, 'error'); cb.checked = !cb.checked; }
  }; });
  $('copyLink').onclick = () => navigator.clipboard.writeText(link).then(() => App.toast('Link copied', 'ok'));
  const cn = $('countNow');
  if (cn) cn.onclick = async () => { try { const r = await App.api(`api/admin/events/${e.id}/finish`, { method: 'POST' }); App.toast(`${r.songs} songs counted for ${r.singers} singers`, 'ok'); refreshEvent(); } catch (ex) { App.toast(ex.message, 'error'); } };
  $('newEv').onclick = () => { sheet('New event', eventFormHtml({}), null); bindEventForm(null, document.querySelector('.app-sheet')); };
  bindEventForm(e);
  return undefined;
}

const nextSunday = () => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return App.ymd(d); };
const eventFormHtml = (e) => `<div class="app-evform">
  <label class="ev-label">Title</label><input class="ev-input" data-ef="title" value="${esc(e.title || 'Weekly Karaoke Night')}">
  <label class="ev-label">Date</label><input class="ev-input" type="date" data-ef="event_date" value="${esc(e.event_date || nextSunday())}">
  <label class="ev-label">Time</label><input class="ev-input" data-ef="event_time" value="${esc(e.event_time || '')}" placeholder="6:30 PM">
  <label class="ev-label">Venue</label><input class="ev-input" data-ef="venue" value="${esc(e.venue || 'Manik’s Demo Website')}">
  <label class="ev-label">Notes for singers</label><textarea class="ev-input" data-ef="notes" rows="2">${esc(e.notes || '')}</textarea>
  ${e.id ? `<label class="ev-label">Video link (Google Drive)</label><input class="ev-input" data-ef="video_link" value="${esc(e.video_link || '')}" placeholder="https://drive.google.com/…">` : ''}
  <button type="button" class="btn btn-primary btn-block" data-efsave style="margin-top:12px">${e.id ? 'Save details' : 'Create event'}</button></div>`;
function bindEventForm(e, root = $('view')) {
  const box = root.querySelector('.app-evform:last-of-type') || root;
  const btn = [...root.querySelectorAll('[data-efsave]')].pop();
  btn.onclick = async () => {
    const body = {}; btn.closest('.app-evform').querySelectorAll('[data-ef]').forEach((i) => { body[i.dataset.ef] = i.value; });
    try {
      if (e) await App.api(`api/admin/events/${e.id}`, { method: 'PUT', body });
      else await App.api('api/admin/events', { method: 'POST', body });
      App.toast(e ? 'Event saved' : 'Event created – send the invite', 'ok');
      document.querySelectorAll('.app-sheet-bg').forEach((x) => x.remove());
      refreshEvent();
    } catch (ex) { App.toast(ex.message, 'error'); }
  };
  return box;
}

function takeOut(id) {
  const m = evData.votes.find((v) => v.id === id), e = evData.event;
  sheet(`Take ${esc(first(m.name))} out`, `<p style="margin-top:0">${esc(m.name)} is removed from this week (and from the line-up) and sees your message on the event page.</p>
    <label class="ev-label">Message</label><textarea class="ev-input" name="note" rows="3" maxlength="300" placeholder="Sorry, the list is full this week – see you next Sunday!"></textarea>
    <label class="app-check"><input type="checkbox" name="wa" value="1" checked> Also send it on WhatsApp</label>`, async (f) => {
    await App.api(`api/admin/events/${e.id}/votes/${id}`, { method: 'PUT', body: { going: false, admin_out: true, note: f.note } });
    if (f.wa) window.open(wa(m.phone, `Hi ${first(m.name)}, about ${e.title} (${dDay(e.event_date)}): ${f.note || "you've been taken off this week's list."}\n\n– Manik’s Demo Website`), '_blank', 'noopener');
    App.toast(`${m.name} taken out`, 'ok'); refreshEvent();
  }, 'Take out');
}

// ---------- Line-up on the phone ----------
let lu = null;
async function viewLineup() {
  if (!evData || evData.event.id !== (currentEventRow() || {}).id) { const row = currentEventRow(); if (!row) { location.hash = 'event'; return; } evData = await App.api(`api/admin/events/${row.id}`); }
  if (!lu || lu.eventId !== evData.event.id) lu = { eventId: evData.event.id, rows: evData.lineup.map((r) => ({ a: r.male_id || '', b: r.female_id || '', title: r.title, album: r.album || '' })) };
  drawLineup();
}
function drawLineup() {
  const ins = evData.votes.filter((v) => v.going), others = [...evData.votes.filter((v) => !v.going), ...evData.silent];
  const opt = (list, sel) => list.map((m) => `<option value="${m.id}" ${String(sel) === String(m.id) ? 'selected' : ''}>${esc(m.name)} ${m.gender === 'Female' ? '♀' : '♂'}</option>`).join('');
  const sel = (k, i, v) => `<select class="ev-input" data-lu="${k}" data-i="${i}"><option value="">— ${k === 'a' ? 'singer' : 'partner / solo'} —</option><optgroup label="In this week">${opt(ins, v)}</optgroup>${others.length ? `<optgroup label="Replacement (not marked in)">${opt(others, v)}</optgroup>` : ''}</select>`;
  const sugg = [...new Set(evData.choices.map((c) => c.title))];
  $('view').innerHTML = `<p class="muted app-small" style="margin:0">This is the final pairing list – songs are counted from it at 00:01 after the event. If someone doesn't turn up, change the dropdown and save.</p>
    <datalist id="luSongs">${sugg.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
    ${lu.rows.map((r, i) => `<section class="app-card app-lu"><div class="app-lu-head"><b>#${i + 1}</b><button type="button" class="ev-x" data-lurm="${i}" aria-label="Remove">×</button></div>
      ${sel('a', i, r.a)}${sel('b', i, r.b)}
      <input class="ev-input" data-lu="title" data-i="${i}" list="luSongs" placeholder="Song" value="${esc(r.title)}">
      <input class="ev-input" data-lu="album" data-i="${i}" placeholder="Movie (optional)" value="${esc(r.album)}"></section>`).join('')}
    <button type="button" class="btn btn-ghost btn-block" id="luAdd">+ Add song</button>
    <div class="app-sticky"><button type="button" class="btn btn-outline" id="luSave">Save</button><button type="button" class="btn btn-primary" id="luPub">${evData.event.published ? 'Save & keep published' : 'Save & publish'}</button></div>`;
  $('view').oninput = $('view').onchange = (e) => { const el = e.target.closest('[data-lu]'); if (el) lu.rows[Number(el.dataset.i)][el.dataset.lu] = el.value; };
  $('view').querySelectorAll('[data-lurm]').forEach((b) => { b.onclick = () => { lu.rows.splice(Number(b.dataset.lurm), 1); drawLineup(); }; });
  $('luAdd').onclick = () => { lu.rows.push({ a: '', b: '', title: '', album: '' }); drawLineup(); window.scrollTo(0, document.body.scrollHeight); };
  const save = async (publish) => {
    const rows = lu.rows.filter((r) => r.a || r.b || r.title).map((r) => ({ male: r.a, female: r.b, title: r.title, album: r.album }));
    try {
      const r = await App.api(`api/admin/events/${evData.event.id}/lineup`, { method: 'PUT', body: { rows, ...(publish ? { publish: true } : {}) } });
      if (!r.ok) return App.toast(r.errors.join(' · '), 'error');
      App.toast(`Line-up saved – ${r.rows} songs${r.recounted ? ' · counts updated' : ''}`, 'ok');
      lu = null; evData = null; await loadAll(); location.hash = 'event';
    } catch (ex) { App.toast(ex.message, 'error'); }
    return undefined;
  };
  $('luSave').onclick = () => save(false);
  $('luPub').onclick = () => save(true);
}

// ---------- install ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; document.querySelectorAll('[data-install]').forEach((b) => b.classList.remove('hidden')); });
if (!(matchMedia('(display-mode: standalone)').matches || navigator.standalone) && /iphone|ipad|ipod/i.test(navigator.userAgent)) document.querySelectorAll('[data-install]').forEach((b) => b.classList.remove('hidden'));
document.querySelectorAll('[data-install]').forEach((b) => b.addEventListener('click', async () => {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; return; }
  alert('To add the admin app on iPhone:\n\n1. Tap the Share button in Safari\n2. Choose "Add to Home Screen"\n3. Tap Add');
}));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

boot().catch((e) => App.toast(e.message, 'error'));

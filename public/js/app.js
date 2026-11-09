// Singer app (installable, phone-first): login, then a dashboard with a left menu.
// Native views: Home, My songs, Membership & fees, My details. The weekly event, booking and gallery
// open the existing pages inside the app (without the website header/footer).
const $ = (id) => document.getElementById(id);
const esc = App.esc;
let me = null, plansPub = null, settings = {}, songMonth = null;

const monthName = (ym, o = { month: 'long', year: 'numeric' }) => new Date(ym + '-01T00:00').toLocaleDateString('en-IN', o);
const dShort = (x) => App.fmtDate(x, { day: 'numeric', month: 'short' });
const songsText = (l) => (l == null ? 'Unlimited songs' : `Up to ${l} songs / month`);
const money = (n) => App.money(n, (plansPub && plansPub.currency) || '₹');

const VIEWS = {
  home: { title: 'Home', render: viewHome },
  event: { title: 'Weekly event', frame: 'event.html' },
  songs: { title: 'My songs', render: viewSongs },
  membership: { title: 'Membership', render: viewMembership },
  book: { title: 'Book the studio', frame: 'book.html' },
  gallery: { title: 'Gallery', frame: 'gallery.html' },
  profile: { title: 'My details', render: viewProfile },
};

// ---------- start ----------
async function boot() {
  App.settings().then((s) => { settings = s; document.querySelectorAll('[data-wa]').forEach((a) => { a.href = 'https://wa.me/' + (s.whatsapp || ''); }); }).catch(() => {});
  plansPub = await App.api('api/membership/plans').catch(() => null);
  try { me = await App.api('api/member/me'); } catch (e) { me = null; if (e.status !== 401) App.toast(e.message, 'error'); }
  $('loginScreen').classList.toggle('hidden', !!me);
  $('shell').classList.toggle('hidden', !me);
  if (!me) return;
  const m = me.member;
  $('drawerName').textContent = m.name;
  $('drawerSub').textContent = `${m.member_no} · ${m.plan_name}`;
  $('avatarBtn').textContent = m.name.trim().charAt(0).toUpperCase();
  route();
}

async function refreshMe() { me = await App.api('api/member/me'); }

// ---------- navigation ----------
function route() {
  if (!me) return;
  const key = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'home';
  const v = VIEWS[key];
  $('viewTitle').textContent = v.title;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === key));
  closeDrawer();
  const frame = $('frame');
  if (v.frame) {
    $('view').classList.add('hidden');
    frame.classList.remove('hidden');
    const src = new URL(v.frame + '?embed=1', location.href).href;
    if (frame.dataset.src !== src) { frame.dataset.src = src; frame.src = src; }
  } else {
    frame.classList.add('hidden');
    $('view').classList.remove('hidden');
    $('view').innerHTML = '<div class="app-loading">Loading…</div>';
    Promise.resolve(v.render()).catch((e) => { $('view').innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; });
    window.scrollTo(0, 0);
  }
}
window.addEventListener('hashchange', route);

const openDrawer = () => { document.body.classList.add('drawer-open'); $('scrim').hidden = false; $('menuBtn').setAttribute('aria-expanded', 'true'); };
function closeDrawer() { document.body.classList.remove('drawer-open'); $('scrim').hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); }
$('menuBtn').onclick = () => (document.body.classList.contains('drawer-open') ? closeDrawer() : openDrawer());
$('scrim').onclick = closeDrawer;
$('avatarBtn').onclick = () => { location.hash = 'profile'; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
// Swipe from the left edge opens the menu; swipe left closes it.
let tx = null;
document.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (tx == null || !me) return;
  const dx = e.changedTouches[0].clientX - tx;
  if (tx < 24 && dx > 60) openDrawer();
  else if (document.body.classList.contains('drawer-open') && dx < -60) closeDrawer();
  tx = null;
}, { passive: true });

$('themeBtn').onclick = () => {
  const r = document.documentElement;
  r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('sb-theme', r.dataset.theme); } catch { /* storage blocked */ }
};
$('logoutBtn').onclick = async () => {
  await App.api('api/member/logout', { method: 'POST' }).catch(() => {});
  me = null; location.hash = ''; boot();
};

// ---------- login ----------
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target)), err = $('loginError');
  if (!body.member_no || !body.pin) { err.textContent = 'Enter your mobile number and PIN.'; err.classList.remove('hidden'); return; }
  try {
    await App.api('api/member/login', { method: 'POST', body });
    err.classList.add('hidden'); e.target.reset();
    await boot();
  } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
});

// ---------- Home ----------
function usageBlock(m) {
  const lim = m.plan_limit;
  const pct = lim == null ? 100 : Math.min(100, (m.month_count / lim) * 100);
  const cls = m.over_limit ? ' over' : m.remaining != null && m.remaining <= 3 ? ' warn' : '';
  return `<div class="app-usage"><div class="app-usage-num"><b>${m.month_count}</b><span>${lim == null ? 'songs · unlimited' : `of ${lim} songs`}</span></div>
    <div class="meter${cls}"><span style="width:${pct}%"></span></div>
    <small class="muted">${lim == null ? 'Sing as much as you like.' : m.over_limit ? `${m.month_count - lim} over your ${esc(m.plan_name)} limit` : `${m.remaining} left in ${monthName(m.month, { month: 'long' })}`}</small></div>`;
}

function feeLine(m) {
  const f = m.fee;
  if (f.status === 'paid') return `<div class="app-pill ok">✅ ${monthName(f.month, { month: 'long' })} fee paid</div>`;
  return `<a class="app-pill ${f.status === 'overdue' ? 'bad' : 'warn'}" href="#membership">${f.status === 'overdue' ? '⚠️ Overdue' : '⏳ Due'}: ${money(m.fee_due || f.balance)} · pay before ${dShort(f.due_date)} <b>Pay ›</b></a>`;
}

async function viewHome() {
  const m = me.member;
  const ev = await App.api('api/events/current').then((r) => r.event).catch(() => null);
  let evHtml = '<p class="muted" style="margin:0">No event posted yet – watch the WhatsApp group.</p>';
  if (ev) {
    const my = ev.me || {};
    const status = my.removed ? '<span class="app-pill bad">Not in this week</span>'
      : my.vote === 'yes' ? '<span class="app-pill ok">✅ You\'re in</span>' : my.vote === 'no' ? '<span class="app-pill">Not this week</span>'
        : ev.open ? '<span class="app-pill warn">Not answered yet</span>' : '<span class="app-pill">Closed</span>';
    const nSongs = my.choices ? (my.choices.solo || []).length + (my.choices.duet || []).length : 0;
    const lu = ev.published && my.vote === 'yes' && my.lineup ? my.lineup : null;
    evHtml = `<div class="app-ev-title"><b>${esc(ev.title)}</b><small>📅 ${esc(App.fmtDate(ev.event_date, { weekday: 'short', day: 'numeric', month: 'short' }))}${ev.event_time ? ` · ${esc(ev.event_time)}` : ''}</small></div>
      <div class="app-row">${status}<small class="muted">${ev.going_count} singer${ev.going_count === 1 ? '' : 's'} in${my.vote === 'yes' ? ` · ${nSongs} song${nSongs === 1 ? '' : 's'} sent` : ''}</small></div>
      ${lu ? `<ul class="app-lineup">${lu.map((r) => { const partner = r.male_id === m.id ? r.female_name : r.male_name; return `<li><b>${esc(r.title)}</b><small>${r.male_id && r.female_id ? `with ${esc(partner)}` : 'Solo'}</small></li>`; }).join('')}</ul>` : ''}
      <a class="btn btn-primary btn-block" href="#event" style="margin-top:12px">${ev.open && !my.removed ? (my.vote ? 'Change my songs' : 'I\'m in – add songs') : 'Open event'}</a>`;
  }
  $('view').innerHTML = `
    <section class="app-hello"><h2>Hi ${esc(m.name.split(' ')[0])} 👋</h2><p>${esc(m.member_no)} · ${esc(m.plan_name)} plan</p></section>
    <section class="app-card"><div class="app-card-head"><h3>This month</h3><a href="#songs">My songs ›</a></div>${usageBlock(m)}
      ${m.over_limit && m.suggested ? `<div class="alert alert-warn" style="margin:12px 0 0">You've passed your ${esc(m.plan_name)} limit – you'll move to <b>${esc(m.suggested.name)}</b>.</div>` : ''}
      <div style="margin-top:12px">${feeLine(m)}</div></section>
    <section class="app-card"><div class="app-card-head"><h3>🎤 This week</h3>${ev && ev.video_link ? `<a href="${esc(ev.video_link)}" target="_blank" rel="noopener">🎬 Videos</a>` : ''}</div>${evHtml}</section>
    <section class="app-tiles">
      <a href="#event"><span>🎤</span>Weekly event</a>
      <a href="#songs"><span>🎵</span>My songs</a>
      <a href="#membership"><span>💳</span>Pay fee</a>
      <a href="#book"><span>📅</span>Book studio</a>
    </section>`;
}

// ---------- My songs ----------
function viewSongs() {
  const m = me.member;
  songMonth = songMonth && me.months.some((x) => x.month === songMonth) ? songMonth : me.months[0].month;
  const list = me.songs.filter((s) => s.sung_on.startsWith(songMonth)).slice().reverse();
  const weeks = [0, 0, 0, 0, 0];
  for (const s of list) weeks[Math.min(4, Math.floor((Number(s.sung_on.slice(8)) - 1) / 7))]++;
  const lastDay = new Date(Number(songMonth.slice(0, 4)), Number(songMonth.slice(5, 7)), 0).getDate();
  const lim = songMonth === m.month ? m.plan_limit : null;
  $('view').innerHTML = `
    <div class="app-chips" role="tablist">${me.months.map((x) => `<button type="button" class="chip ${x.month === songMonth ? 'on' : ''}" data-month="${x.month}">${monthName(x.month, { month: 'short', year: '2-digit' })} <small>${x.count}</small></button>`).join('')}</div>
    <section class="app-card"><div class="app-card-head"><h3>${monthName(songMonth)}</h3><b class="app-big">${list.length}</b></div>
      <div class="app-weeks">${weeks.slice(0, lastDay > 28 ? 5 : 4).map((n, i) => `<div><small>Wk ${i + 1}</small><b>${n}</b><small class="muted">${i * 7 + 1}–${Math.min(lastDay, i * 7 + 7)}</small></div>`).join('')}</div>
      ${songMonth === m.month ? usageBlock(m) : ''}</section>
    <section class="app-card">${list.length ? `<ol class="app-songs">${list.map((s, i) => `<li class="${lim != null && i >= lim ? 'over' : ''}"><span class="n">${i + 1}</span><span><b>${esc(s.title)}</b><small>${esc(s.album || '')}</small></span><small class="muted">${dShort(s.sung_on)}</small></li>`).join('')}</ol>`
      : `<p class="muted" style="margin:0">No songs in ${monthName(songMonth)} yet. Songs are added after each event from the final line-up.</p>`}</section>
    <p class="muted app-small">${me.total} song${me.total === 1 ? '' : 's'} in the last 12 months.</p>`;
  $('view').querySelector('.app-chips').onclick = (e) => { const b = e.target.closest('[data-month]'); if (b) { songMonth = b.dataset.month; viewSongs(); } };
}

// ---------- Membership & fees ----------
function viewMembership() {
  const m = me.member, f = m.fee;
  const plans = me.plans || [];
  const feeMsg = f.status === 'paid'
    ? `<div class="alert alert-ok" style="margin:0">✅ ${monthName(f.month)} fee of <b>${money(f.amount)}</b> paid on ${dShort(f.paid_on)}.</div>`
    : `<div class="alert ${f.status === 'overdue' ? 'alert-error' : 'alert-warn'}" style="margin:0">${f.status === 'overdue' ? '⚠️' : '⏳'} ${monthName(f.month)} fee <b>${money(f.balance)}</b> – ${f.status === 'overdue' ? 'was due' : 'please pay'} before <b>${dShort(f.due_date)}</b>.</div>`;
  const pa = settings.upi_id || '9962258845@okbizaxis';
  const q = new URLSearchParams({ pa, pn: settings.upi_name || settings.studio_name || 'Rhythm Rehearsal Studio', am: String(m.fee_due || 0), cu: 'INR', tn: `${m.member_no} fee ${f.month}` });
  const claim = m.claims && m.claims[0];
  $('view').innerHTML = `
    <section class="app-card-slot" id="cardSlot"></section>
    <p class="muted app-small" style="text-align:center">${m.active ? `Valid until <b>${App.fmtDate(m.valid_until, { day: 'numeric', month: 'short', year: 'numeric' })}</b>` : `Expired on ${App.fmtDate(m.valid_until, { day: 'numeric', month: 'short', year: 'numeric' })}`} · <a href="#" id="dlCard">⬇ Save card</a></p>
    <section class="app-card"><h3>Monthly fee</h3>${feeMsg}
      ${m.fee_due > 0 ? `<div class="app-pay">
        <a class="btn btn-primary btn-lg btn-block" href="upi://pay?${q.toString().replace(/\+/g, '%20')}">Pay ${money(m.fee_due)} with UPI</a>
        <details><summary>Show QR code</summary><img src="img/upi-qr.png" alt="UPI QR code" class="pay-qr" width="520" height="790"><p class="muted app-small">UPI ID: <b>${esc(pa)}</b></p></details>
        <form id="claimForm" novalidate><label class="ev-label" for="utr">Paid? Enter the UPI transaction ID (UTR)</label>
          <div class="app-row"><input class="ev-input" id="utr" inputmode="numeric" maxlength="40" placeholder="12-digit UTR"><button class="btn btn-green">I've paid</button></div></form>
        ${claim ? `<div class="alert alert-ok" style="margin:10px 0 0">⏳ Payment note sent (UTR <b>${esc(claim.ref)}</b>). The studio will confirm it.</div>` : ''}</div>` : ''}
      <ul class="app-fees">${m.fees.map((x) => `<li><span>${monthName(x.month, { month: 'short', year: 'numeric' })}</span><span>${money(x.amount)}</span>
        <span class="${x.status === 'paid' ? 'ok' : x.status === 'overdue' ? 'bad' : 'warn'}">${x.status === 'paid' ? `Paid ${dShort(x.paid_on)}` : x.status === 'overdue' ? 'Overdue' : `Due ${dShort(x.due_date)}`}</span></li>`).join('')}</ul></section>
    <section class="app-card"><h3>Plans</h3><ul class="app-plans">${plans.map((p) => `<li class="${p.key === m.plan ? 'on' : ''}"><span><b>${esc(p.name)}</b><small>${songsText(p.limit)}</small></span><b>${money(p.price)}</b>${p.key === m.plan ? '<em>Your plan</em>' : ''}</li>`).join('')}</ul>
      <p class="muted app-small" style="margin-bottom:0">If you sing more than your plan allows, you move up to the next plan automatically.</p></section>`;
  $('cardSlot').innerHTML = MemberCard.html(m, settings.studio_name || 'Rhythm Rehearsal Studio');
  $('dlCard').onclick = (e) => { e.preventDefault(); MemberCard.download(m, settings.studio_name || 'Rhythm Rehearsal Studio'); };
  const cf = $('claimForm');
  if (cf) cf.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await App.api('api/member/payment-claim', { method: 'POST', body: { ref: $('utr').value.replace(/\s+/g, ''), month: f.status !== 'paid' ? f.month : undefined } });
      App.toast('Thank you! The studio will confirm your payment.', 'ok');
      await refreshMe(); viewMembership();
    } catch (ex) { App.toast(ex.message, 'error'); }
  };
}

// ---------- My details ----------
function viewProfile() {
  const m = me.member;
  $('view').innerHTML = `<form class="app-card" id="profileForm" novalidate><h3>My details</h3>
    <label class="ev-label">Full name</label><input class="ev-input" name="name" maxlength="80" value="${esc(m.name)}">
    <label class="ev-label">Mobile number</label><input class="ev-input" name="phone" type="tel" maxlength="20" value="${esc(m.phone || '')}">
    <label class="ev-label">Email</label><input class="ev-input" name="email" type="email" maxlength="120" value="${esc(m.email || '')}">
    <label class="ev-label">Date of birth</label><input class="ev-input" name="dob" type="date" value="${esc(m.dob || '')}">
    <label class="ev-label">Address</label><input class="ev-input" name="address" maxlength="300" value="${esc(m.address || '')}">
    <label class="ev-label">New PIN (optional)</label><input class="ev-input" name="new_pin" type="password" inputmode="numeric" maxlength="6" placeholder="4–6 digits" autocomplete="new-password">
    <p class="muted app-small">${esc(m.gender)} · member since ${App.fmtDate(m.start_date, { month: 'short', year: 'numeric' })}. Ask the studio to change your gender or plan.</p>
    <button class="btn btn-primary btn-lg btn-block">Save</button></form>`;
  App.eyes($('profileForm'));
  $('profileForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await App.api('api/member/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      App.toast('Your details are saved', 'ok');
      await refreshMe(); boot();
    } catch (ex) { App.toast(ex.message, 'error'); }
  };
}

// Pages inside the app: keep the dashboard in sync when the singer changes their event songs.
$('frame').addEventListener('load', () => { refreshMe().catch(() => {}); });

// ---------- install (add to home screen) ----------
let installEvt = null;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); installEvt = e;
  document.querySelectorAll('[data-install]').forEach((b) => b.classList.remove('hidden'));
});
if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) document.querySelectorAll('[data-install]').forEach((b) => b.classList.remove('hidden'));
document.querySelectorAll('[data-install]').forEach((b) => b.addEventListener('click', async () => {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; document.querySelectorAll('[data-install]').forEach((x) => x.classList.add('hidden')); return; }
  alert('To add the app on iPhone:\n\n1. Tap the Share button (square with an arrow) in Safari\n2. Choose "Add to Home Screen"\n3. Tap Add');
}));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

boot().catch((e) => App.toast(e.message, 'error'));

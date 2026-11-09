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
  home: { title: 'Dashboard', render: viewHome },
  event: { title: 'Weekly event', render: viewEvent },
  'event-edit': { title: 'My event songs', frame: 'event.html', nav: 'event' },
  songs: { title: 'My songs', render: viewSongs },
  pay: { title: 'Payments', render: viewPay },
  plans: { title: 'Plans', render: viewPlans },
  book: { title: 'Book the studio', frame: 'book.html' },
  gallery: { title: 'Gallery', frame: 'gallery.html' },
  profile: { title: 'My profile', render: viewProfile },
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
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (v.nav || key)));
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

// ---------- shared bits ----------
function usageBlock(m) {
  const lim = m.plan_limit;
  const pct = lim == null ? 100 : Math.min(100, (m.month_count / lim) * 100);
  const cls = m.over_limit ? ' over' : m.remaining != null && m.remaining <= 3 ? ' warn' : '';
  return `<div class="app-usage"><div class="app-usage-num"><b>${m.month_count}</b><span>${lim == null ? 'songs this month · unlimited' : `of ${lim} songs this month`}</span></div>
    <div class="meter${cls}"><span style="width:${pct}%"></span></div>
    <small class="muted">${lim == null ? 'Sing as much as you like.' : m.over_limit ? `${m.month_count - lim} over your ${esc(m.plan_name)} limit` : `${m.remaining} left in ${monthName(m.month, { month: 'long' })}`}</small></div>`;
}

function feeLine(m) {
  const f = m.fee;
  if (f.status === 'paid') return `<div class="app-pill ok">✅ ${monthName(f.month, { month: 'long' })} fee paid</div>`;
  return `<a class="app-pill ${f.status === 'overdue' ? 'bad' : 'warn'}" href="#pay">${f.status === 'overdue' ? '⚠️ Overdue' : '⏳ Due'}: ${money(m.fee_due || f.balance)} · before ${dShort(f.due_date)} <b>Pay ›</b></a>`;
}

// Songs per week of a month (days 1–7, 8–14, …).
function weekCounts(ym) {
  const list = me.songs.filter((s) => s.sung_on.startsWith(ym));
  const weeks = [0, 0, 0, 0, 0];
  for (const s of list) weeks[Math.min(4, Math.floor((Number(s.sung_on.slice(8)) - 1) / 7))]++;
  const lastDay = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
  return { list, weeks: weeks.slice(0, lastDay > 28 ? 5 : 4), lastDay };
}
const weekGrid = (wc, current = -1) => `<div class="app-weeks">${wc.weeks.map((n, i) => `<div class="${i === current ? 'now' : ''}"><small>Wk ${i + 1}</small><b>${n}</b><small class="muted">${i * 7 + 1}–${Math.min(wc.lastDay, i * 7 + 7)}</small></div>`).join('')}</div>`;

// The plans above the singer's current one, with what each extra rupee buys.
function upgradeLadder(m, withButtons) {
  const plans = me.plans || [];
  const i = plans.findIndex((p) => p.key === m.plan);
  const cur = plans[i];
  const up = plans.slice(i + 1);
  if (!cur || !up.length) return `<div class="app-top-plan">🏆 You're on <b>${esc(m.plan_name)}</b> – our top plan. Sing as much as you like!</div>`;
  const perSong = (p) => (p.limit ? Math.round(p.price / p.limit) : null);
  return `<ul class="app-ladder">${up.map((p) => {
    const extraSongs = p.limit == null ? 'Unlimited songs' : `+${p.limit - (cur.limit || 0)} songs a month`;
    const extraPay = p.price - cur.price;
    const ps = perSong(p);
    const requested = m.requested && m.requested.key === p.key;
    return `<li><div><b>${esc(p.name)}</b> <small>${songsText(p.limit)}</small>
        <span class="app-benefit">${extraSongs} for just ${money(extraPay)} more${ps ? ` · only ${money(ps)} per song` : ' · no limits at all'}</span></div>
      ${withButtons ? (requested ? '<span class="app-pill ok">Requested ✓</span>' : `<button type="button" class="btn btn-primary btn-sm" data-upgrade="${esc(p.key)}">Upgrade</button>`) : ''}</li>`;
  }).join('')}</ul>`;
}

async function requestUpgrade(key) {
  try {
    await App.api('api/member/upgrade-request', { method: 'POST', body: { plan: key } });
    App.toast('Upgrade request sent – the studio will confirm it', 'ok');
    await refreshMe(); route();
  } catch (ex) { App.toast(ex.message, 'error'); }
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-upgrade]'); if (b) { b.disabled = true; requestUpgrade(b.dataset.upgrade); } });

const currentEvent = () => App.api('api/events/current').then((r) => r.event).catch(() => null);

// ---------- Dashboard ----------
async function viewHome() {
  const m = me.member;
  const wc = weekCounts(m.month);
  const wk = Math.min(wc.weeks.length - 1, Math.floor((new Date().getDate() - 1) / 7));
  const ev = await currentEvent();
  const my = (ev && ev.me) || {};
  const plans = me.plans || [];
  const next = plans[plans.findIndex((p) => p.key === m.plan) + 1];
  $('view').innerHTML = `
    <section class="app-hello"><h2>Hi ${esc(m.name.split(' ')[0])} 👋</h2><p>${esc(m.member_no)} · ${monthName(m.month)}</p></section>
    <section class="app-stats">
      <div><small>This week</small><b>${wc.weeks[wk]}</b><span>song${wc.weeks[wk] === 1 ? '' : 's'} · Wk ${wk + 1}</span></div>
      <div><small>This month</small><b>${m.month_count}</b><span>${m.plan_limit == null ? 'unlimited' : `of ${m.plan_limit}`}</span></div>
    </section>
    <section class="app-card"><div class="app-card-head"><h3>Songs by week</h3><a href="#songs">All songs ›</a></div>
      ${weekGrid(wc, wk)}${usageBlock(m)}</section>
    <section class="app-card"><div class="app-card-head"><h3>My plan</h3><a href="#plans">Plans ›</a></div>
      <div class="app-plan-now"><b>${esc(m.plan_name)}</b><span>${songsText(m.plan_limit)} · ${money(m.plan_price)} / month</span></div>
      <div style="margin-top:10px">${feeLine(m)}</div></section>
    ${next ? `<section class="app-card app-promo"><div class="app-card-head"><h3>🚀 Sing more for less</h3></div>
      <p style="margin:0 0 4px">${m.over_limit ? `You've already sung <b>${m.month_count}</b> songs this month!` : 'Love singing? Go bigger:'}</p>${upgradeLadder(m, false)}
      <a class="btn btn-primary btn-block" href="#plans" style="margin-top:12px">See upgrade options</a></section>`
      : `<section class="app-card">${upgradeLadder(m, false)}</section>`}
    <section class="app-card"><div class="app-card-head"><h3>🎤 This week's event</h3><a href="#event">Open ›</a></div>
      ${ev ? `<div class="app-ev-title"><b>${esc(ev.title)}</b><small>📅 ${esc(App.fmtDate(ev.event_date, { weekday: 'short', day: 'numeric', month: 'short' }))}${ev.event_time ? ` · ${esc(ev.event_time)}` : ''}</small></div>
        ${eventStatus(ev, my)}` : '<p class="muted" style="margin:0">No event posted yet – watch the WhatsApp group.</p>'}</section>`;
}

function eventStatus(ev, my) {
  const st = my.removed ? '<span class="app-pill bad">Not in this week</span>'
    : my.vote === 'yes' ? '<span class="app-pill ok">✅ You\'re in</span>' : my.vote === 'no' ? '<span class="app-pill">Not this week</span>'
      : ev.open ? '<span class="app-pill warn">Not answered yet</span>' : '<span class="app-pill">Entries closed</span>';
  return `<div class="app-row">${st}<small class="muted">${ev.going_count} singer${ev.going_count === 1 ? '' : 's'} in</small></div>`;
}

// ---------- Weekly event: my songs sent, my line-up, edit ----------
async function viewEvent() {
  const ev = await currentEvent();
  if (!ev) { $('view').innerHTML = '<section class="app-card"><h3>No event yet</h3><p class="muted" style="margin:0">The studio posts each week\'s event in the WhatsApp group.</p></section>'; return; }
  const my = ev.me || {}, m = me.member;
  const ch = my.choices || { solo: [], duet: [] };
  const songList = (arr) => (arr.length ? `<ol class="app-songs">${arr.map((s, i) => `<li><span class="n">${i + 1}</span><span><b>${esc(s.title)}</b><small>${esc(s.album || '')}</small></span><span></span></li>`).join('')}</ol>` : '<p class="muted" style="margin:6px 0 0">None</p>');
  const lu = ev.published && my.vote === 'yes' ? my.lineup || [] : null;
  const canEdit = ev.open && !my.removed;
  $('view').innerHTML = `
    <section class="app-card"><div class="app-ev-title"><b>${esc(ev.title)}</b><small>📅 ${esc(App.fmtDate(ev.event_date, { weekday: 'long', day: 'numeric', month: 'short' }))}${ev.event_time ? ` · ⏰ ${esc(ev.event_time)}` : ''}${ev.venue ? `<br>📍 ${esc(ev.venue)}` : ''}</small></div>
      ${ev.notes ? `<p class="app-note">${esc(ev.notes)}</p>` : ''}
      ${eventStatus(ev, my)}
      ${my.removed && my.note ? `<div class="alert alert-warn" style="margin:10px 0 0">💬 ${esc(my.note)}</div>` : ''}
      ${canEdit ? `<a class="btn btn-primary btn-block btn-lg" href="#event-edit" style="margin-top:14px">${my.vote ? '✏️ Change my answer / songs' : '🎤 I\'m in – add my songs'}</a>` : ''}</section>
    <section class="app-card"><div class="app-card-head"><h3>🎵 Line-up – my songs</h3>${lu ? `<small class="muted">${lu.length}</small>` : ''}</div>
      ${lu ? (lu.length ? `<ul class="app-lineup">${lu.map((r) => { const partner = r.male_id === m.id ? r.female_name : r.male_name; return `<li><span><b>${esc(r.title)}</b><small class="muted"> ${esc(r.album || '')}</small></span><small>${r.male_id && r.female_id ? `with <b>${esc(partner)}</b>` : 'Solo'}</small></li>`; }).join('')}</ul>`
        : '<p class="muted" style="margin:0">No songs assigned to you yet.</p>')
        : `<p class="muted" style="margin:0">${my.vote === 'yes' ? 'The studio will publish the line-up before the event – your songs and partners show here.' : 'Tap I\'m in to be part of the line-up.'}</p>`}</section>
    ${my.vote === 'yes' ? `<section class="app-card"><h3>📝 Songs I sent</h3>
      <h4 class="app-sub">🎙️ Solo</h4>${songList(ch.solo || [])}<h4 class="app-sub">🎶 Duet</h4>${songList(ch.duet || [])}</section>` : ''}
    ${ev.video_link ? `<a class="app-card app-link-card" href="${esc(ev.video_link)}" target="_blank" rel="noopener">🎬 <span><b>Videos</b><br><small class="muted">Watch this week's videos</small></span><span>›</span></a>` : ''}`;
}

// ---------- My songs ----------
function viewSongs() {
  const m = me.member;
  songMonth = songMonth && me.months.some((x) => x.month === songMonth) ? songMonth : me.months[0].month;
  const wc = weekCounts(songMonth);
  const list = wc.list.slice().reverse();
  const lim = songMonth === m.month ? m.plan_limit : null;
  $('view').innerHTML = `
    <div class="app-chips" role="tablist">${me.months.map((x) => `<button type="button" class="chip ${x.month === songMonth ? 'on' : ''}" data-month="${x.month}">${monthName(x.month, { month: 'short', year: '2-digit' })} <small>${x.count}</small></button>`).join('')}</div>
    <section class="app-card"><div class="app-card-head"><h3>${monthName(songMonth)}</h3><b class="app-big">${list.length}</b></div>${weekGrid(wc)}</section>
    <section class="app-card">${list.length ? `<ol class="app-songs">${list.map((s, i) => `<li class="${lim != null && i >= lim ? 'over' : ''}"><span class="n">${i + 1}</span><span><b>${esc(s.title)}</b><small>${esc(s.album || '')}</small></span><small class="muted">${dShort(s.sung_on)}</small></li>`).join('')}</ol>`
      : `<p class="muted" style="margin:0">No songs in ${monthName(songMonth)} yet. Songs are added after each event from the final line-up.</p>`}</section>
    <p class="muted app-small">${me.total} song${me.total === 1 ? '' : 's'} in the last 12 months.</p>`;
  $('view').querySelector('.app-chips').onclick = (e) => { const b = e.target.closest('[data-month]'); if (b) { songMonth = b.dataset.month; viewSongs(); } };
}

// ---------- Payments ----------
function upiLink(m) {
  const pa = settings.upi_id || '9962258845@okbizaxis';
  const l = App.upiLinks({ pa, pn: settings.upi_name || settings.studio_name || 'Rhythm Rehearsal Studio', am: m.fee_due || m.plan_price, tn: `${m.member_no} fee ${m.fee.month}` });
  return { pa, ...l, href: l.any };
}

// QR always visible; on a phone the buttons open GPay / any UPI app with the amount filled in.
function payBlock(m, amount) {
  const u = upiLink(m);
  return `<div class="app-qr"><img src="img/upi-qr-code.png" alt="UPI QR code for Rhythm Rehearsal Studio" width="436" height="436"><small>UPI ID: <b>${esc(u.pa)}</b></small></div>
    ${u.mobile ? `<a class="btn btn-gpay btn-lg btn-block" href="${u.gpay}" data-gpay="${u.any}">Pay ${money(amount)} with <b>GPay</b></a>
      <a class="btn btn-outline btn-block" href="${u.any}">Other UPI app (PhonePe, Paytm…)</a>`
      : '<p class="muted app-small" style="text-align:center;margin:0">Scan the QR with GPay or any UPI app on your phone.</p>'}`;
}

function viewPay() {
  const m = me.member, f = m.fee;
  const claim = m.claims && m.claims[0];
  const feeMsg = f.status === 'paid'
    ? `<div class="alert alert-ok" style="margin:0">✅ ${monthName(f.month)} fee of <b>${money(f.amount)}</b> paid on ${dShort(f.paid_on)}.</div>`
    : `<div class="alert ${f.status === 'overdue' ? 'alert-error' : 'alert-warn'}" style="margin:0">${f.status === 'overdue' ? '⚠️' : '⏳'} ${monthName(f.month)} fee <b>${money(f.balance)}</b> – ${f.status === 'overdue' ? 'was due' : 'please pay'} before <b>${dShort(f.due_date)}</b>.</div>`;
  $('view').innerHTML = `
    <section class="app-card"><h3>This month</h3>${feeMsg}
      ${m.fee_due > 0 ? `<div class="app-pay">
        ${payBlock(m, m.fee_due)}
        <form id="claimForm" novalidate><label class="ev-label" for="utr">Paid? Enter the UPI transaction ID (UTR)</label>
          <div class="app-row"><input class="ev-input" id="utr" inputmode="numeric" maxlength="40" placeholder="12-digit UTR"><button class="btn btn-green">I've paid</button></div></form>
        ${claim ? `<div class="alert alert-ok" style="margin:0">⏳ Payment note sent (UTR <b>${esc(claim.ref)}</b>). The studio will confirm it.</div>` : ''}</div>` : ''}</section>
    <section class="app-card"><h3>Payment history</h3>
      <ul class="app-fees">${m.fees.map((x) => `<li><span>${monthName(x.month, { month: 'short', year: 'numeric' })}</span><span>${money(x.amount)}</span>
        <span class="${x.status === 'paid' ? 'ok' : x.status === 'overdue' ? 'bad' : 'warn'}">${x.status === 'paid' ? `Paid ${dShort(x.paid_on)}` : x.status === 'overdue' ? 'Overdue' : `Due ${dShort(x.due_date)}`}</span></li>`).join('')}</ul></section>`;
  const cf = $('claimForm');
  if (cf) cf.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await App.api('api/member/payment-claim', { method: 'POST', body: { ref: $('utr').value.replace(/\s+/g, ''), month: f.status !== 'paid' ? f.month : undefined } });
      App.toast('Thank you! The studio will confirm your payment.', 'ok');
      await refreshMe(); viewPay();
    } catch (ex) { App.toast(ex.message, 'error'); }
  };
}

// ---------- Plans: pricing, upgrade benefits, payment options ----------
function viewPlans() {
  const m = me.member, plans = me.plans || [];
  const dueDay = (plansPub && plansPub.due_day) || 10;
  $('view').innerHTML = `
    <section class="app-card"><h3>${m.gender === 'Female' ? '👩 Women\'s' : '👨 Men\'s'} membership plans</h3>
      <ul class="app-plans">${plans.map((p) => `<li class="${p.key === m.plan ? 'on' : ''}"><span><b>${esc(p.name)}</b><small>${songsText(p.limit)}${p.limit ? ` · ${money(Math.round(p.price / p.limit))} per song` : ''}</small></span><b>${money(p.price)}<small>/month</small></b>${p.key === m.plan ? '<em>Your plan</em>' : ''}</li>`).join('')}</ul>
      <p class="muted app-small" style="margin-bottom:0">Songs are counted per calendar month. Sing past your limit and you move up to the next plan automatically.</p></section>
    <section class="app-card app-promo"><h3>🚀 Upgrade benefits</h3>${upgradeLadder(m, true)}</section>
    <section class="app-card"><h3>How to pay</h3>
      <div class="app-pay">${payBlock(m, m.fee_due || m.plan_price)}</div>
      <ul class="app-howpay" style="margin-top:8px"><li><span>💵</span><div><b>Cash at the studio</b><small>Pay at the front desk on any event day</small></div></li></ul>
      <p class="muted app-small" style="margin-bottom:0">Fees are due before the ${dueDay}th of each month. After paying by UPI, enter the UTR in <a href="#pay">Payments</a>.</p></section>`;
}

// ---------- My profile: card, details, PIN ----------
function viewProfile() {
  const m = me.member;
  $('view').innerHTML = `
    <section class="app-card-slot" id="cardSlot"></section>
    <p class="muted app-small" style="text-align:center;margin:0">${m.active ? `Valid until <b>${App.fmtDate(m.valid_until, { day: 'numeric', month: 'short', year: 'numeric' })}</b>` : `Expired on ${App.fmtDate(m.valid_until, { day: 'numeric', month: 'short', year: 'numeric' })}`} · <a href="#" id="dlCard">⬇ Save card</a></p>
    <form class="app-card" id="profileForm" novalidate><h3>Personal details</h3>
      <label class="ev-label">Full name</label><input class="ev-input" name="name" maxlength="80" value="${esc(m.name)}">
      <label class="ev-label">Mobile number</label><input class="ev-input" name="phone" type="tel" maxlength="20" value="${esc(m.phone || '')}">
      <label class="ev-label">Email</label><input class="ev-input" name="email" type="email" maxlength="120" value="${esc(m.email || '')}">
      <label class="ev-label">Date of birth</label><input class="ev-input" name="dob" type="date" value="${esc(m.dob || '')}">
      <label class="ev-label">Address</label><input class="ev-input" name="address" maxlength="300" value="${esc(m.address || '')}">
      <p class="muted app-small">${esc(m.gender)} · ${esc(m.plan_name)} plan · member since ${App.fmtDate(m.start_date, { month: 'short', year: 'numeric' })}. Ask the studio to change your gender.</p>
      <button class="btn btn-primary btn-block">Save details</button></form>
    <form class="app-card" id="pinForm" novalidate><h3>🔑 Change PIN</h3>
      <label class="ev-label">New PIN</label><input class="ev-input" name="new_pin" type="password" inputmode="numeric" maxlength="6" placeholder="4–6 digits" autocomplete="new-password">
      <label class="ev-label">Type it again</label><input class="ev-input" name="pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">
      <button class="btn btn-outline btn-block" style="margin-top:14px">Change PIN</button></form>`;
  const studio = settings.studio_name || 'Rhythm Rehearsal Studio';
  $('cardSlot').innerHTML = MemberCard.html(m, studio);
  $('dlCard').onclick = (e) => { e.preventDefault(); MemberCard.download(m, studio); };
  App.eyes($('pinForm'));
  const base = () => ({ name: m.name, phone: m.phone, email: m.email || '', dob: m.dob || '', address: m.address || '' });
  $('profileForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await App.api('api/member/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      App.toast('Your details are saved', 'ok');
      await refreshMe(); boot();
    } catch (ex) { App.toast(ex.message, 'error'); }
  };
  $('pinForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!/^\d{4,6}$/.test(f.new_pin)) return App.toast('PIN must be 4 to 6 digits', 'error');
    if (f.new_pin !== f.pin2) return App.toast('The two PINs don\'t match', 'error');
    try {
      await App.api('api/member/me', { method: 'PUT', body: { ...base(), new_pin: f.new_pin } });
      App.toast('PIN changed – use it next time you log in', 'ok');
      e.target.reset();
    } catch (ex) { App.toast(ex.message, 'error'); }
    return undefined;
  };
}

// Pages inside the app: keep the dashboard in sync when the singer changes their event songs.
$('frame').addEventListener('load', () => { refreshMe().catch(() => {}); });

// If GPay isn't installed the tez:// link does nothing: fall back to the UPI app chooser.
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-gpay]');
  if (!a) return;
  const t = setTimeout(() => { if (!document.hidden) location.href = a.dataset.gpay; }, 1800);
  document.addEventListener('visibilitychange', () => clearTimeout(t), { once: true });
});

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

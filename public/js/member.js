// Singer portal: plans (logged out), membership card, monthly song usage, song history and profile (logged in).
App.renderChrome('member');
const $ = (id) => document.getElementById(id);
const esc = App.esc;
let cur = '₹', plans = [], data = null, month = null;

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
const monthName = (ym, opts = { month: 'long', year: 'numeric' }) => new Date(ym + '-01T00:00').toLocaleDateString('en-IN', opts);
const price = (p, gender) => App.money(gender === 'Female' ? p.price_female : p.price_male, cur);
const songsText = (limit) => (limit == null ? 'Unlimited songs' : `Up to ${limit} songs / month`);

function drawPlans(gender, currentKey = null) {
  $('planGrid').innerHTML = plans.map((p) => `
    <div class="plan-card ${p.key === currentKey ? 'current' : ''}">
      ${p.key === currentKey ? '<span class="tag">Your plan</span>' : ''}
      <h3>${esc(p.name)}</h3>
      <div class="price">${price(p, gender)} <small>/ month</small></div>
      <div class="songs">🎤 ${songsText(p.limit)}</div>
    </div>`).join('');
}

async function boot() {
  const pub = await App.api('api/membership/plans');
  plans = pub.plans; cur = pub.currency;
  $('dueNote').textContent = `The membership fee is to be paid before the ${ordinal(pub.due_day)} of each month.`;
  try {
    data = await App.api('api/member/me');
  } catch (err) {
    if (err.status !== 401) App.toast(err.message, 'error');
    data = null;
  }
  $('guestView').classList.toggle('hidden', !!data);
  $('memberView').classList.toggle('hidden', !data);
  $('logoutBtn').classList.toggle('hidden', !data);
  if (!data) {
    $('heroTitle').textContent = 'Singer Membership';
    drawPlans(document.querySelector('#genderSeg input:checked').value);
    return;
  }
  plans = data.plans;
  renderMember();
}

function renderMember() {
  const m = data.member;
  const studio = document.querySelector('[data-s="studio_name"]')?.textContent || 'Rhythm Rehearsal Studio';
  App.settings().then((s) => { $('cardSlot').innerHTML = MemberCard.html(m, s.studio_name); }).catch(() => { $('cardSlot').innerHTML = MemberCard.html(m, studio); });
  $('heroTitle').textContent = `Hi, ${m.name.split(' ')[0]} 👋`;
  $('heroSub').textContent = `${m.member_no} · ${m.plan_name} membership · ${App.money(m.plan_price, cur)} / month`;
  $('validity').innerHTML = m.active
    ? `Valid until <b>${App.fmtDate(m.valid_until, { day: 'numeric', month: 'short', year: 'numeric' })}</b>`
    : `<span style="color:var(--accent)">Expired on ${App.fmtDate(m.valid_until, { day: 'numeric', month: 'short', year: 'numeric' })} – please pay your membership fee at the studio.</span>`;

  // This month's usage
  const lim = m.plan_limit;
  $('usageTitle').textContent = `This month · ${monthName(m.month)}`;
  $('usageBig').innerHTML = `${m.month_count} <small>${lim == null ? 'songs · unlimited plan' : `of ${lim} songs`}</small>`;
  const meter = $('usageMeter');
  meter.className = 'meter' + (m.over_limit ? ' over' : m.remaining != null && m.remaining <= 3 ? ' warn' : '');
  meter.firstElementChild.style.width = lim == null ? '100%' : Math.min(100, (m.month_count / lim) * 100) + '%';
  $('usageSub').textContent = lim == null ? 'Sing as much as you like.' : m.over_limit
    ? `${m.month_count - lim} song${m.month_count - lim === 1 ? '' : 's'} over your ${m.plan_name} limit`
    : `${m.remaining} song${m.remaining === 1 ? '' : 's'} left this month`;
  let alert = '';
  if (m.over_limit && m.suggested) {
    const s = m.suggested;
    alert = m.requested
      ? `<div class="alert alert-ok" style="margin:0">✅ You asked to move to <b>${esc(m.requested.name)}</b>. The studio will confirm your upgrade.</div>`
      : `<div class="alert alert-error upgrade-box" style="margin:0">
          <span>⚠️ You've crossed your <b>${esc(m.plan_name)}</b> limit of ${lim} songs. Upgrade to <b>${esc(s.name)}</b> – ${songsText(s.limit).toLowerCase()} for ${App.money(s.price, cur)} / month.</span>
          <button class="btn btn-primary btn-sm" id="reqUpgrade" data-plan="${esc(s.key)}">Request ${esc(s.name)}</button></div>`;
  } else if (m.remaining != null && m.remaining <= 3) {
    const next = plans[plans.findIndex((p) => p.key === m.plan) + 1];
    alert = `<div class="alert alert-warn" style="margin:0">Only ${m.remaining} song${m.remaining === 1 ? '' : 's'} left on ${esc(m.plan_name)} this month.${next ? ` ${esc(next.name)} gives you ${songsText(next.limit).toLowerCase()}.` : ''}</div>`;
  }
  $('usageAlert').innerHTML = alert;

  // Monthly fee
  const fee = m.fee, d = (x) => App.fmtDate(x, { day: 'numeric', month: 'short' });
  const feeMsg = {
    paid: `<div class="alert alert-ok" style="margin:0">✅ ${monthName(fee.month)} fee of <b>${App.money(fee.amount, cur)}</b> paid on ${d(fee.paid_on)}.</div>`,
    due: `<div class="alert alert-warn" style="margin:0">⏳ ${monthName(fee.month)} fee <b>${App.money(fee.balance, cur)}</b>${fee.part_paid ? ' (balance after your upgrade)' : ''} – please pay before <b>${d(fee.due_date)}</b>.</div>`,
    overdue: `<div class="alert alert-error" style="margin:0">⚠️ ${monthName(fee.month)} fee <b>${App.money(fee.balance, cur)}</b>${fee.part_paid ? ' (balance after your upgrade)' : ''} was due before <b>${d(fee.due_date)}</b>. Please pay at the studio.</div>`,
  };
  const older = m.fees.slice(1).filter((x) => x.status !== 'paid');
  $('feeNow').innerHTML = feeMsg[fee.status] + (older.length
    ? `<div class="alert alert-error" style="margin:10px 0 0">Also unpaid: ${older.map((x) => `${monthName(x.month, { month: 'short', year: 'numeric' })} (${App.money(x.balance, cur)})`).join(', ')}</div>` : '');
  $('feeHistory').innerHTML = `<table class="song-list"><thead><tr><th>Month</th><th>Fee</th><th>Status</th></tr></thead><tbody>
    ${m.fees.map((x) => `<tr><td>${monthName(x.month, { month: 'short', year: 'numeric' })}</td><td>${App.money(x.amount, cur)}</td>
      <td>${x.status === 'paid' ? `<span style="color:var(--green)">Paid ${d(x.paid_on)}</span>` : x.status === 'overdue' ? `<span style="color:var(--accent)">Overdue${x.part_paid ? ` · ${App.money(x.balance, cur)} balance` : ''}</span>` : `<span style="color:var(--amber)">Pay before ${d(x.due_date)}</span>`}</td></tr>`).join('')}
  </tbody></table>`;

  // Songs by month
  month = month && data.months.some((x) => x.month === month) ? month : data.months[0].month;
  $('yearTotal').textContent = `${data.total} song${data.total === 1 ? '' : 's'} in the last 12 months`;
  drawSongs();

  // Profile
  const f = $('profileForm');
  for (const k of ['name', 'phone', 'email', 'dob', 'address']) f.elements[k].value = m[k] || '';
  f.elements.new_pin.value = '';
  $('genderVal').textContent = m.gender;
  $('sinceVal').textContent = App.fmtDate(m.start_date, { day: 'numeric', month: 'short', year: 'numeric' });
}

function drawSongs() {
  const m = data.member;
  $('monthChips').innerHTML = data.months.map((x) => `<button class="chip ${x.month === month ? 'on' : ''}" role="tab" aria-selected="${x.month === month}" data-month="${x.month}">
    ${monthName(x.month, { month: 'short', year: 'numeric' })} <small>${x.count}</small></button>`).join('');
  const list = data.songs.filter((s) => s.sung_on.startsWith(month)).slice().reverse(); // oldest first, so #21+ are the over-limit songs
  const lim = month === m.month ? m.plan_limit : null;
  $('songTable').innerHTML = list.length ? `<table class="song-list"><thead><tr><th>#</th><th>Date</th><th>Song</th><th>Movie / Album</th></tr></thead><tbody>
    ${list.map((s, i) => `<tr class="${lim != null && i >= lim ? 'over' : ''}"><td class="n">${i + 1}</td>
      <td style="white-space:nowrap">${App.fmtDate(s.sung_on, { day: 'numeric', month: 'short' })}</td>
      <td><b>${esc(s.title)}</b></td><td class="muted">${esc(s.album || '–')}</td></tr>`).join('')}
    </tbody></table>` : `<div class="muted" style="padding:18px 0">No songs in ${monthName(month)}.</div>`;
}

$('monthChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-month]');
  if (b) { month = b.dataset.month; drawSongs(); }
});

document.querySelectorAll('#genderSeg input').forEach((r) => r.addEventListener('change', () => drawPlans(r.value)));

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  if (!body.member_no || !body.pin) { $('loginError').textContent = 'Enter your member number and PIN.'; $('loginError').classList.remove('hidden'); return; }
  try {
    await App.api('api/member/login', { method: 'POST', body });
    $('loginError').classList.add('hidden');
    e.target.reset();
    await boot();
    window.scrollTo({ top: 0 });
  } catch (err) {
    $('loginError').textContent = err.message;
    $('loginError').classList.remove('hidden');
  }
});

$('logoutBtn').onclick = async () => {
  await App.api('api/member/logout', { method: 'POST' });
  month = null;
  boot();
};

$('downloadCard').onclick = async () => {
  const s = await App.settings();
  MemberCard.download(data.member, s.studio_name);
};

$('usageAlert').addEventListener('click', async (e) => {
  const b = e.target.closest('#reqUpgrade');
  if (!b) return;
  b.disabled = true;
  try {
    await App.api('api/member/upgrade-request', { method: 'POST', body: { plan: b.dataset.plan } });
    App.toast('Upgrade request sent to the studio', 'ok');
    data = await App.api('api/member/me');
    renderMember();
  } catch (err) { App.toast(err.message, 'error'); b.disabled = false; }
});

$('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await App.api('api/member/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    App.toast('Your details are saved', 'ok');
    data = await App.api('api/member/me');
    renderMember();
  } catch (err) { App.toast(err.message, 'error'); }
});

boot().catch((e) => App.toast(e.message, 'error'));

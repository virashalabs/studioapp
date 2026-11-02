App.renderChrome('book');

const $ = (id) => document.getElementById(id);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_LABEL = {
  avail: 'Available',
  'first-booked': '1st half booked',
  'second-booked': '2nd half booked',
  'full-booked': 'Fully booked',
  past: '',
};

const state = {
  settings: null,
  slots: null,
  today: App.ymd(new Date()),
  maxDate: null,
  month: null,      // Date at 1st of the visible month
  date: null,       // selected YYYY-MM-DD
  slot: null,       // 'first' | 'second' | 'full'
  avail: {},        // 'YYYY-MM' -> { date: {first, second} }
};

const monthKey = (d) => `${d.getFullYear()}-${App.pad(d.getMonth() + 1)}`;

async function loadMonth(key, force = false) {
  if (!force && state.avail[key]) return state.avail[key];
  const res = await App.api(`api/availability?month=${key}`);
  state.today = res.today;
  return (state.avail[key] = res.days);
}

function dayInfo(ds) {
  if (ds < state.today || ds > state.maxDate) return { status: 'past', first: true, second: true };
  const d = (state.avail[ds.slice(0, 7)] || {})[ds] || { first: false, second: false };
  const status = d.first && d.second ? 'full-booked' : d.first ? 'first-booked' : d.second ? 'second-booked' : 'avail';
  return { status, ...d };
}

// ---------- rendering ----------
async function renderDateStrip() {
  const days = [];
  const start = App.parseYmd(state.today);
  for (let i = 0; i < 21; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  await Promise.all([...new Set(days.map(monthKey))].map((k) => loadMonth(k)));
  const colors = { avail: 'var(--green)', 'first-booked': 'var(--amber)', 'second-booked': 'var(--blue)', 'full-booked': 'var(--red)', past: '#ccc' };
  $('dateStrip').innerHTML = days.map((d) => {
    const ds = App.ymd(d);
    const info = dayInfo(ds);
    return `<button class="date-chip ${ds === state.date ? 'selected' : ''}" data-date="${ds}" ${info.status === 'full-booked' ? 'disabled' : ''}
      title="${STATUS_LABEL[info.status]}">
      <small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b><small>${d.toLocaleDateString('en-IN', { month: 'short' })}</small>
      <span class="dot" style="background:${colors[info.status]}"></span></button>`;
  }).join('');
}

async function renderCalendar() {
  const m = state.month;
  const key = monthKey(m);
  await loadMonth(key);
  $('calTitle').textContent = m.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  let html = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('');
  html += '<div class="cal-day empty"></div>'.repeat(first.getDay());
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${key}-${App.pad(d)}`;
    const info = dayInfo(ds);
    const cls = ['cal-day', info.status, ds === state.today ? 'today' : '', ds === state.date ? 'selected' : ''].join(' ');
    const disabled = info.status === 'past' || info.status === 'full-booked';
    html += `<button class="${cls}" data-date="${ds}" ${disabled ? 'disabled' : ''} aria-label="${App.fmtDate(ds)}: ${STATUS_LABEL[info.status] || 'not available'}">
      <span class="num">${d}</span><span class="lbl">${STATUS_LABEL[info.status]}</span></button>`;
  }
  $('calendar').innerHTML = html;

  const thisMonth = monthKey(App.parseYmd(state.today));
  $('prevMonth').disabled = key <= thisMonth;
  $('nextMonth').disabled = key >= state.maxDate.slice(0, 7);
}

function renderSlots() {
  const pills = $('slotPills');
  if (!state.date) { pills.innerHTML = ''; return; }
  const info = dayInfo(state.date);
  $('slotTitle').textContent = `Choose a slot · ${App.fmtDate(state.date)}`;
  $('slotHint').textContent = info.status === 'avail' ? 'The whole day is open – pick a half or take the full day.' : 'Some slots on this date are already taken.';
  const free = { first: !info.first, second: !info.second, full: !info.first && !info.second };
  pills.innerHTML = ['first', 'second', 'full'].map((k) => {
    const s = state.slots[k];
    return `<button class="slot-pill ${state.slot === k ? 'selected' : ''}" data-slot="${k}" ${free[k] ? '' : 'disabled'}>
      <b>${App.esc(s.name)}</b><small>${App.esc(s.time)}</small>
      <span class="p">${App.money(s.price, state.settings.currency)}</span>
      ${free[k] ? '' : '<span class="tag">Booked</span>'}</button>`;
  }).join('');
}

function renderSummary() {
  const s = state.slot && state.slots[state.slot];
  $('sumDate').textContent = state.date ? App.fmtDate(state.date) : '—';
  $('sumSlot').textContent = s ? s.name : '—';
  $('sumTime').textContent = s ? s.time : '—';
  $('sumAmount').textContent = s ? App.money(s.price, state.settings.currency) : '—';
  $('proceedBtn').disabled = !(state.date && state.slot);
}

async function selectDate(ds) {
  state.date = ds;
  const info = dayInfo(ds);
  // Keep the chosen slot only if it's still free on the new date.
  const free = { first: !info.first, second: !info.second, full: !info.first && !info.second };
  if (state.slot && !free[state.slot]) state.slot = null;
  const d = App.parseYmd(ds);
  if (monthKey(d) !== monthKey(state.month)) state.month = new Date(d.getFullYear(), d.getMonth(), 1);
  await Promise.all([renderCalendar(), renderDateStrip()]);
  renderSlots();
  renderSummary();
  if (window.innerWidth < 960) $('slotPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goStep(n) {
  document.querySelectorAll('.step').forEach((el) => {
    const k = Number(el.dataset.step);
    el.classList.toggle('on', k === n);
    el.classList.toggle('done', k < n);
    el.querySelector('i').textContent = k < n ? '✓' : k;
  });
  $('step1').classList.toggle('hidden', n !== 1);
  $('step2').classList.toggle('hidden', n !== 2);
  $('lookup').classList.toggle('hidden', n !== 1);
  $('bookLayout').classList.toggle('hidden', n === 3);
  $('step3').classList.toggle('hidden', n !== 3);
  $('backBtn').classList.toggle('hidden', n !== 2);
  $('proceedBtn').textContent = n === 2 ? 'Confirm Booking' : 'Proceed';
  state.step = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- events ----------
$('calendar').addEventListener('click', (e) => { const b = e.target.closest('.cal-day'); if (b && !b.disabled) selectDate(b.dataset.date); });
$('dateStrip').addEventListener('click', (e) => { const b = e.target.closest('.date-chip'); if (b && !b.disabled) selectDate(b.dataset.date); });
$('slotPills').addEventListener('click', (e) => {
  const b = e.target.closest('.slot-pill');
  if (!b || b.disabled) return;
  state.slot = b.dataset.slot;
  renderSlots();
  renderSummary();
});
$('prevMonth').onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCalendar(); };
$('nextMonth').onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCalendar(); };
$('backBtn').onclick = () => goStep(1);

document.querySelectorAll('input[name="group_type"]').forEach((r) => r.addEventListener('change', () => {
  const t = document.querySelector('input[name="group_type"]:checked').value;
  $('nameLabel').innerHTML = `${t === 'Individual' ? 'Your name' : `Name of ${t}`} <span class="req">*</span>`;
}));

$('proceedBtn').addEventListener('click', () => {
  if (state.step === 2) submitBooking();
  else goStep(2);
});

function validate(form) {
  const f = Object.fromEntries(new FormData(form));
  const errs = [];
  if ((f.name || '').trim().length < 2) errs.push('Please enter a name.');
  if ((f.phone || '').replace(/\D/g, '').length < 10) errs.push('Please enter a valid contact number.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email || '')) errs.push('Please enter a valid email address.');
  if (!$('f-terms').checked) errs.push('Please accept the studio rules.');
  return { f, errs };
}

async function submitBooking() {
  const form = $('bookingForm');
  const { f, errs } = validate(form);
  const errBox = $('formError');
  if (errs.length) {
    errBox.textContent = errs.join(' ');
    errBox.classList.remove('hidden');
    return;
  }
  errBox.classList.add('hidden');
  const btn = $('proceedBtn');
  btn.disabled = true;
  btn.textContent = 'Booking…';
  try {
    const { booking } = await App.api('api/bookings', { method: 'POST', body: { ...f, date: state.date, slot: state.slot } });
    showConfirmation(booking);
  } catch (err) {
    if (err.status === 409) {
      App.toast(err.message, 'error');
      await loadMonth(state.date.slice(0, 7), true);
      state.slot = null;
      goStep(1);
      await selectDate(state.date);
    } else {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  } finally {
    btn.disabled = false;
    if (state.step === 2) btn.textContent = 'Confirm Booking';
  }
}

function showConfirmation(b) {
  const s = state.settings;
  const slot = state.slots[b.slot];
  $('cEmail').textContent = b.email;
  $('ticket').innerHTML = `
    <div class="sum-row"><span>Booking ID</span><b style="color:var(--accent);font-size:17px">${App.esc(b.ref)}</b></div>
    <div class="sum-row"><span>Name</span><b>${App.esc(b.name)}</b></div>
    <div class="sum-row"><span>Date</span><b>${App.fmtDate(b.date)}</b></div>
    <div class="sum-row"><span>Slot</span><b>${App.esc(slot.name)} · ${App.esc(slot.time)}</b></div>
    <div class="sum-row"><span>Amount</span><b>${App.money(b.amount, s.currency)}</b></div>
    <div class="sum-row" style="border:0"><span>Status</span><b style="color:#a86a00">⏳ Awaiting studio approval</b></div>`;
  const msg = `Hi ${s.studio_name}, I just booked ${slot.name} on ${App.fmtDate(b.date)}. Booking ID: ${b.ref}`;
  $('waBtn').href = `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(msg)}`;
  goStep(3);
}

$('lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const out = $('lookupResult');
  try {
    const b = await App.api(`api/bookings/lookup?ref=${encodeURIComponent(f.ref.trim())}&email=${encodeURIComponent(f.email.trim())}`);
    const badge = { pending: ['⏳ Awaiting approval', 'alert-error" style="background:var(--amber-bg);color:#8a5a00'], approved: ['✅ Confirmed', 'alert-ok'], cancelled: ['❌ Cancelled', 'alert-error'] }[b.status];
    out.innerHTML = `<div class="alert ${badge[1]}"><b>${badge[0]}</b> — ${App.esc(b.name)}, ${App.fmtDate(b.date)}, ${App.esc(b.slot_label)} · ${App.money(b.amount, state.settings.currency)}</div>`;
  } catch (err) {
    out.innerHTML = `<div class="alert alert-error">${App.esc(err.message)}</div>`;
  }
});

// ---------- init ----------
(async function init() {
  state.settings = await App.settings();
  state.slots = App.slotInfo(state.settings);
  const max = new Date();
  max.setDate(max.getDate() + Number(state.settings.booking_window_days || 120));
  state.maxDate = App.ymd(max);

  const params = new URLSearchParams(location.search);
  if (['first', 'second', 'full'].includes(params.get('slot'))) state.slot = params.get('slot');
  state.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  await Promise.all([renderCalendar(), renderDateStrip()]);
  renderSummary();
  const want = params.get('date');
  if (want && /^\d{4}-\d{2}-\d{2}$/.test(want)) {
    await loadMonth(want.slice(0, 7));
    const info = dayInfo(want);
    if (info.status !== 'past' && info.status !== 'full-booked') await selectDate(want);
    else App.toast(`${App.fmtDate(want)} is not available – please choose another date.`, 'error');
  }
  if (location.hash === '#lookup') $('lookup').scrollIntoView();
})().catch((e) => App.toast(e.message, 'error'));

$('bookingForm').addEventListener('submit', (e) => { e.preventDefault(); submitBooking(); });

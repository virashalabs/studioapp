// Weekly event page – one simple form: phone (first time), I'm in / Not this week, solo + duet songs, Submit.
// After the studio publishes the line-up, each singer sees only their own songs; the video link appears afterwards.
App.renderChrome('event');
const $ = (id) => document.getElementById(id);
const esc = App.esc;
let ev = null;

const fmtDay = (d) => App.fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' });
const eventId = () => new URLSearchParams(location.search).get('id');

async function load() {
  const id = eventId();
  const r = await App.api(id ? `api/events/${encodeURIComponent(id)}` : 'api/events/current');
  ev = r.event;
  if (!ev) {
    $('evTitle').textContent = 'Weekly Event';
    $('evWhen').textContent = 'No event has been posted yet – watch the WhatsApp group for this week\'s link.';
    return;
  }
  if (!id) history.replaceState(null, '', `?id=${ev.id}`);
  document.title = ev.title;
  $('evTitle').textContent = ev.title;
  $('evWhen').innerHTML = `📅 ${esc(fmtDay(ev.event_date))}${ev.event_time ? ` · ⏰ ${esc(ev.event_time)}` : ''}${ev.venue ? `<br>📍 ${esc(ev.venue)}` : ''}<br><b>${ev.going_count}</b> singer${ev.going_count === 1 ? '' : 's'} in so far`;
  $('evNotes').textContent = ev.notes || '';
  $('evNotes').hidden = !ev.notes;
  render();
}

const songRow = (kind, s = {}) => `<div class="ev-row">
  <input class="ev-input" data-k="title" placeholder="Song name" maxlength="120" value="${esc(s.title || '')}" aria-label="${kind} song">
  <input class="ev-input ev-movie" data-k="album" placeholder="Movie (optional)" maxlength="120" value="${esc(s.album || '')}" aria-label="Movie">
  <button type="button" class="ev-x" data-rm aria-label="Remove song">×</button></div>`;

function fillSongs(kind, list) {
  $(kind + 'Rows').innerHTML = (list && list.length ? list : [{}, {}].slice(0, kind === 'solo' ? 1 : 1)).map((s) => songRow(kind, s)).join('');
}

function render() {
  const me = ev.me;
  // Who is filling in: logged-in singers skip the phone step.
  $('idFields').classList.toggle('hidden', !!me);
  $('who').innerHTML = me ? `<p class="ev-hi">Hi <b>${esc(me.member.name.split(' ')[0])}</b> 👋 <a href="#" id="notMe">Not you?</a></p>` : '';

  // Taken out by the studio
  if (me && me.removed) {
    $('joinForm').hidden = true;
    $('closedCard').hidden = false;
    $('closedCard').innerHTML = `<h2>You're not in this week</h2><p>The studio has taken you off this week's list.</p>${me.note ? `<div class="alert alert-warn" style="margin:0">💬 ${esc(me.note)}</div>` : ''}<p class="muted" style="margin-bottom:0">Questions? Message the studio on WhatsApp.</p>`;
  } else if (ev.open) {
    $('joinForm').hidden = false;
    $('closedCard').hidden = true;
    const v = me && me.vote;
    document.querySelectorAll('input[name=going]').forEach((r) => { r.checked = (v === 'yes' && r.value === '1') || (v === 'no' && r.value === '0'); });
    fillSongs('solo', me && me.choices.solo);
    fillSongs('duet', me && me.choices.duet);
    $('songsBox').classList.toggle('hidden', v !== 'yes');
    $('submitBtn').textContent = v ? 'Update' : 'Submit';
    App.eyes($('joinForm'));
  } else {
    $('joinForm').hidden = true;
    $('closedCard').hidden = false;
    const v = me && me.vote;
    $('closedCard').innerHTML = `<h2>${ev.done ? 'This event is over' : 'Entries are closed'}</h2>${me
      ? `<p style="margin-bottom:0">${v === 'yes' ? '✅ You were in this week.' : v === 'no' ? 'You weren\'t singing this week.' : 'You didn\'t reply this week.'}</p>`
      : `<p style="margin-bottom:0">Singers can <a href="member.html">log in</a> to see their songs.</p>`}`;
  }

  // Line-up – only the rows this singer is part of
  const lu = me && ev.published && me.vote === 'yes' ? me.lineup : null;
  $('lineupCard').hidden = !lu;
  if (lu) {
    $('lineupBody').innerHTML = lu.length ? `<ul class="ev-lineup">${lu.map((r) => {
      const partner = r.male_id === me.member.id ? r.female_name : r.male_name;
      return `<li><b>${esc(r.title)}</b>${r.album ? ` <small class="muted">${esc(r.album)}</small>` : ''}<span>${r.male_id && r.female_id ? `with <b>${esc(partner)}</b>` : 'Solo'}</span></li>`;
    }).join('')}</ul>` : '<p class="muted" style="margin:0">No songs assigned to you yet – please check with the studio.</p>';
  }

  $('videoCard').hidden = !ev.video_link;
  if (ev.video_link) $('videoLink').href = ev.video_link;
  if (me) loadPast();
}

// Show the song lists as soon as "I'm in" is picked.
$('joinForm').addEventListener('change', (e) => {
  if (e.target.name === 'going') $('songsBox').classList.toggle('hidden', e.target.value !== '1');
});

$('joinForm').addEventListener('click', async (e) => {
  if (e.target.id === 'notMe') {
    e.preventDefault();
    await App.api('api/member/logout', { method: 'POST' });
    return load();
  }
  const add = e.target.closest('[data-add]');
  if (add) {
    const box = $(add.dataset.add + 'Rows');
    box.insertAdjacentHTML('beforeend', songRow(add.dataset.add));
    box.lastElementChild.querySelector('input').focus();
  }
  if (e.target.hasAttribute('data-rm')) {
    const row = e.target.closest('.ev-row');
    if (row.parentElement.children.length > 1) row.remove();
    else row.querySelectorAll('input').forEach((i) => { i.value = ''; });
  }
  return undefined;
});

$('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('joinError');
  err.classList.add('hidden');
  const goingEl = document.querySelector('input[name=going]:checked');
  if (!goingEl) { err.textContent = 'Tap "I\'m in" or "Not this week".'; err.classList.remove('hidden'); return; }
  const going = goingEl.value === '1';
  const songs = (kind) => [...$(kind + 'Rows').querySelectorAll('.ev-row')].map((r) => ({
    title: r.querySelector('[data-k=title]').value.trim(), album: r.querySelector('[data-k=album]').value.trim(),
  })).filter((s) => s.title);
  const body = { going, solo: songs('solo'), duet: songs('duet') };
  if (!ev.me) Object.assign(body, { phone: $('vPhone').value, pin: $('vPin').value, name: $('vName').value, gender: (document.querySelector('input[name=gender]:checked') || {}).value });
  const btn = $('submitBtn');
  btn.disabled = true;
  try {
    const r = await App.api(`api/events/${ev.id}/vote`, { method: 'POST', body });
    if (r.new_pin) alert(`Welcome to Demo Studio! 🎤\n\nYour member no: ${r.member_no}\nYour PIN: ${r.new_pin} (last 4 digits of your phone)\n\nNext time just open this link – you'll stay logged in on this phone.`);
    App.toast(!going ? 'Thanks for letting us know' : r.saved && (r.saved.solo || r.saved.duet) ? `You're in! ${r.saved.solo + r.saved.duet} song${r.saved.solo + r.saved.duet === 1 ? '' : 's'} saved 🎤` : 'You\'re in! 🎤 Add your songs any time', 'ok');
    ev = r.event;
    await load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (ex) {
    const data = ex.data || {};
    err.textContent = ex.message;
    err.classList.remove('hidden');
    if (data.need_pin) { $('pinRow').classList.remove('hidden'); $('vPin').focus(); }
    if (data.need_details) { $('newRow').classList.remove('hidden'); $('vName').focus(); }
    err.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally { btn.disabled = false; }
});

async function loadPast() {
  try {
    const { events } = await App.api('api/member/events');
    const others = events.filter((x) => x.id !== ev.id && x.me && x.me.vote === 'yes');
    $('pastCard').hidden = !others.length;
    $('pastList').innerHTML = others.map((x) => `<div class="ev-past">
      <a href="?id=${x.id}"><b>${esc(x.title)}</b></a> <small class="muted">${esc(fmtDay(x.event_date))} · ${x.me.lineup.length} song${x.me.lineup.length === 1 ? '' : 's'}</small>
      ${x.video_link ? ` · <a href="${esc(x.video_link)}" target="_blank" rel="noopener">🎬 Videos</a>` : ''}</div>`).join('');
  } catch { /* not logged in */ }
}

load().catch((e) => App.toast(e.message, 'error'));

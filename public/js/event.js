// Weekly event page: vote (anyone with the link), send solo / duet song choices, see your own line-up and the video link.
App.renderChrome('event');
const $ = (id) => document.getElementById(id);
const esc = App.esc;
let ev = null;

const fmtDay = (d) => App.fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const eventId = () => new URLSearchParams(location.search).get('id');

async function load() {
  const id = eventId();
  const r = await App.api(id ? `api/events/${encodeURIComponent(id)}` : 'api/events/current');
  ev = r.event;
  if (!ev) {
    $('evTitle').textContent = 'Weekly Event';
    $('evWhen').textContent = 'No event has been posted yet – watch the WhatsApp group for this week\'s link.';
    for (const s of ['voteStep', 'songStep', 'lineupStep']) $(s).hidden = true;
    return;
  }
  if (!id) history.replaceState(null, '', `?id=${ev.id}`);
  document.title = ev.title;
  $('evTitle').textContent = ev.title;
  $('evWhen').textContent = [fmtDay(ev.event_date), ev.event_time, ev.venue].filter(Boolean).join(' · ')
    + ` · ${ev.going_count} singer${ev.going_count === 1 ? '' : 's'} in`;
  $('evNotes').textContent = ev.notes || '';
  $('evNotes').hidden = !ev.notes;
  renderVote();
  renderSongs();
  renderLineup();
  $('videoPanel').hidden = !ev.video_link;
  if (ev.video_link) $('videoLink').href = ev.video_link;
  if (ev.me) loadPast();
}

// ---------- step 1: vote ----------
function renderVote() {
  const me = ev.me, v = me && me.vote;
  const answer = v === 'yes' ? '✅ You\'re in' : v === 'no' ? '🙅 Not this week' : '';
  if (me) {
    $('voteBody').innerHTML = `
      <p style="margin:0 0 12px">Hi <b>${esc(me.member.name)}</b> <span class="muted">(${esc(me.member.member_no)})</span>${me.member.approved ? '' : ' · <span class="pill pending">Waiting for studio approval</span>'}
        · <a href="#" id="notMe">Not you?</a></p>
      ${ev.voting_open ? `<div class="ev-vote">
        <button type="button" class="btn ${v === 'yes' ? 'btn-green' : 'btn-outline'} btn-lg" data-going="1">🎤 I'm in</button>
        <button type="button" class="btn ${v === 'no' ? 'btn-dark' : 'btn-ghost'} btn-lg" data-going="0">Not this week</button></div>
        ${answer ? `<p class="muted" style="margin:10px 0 0">Your answer: <b>${answer}</b> – you can change it while voting is open.</p>` : ''}`
      : `<div class="alert ${v === 'yes' ? 'alert-ok' : 'alert-warn'}" style="margin:0">Voting is closed.${answer ? ` Your answer: <b>${answer}</b>` : ' You didn\'t vote this week.'}</div>`}`;
    return;
  }
  if (!ev.voting_open) {
    $('voteBody').innerHTML = `<div class="alert alert-warn" style="margin:0">Voting is closed. Singers who are in can <a href="member.html">log in</a> to see their songs.</div>`;
    return;
  }
  $('voteBody').innerHTML = `
    <form id="voteForm" novalidate>
      <div id="voteError" class="alert alert-error hidden"></div>
      <div class="form-grid">
        <div class="field full"><label for="vPhone">Your mobile number</label><input id="vPhone" name="phone" type="tel" inputmode="tel" placeholder="98400 11223" autocomplete="tel" required></div>
        <div class="field full hidden" id="pinRow"><label for="vPin">Your PIN <small class="muted">(first PIN: last 4 digits of your phone)</small></label><input id="vPin" name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password"></div>
        <div class="field hidden" id="nameRow"><label for="vName">Your name</label><input id="vName" name="name" maxlength="80" autocomplete="name"></div>
        <div class="field hidden" id="genderRow"><label>You sing as</label>
          <div class="seg"><label><input type="radio" name="gender" value="Male"> Male</label><label><input type="radio" name="gender" value="Female"> Female</label></div></div>
      </div>
      <div class="ev-vote" style="margin-top:16px">
        <button class="btn btn-primary btn-lg" data-going="1">🎤 I'm in</button>
        <button class="btn btn-ghost btn-lg" data-going="0">Not this week</button>
      </div>
    </form>`;
  App.eyes($('voteBody'));
}

async function vote(going, form) {
  const body = { going: !!going };
  if (form) Object.assign(body, Object.fromEntries(new FormData(form)));
  try {
    const r = await App.api(`api/events/${ev.id}/vote`, { method: 'POST', body });
    if (r.new_pin) {
      App.toast(`Welcome! You're registered as ${r.member_no}. Your PIN is ${r.new_pin} – keep it to log in.`, 'ok');
      alert(`Welcome to Rhythm Rehearsal Studio!\n\nMember no: ${r.member_no}\nPIN: ${r.new_pin} (last 4 digits of your phone)\n\nUse your phone number and PIN to log in next time.`);
    } else App.toast(going ? 'You\'re in! 🎤' : 'Thanks for letting us know', 'ok');
    ev = r.event;
    await load();
  } catch (err) {
    const box = $('voteError');
    if (!box) return App.toast(err.message, 'error');
    box.textContent = err.message;
    box.classList.remove('hidden');
    const data = err.data || {};
    if (data.need_pin || /PIN/.test(err.message)) { $('pinRow').classList.remove('hidden'); $('vPin').focus(); }
    if (data.need_details || /name/.test(err.message)) { $('nameRow').classList.remove('hidden'); $('genderRow').classList.remove('hidden'); $('vName').focus(); }
  }
}

$('voteBody').addEventListener('click', async (e) => {
  if (e.target.id === 'notMe') {
    e.preventDefault();
    await App.api('api/member/logout', { method: 'POST' });
    return load();
  }
  const b = e.target.closest('[data-going]');
  if (!b) return;
  e.preventDefault();
  b.disabled = true;
  await vote(b.dataset.going === '1', $('voteForm'));
  b.disabled = false;
});

// ---------- step 2: song choices ----------
const songRow = (kind, s = {}) => `<div class="ev-song-row">
  <input data-kind="${kind}" data-k="title" placeholder="Song" maxlength="120" value="${esc(s.title || '')}" aria-label="${kind} song">
  <input data-k="album" placeholder="Movie / album (optional)" maxlength="120" value="${esc(s.album || '')}" aria-label="Movie or album">
  <button type="button" class="btn btn-ghost btn-sm" data-rm aria-label="Remove">×</button></div>`;

function renderSongs() {
  const me = ev.me, going = me && me.vote === 'yes';
  const c = (me && me.choices) || { solo: [], duet: [] };
  if (!going) {
    $('songBody').innerHTML = `<p class="muted" style="margin:0">${me ? 'Tap <b>I\'m in</b> above to send your songs.' : 'Vote first – then you can send your songs here.'}</p>`;
    return;
  }
  if (!ev.songs_open) {
    const list = (arr) => (arr.length ? `<ul class="ev-list">${arr.map((s) => `<li>${esc(s.title)}${s.album ? ` <span class="muted">– ${esc(s.album)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">None</p>');
    $('songBody').innerHTML = (c.solo.length || c.duet.length)
      ? `<p class="muted" style="margin-top:0">Song choices are closed. You sent:</p><div class="ev-cols"><div><h4>Solo</h4>${list(c.solo)}</div><div><h4>Duet</h4>${list(c.duet)}</div></div>`
      : `<p class="muted" style="margin:0">${ev.published || ev.done ? 'Song choices are closed.' : 'Song choices open once voting closes – we\'ll post in the WhatsApp group.'}</p>`;
    return;
  }
  const rows = (kind, arr) => (arr.length ? arr : [{}]).map((s) => songRow(kind, s)).join('');
  $('songBody').innerHTML = `
    <p class="muted" style="margin-top:0">Add as many as you like. The studio picks from these when making the line-up.</p>
    <div class="ev-cols">
      <div><h4>🎙️ Solo songs</h4><div id="soloRows">${rows('solo', c.solo)}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-add="solo">+ Add solo song</button></div>
      <div><h4>🎶 Duet songs</h4><div id="duetRows">${rows('duet', c.duet)}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-add="duet">+ Add duet song</button></div>
    </div>
    <button class="btn btn-primary btn-lg" style="margin-top:18px">Save my songs</button>`;
}

$('songStep').addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) {
    const box = $(add.dataset.add + 'Rows');
    box.insertAdjacentHTML('beforeend', songRow(add.dataset.add));
    box.lastElementChild.querySelector('input').focus();
  }
  if (e.target.hasAttribute('data-rm')) {
    const row = e.target.closest('.ev-song-row');
    const box = row.parentElement;
    if (box.children.length > 1) row.remove();
    else row.querySelectorAll('input').forEach((i) => { i.value = ''; });
  }
});

$('songStep').addEventListener('submit', async (e) => {
  e.preventDefault();
  const collect = (id) => [...$(id).querySelectorAll('.ev-song-row')].map((r) => ({
    title: r.querySelector('[data-k=title]').value.trim(), album: r.querySelector('[data-k=album]').value.trim(),
  })).filter((s) => s.title);
  const body = { solo: collect('soloRows'), duet: collect('duetRows') };
  if (!body.solo.length && !body.duet.length) return App.toast('Add at least one song', 'error');
  try {
    const r = await App.api(`api/events/${ev.id}/songs`, { method: 'PUT', body });
    App.toast(`Saved – ${r.solo} solo, ${r.duet} duet`, 'ok');
    await load();
  } catch (err) { App.toast(err.message, 'error'); }
});

// ---------- step 3: line-up ----------
function lineupRows(rows, myId) {
  return `<ul class="ev-lineup">${rows.map((r) => {
    const partner = r.male_id === myId ? r.female_name : r.male_name;
    const who = r.male_id && r.female_id ? `Duet with <b>${esc(partner)}</b>` : 'Solo';
    return `<li><span class="ev-song">🎵 ${esc(r.title)}${r.album ? ` <small class="muted">– ${esc(r.album)}</small>` : ''}</span><span class="ev-who">${who}</span></li>`;
  }).join('')}</ul>`;
}

function renderLineup() {
  const me = ev.me;
  if (!ev.published) {
    $('lineupBody').innerHTML = '<p class="muted" style="margin:0">The line-up will appear here once the studio publishes it.</p>';
    return;
  }
  if (!me) { $('lineupBody').innerHTML = '<p class="muted" style="margin:0">Log in above (phone + PIN) to see your songs.</p>'; return; }
  if (me.vote !== 'yes') { $('lineupBody').innerHTML = '<p class="muted" style="margin:0">You\'re not singing this week.</p>'; return; }
  $('lineupBody').innerHTML = me.lineup.length
    ? `<p class="muted" style="margin-top:0">${me.lineup.length} song${me.lineup.length === 1 ? '' : 's'} for you this week:</p>${lineupRows(me.lineup, me.member.id)}`
    : '<p class="muted" style="margin:0">No songs assigned to you this week – please check with the studio.</p>';
}

// ---------- my recent weeks ----------
async function loadPast() {
  try {
    const { events } = await App.api('api/member/events');
    const others = events.filter((x) => x.id !== ev.id && x.me && x.me.vote === 'yes');
    $('pastPanel').hidden = !others.length;
    $('pastList').innerHTML = others.map((x) => `<div class="ev-past">
      <a href="?id=${x.id}"><b>${esc(x.title)}</b></a><br><small class="muted">${fmtDay(x.event_date)} · ${x.me.lineup.length} song${x.me.lineup.length === 1 ? '' : 's'}</small>
      ${x.video_link ? `<br><a href="${esc(x.video_link)}" target="_blank" rel="noopener">🎬 Videos ↗</a>` : ''}</div>`).join('');
  } catch { /* not logged in */ }
}

load().catch((e) => App.toast(e.message, 'error'));

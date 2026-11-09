// Admin: weekly events (voting, song choices, line-up, video link), Excel import/export and WhatsApp reminders / reports.
// Loaded after admin.js and uses its helpers (modal, $, esc, money, state, reload, memberData, monthLabel, ordinal).

// ---------- Excel helpers (SheetJS) ----------
const normKey = (k) => String(k).toLowerCase().replace(/[^a-z]/g, '');
function xlDownload(file, sheet, header, rows) {
  if (!window.XLSX) return App.toast('Excel library is still loading – try again in a moment', 'error');
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = header.map((h, i) => ({ wch: Math.min(60, Math.max(h.length + 2, ...rows.map((r) => String(r[i] ?? '').length + 1), 12)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, file);
}
function pickExcel() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.xlsx,.xls,.csv';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}
// Reads the first sheet into objects using `map` (normalised header -> field). Phone numbers stay as text.
async function xlRead(file, map) {
  const wb = XLSX.read(await file.arrayBuffer());
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  return rows.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) { const f = map[normKey(k)]; if (f) o[f] = String(v).trim(); }
    return o;
  }).filter((o) => Object.values(o).some(Boolean));
}
// Upload flow: pick file -> check on the server (dry run) -> show what will happen -> save.
async function xlImport({ title, map, send, describe, after }) {
  if (!window.XLSX) return App.toast('Excel library is still loading – try again in a moment', 'error');
  const file = await pickExcel();
  if (!file) return;
  let rows;
  try { rows = await xlRead(file, map); } catch { return App.toast('Could not read that file – please use the template (.xlsx)', 'error'); }
  if (!rows.length) return App.toast('No rows found under the header row', 'error');
  const check = await send(rows, true);
  const errs = check.errors || [];
  modal(title, `
    <p><b>${esc(file.name)}</b> – ${rows.length} row${rows.length === 1 ? '' : 's'} read.</p>
    <p>${describe(check)}</p>
    ${errs.length ? `<div class="alert alert-error" style="margin:0"><b>${errs.length} problem${errs.length === 1 ? '' : 's'}</b> – fix these in the sheet and upload again:
      <ul style="margin:6px 0 0;padding-left:18px">${errs.slice(0, 30).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${errs.length > 30 ? `<p>…and ${errs.length - 30} more</p>` : ''}</div>` : ''}`,
  { submitText: errs.length ? 'Close' : 'Save', onSubmit: async () => {
    if (errs.length && !check.partial_ok) return true;
    const r = await send(rows, false);
    App.toast(describe(r).replace(/<[^>]+>/g, ''), 'ok');
    reload();
    if (after) await after();
    return true;
  } });
}

// ---------- WhatsApp ----------
const waNumber = (phone) => { const d = String(phone || '').replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };
const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
const waShare = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
const siteUrl = (p) => new URL(p, location.href).href;
const firstName = (n) => String(n || '').split(' ')[0];

// ---------- singers: Excel ----------
const SINGER_HEAD = ['Member No', 'Name', 'Phone', 'Gender', 'Plan', 'Email'];
const SINGER_MAP = { memberno: 'member_no', memberid: 'member_no', no: 'member_no', name: 'name', singer: 'name', phone: 'phone', mobile: 'phone', phonenumber: 'phone', gender: 'gender', plan: 'plan', email: 'email' };
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-xl]');
  if (!b) return;
  try {
    switch (b.dataset.xl) {
      case 'singers-template':
        return xlDownload('singers-template.xlsx', 'Singers', SINGER_HEAD, [
          ['', 'Ravi Kumar', '9840011223', 'Male', 'Budget', 'ravi@example.com'],
          ['', 'Seetha Raman', '9840022334', 'Female', 'Economy', ''],
        ]);
      case 'singers-download':
        return xlDownload(`singers-${App.ymd(new Date())}.xlsx`, 'Singers', [...SINGER_HEAD, 'Songs this month', 'Fee status', 'Valid until'],
          memberData.members.map((m) => [m.member_no, m.name, m.phone, m.gender, m.plan_name, m.email || '', m.month_count, m.fee.status, m.valid_until]));
      case 'singers-upload':
        return xlImport({
          title: 'Upload singers',
          map: SINGER_MAP,
          send: (rows, dry) => App.api('api/admin/members/import', { method: 'POST', body: { rows, dry_run: dry } }),
          describe: (r) => `<b>${r.created}</b> new singer${r.created === 1 ? '' : 's'} will be added and <b>${r.updated}</b> updated (matched by member no. or phone). New singers' PIN is the last 4 digits of their phone.`,
        });
      default: return undefined;
    }
  } catch (err) { App.toast(err.message, 'error'); }
});

// ---------- reminders & monthly reports ----------
let reportData = null;
async function loadReminders() {
  const sel = $('rMonth');
  if (!sel.options.length) {
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      sel.add(new Option(monthLabel(ym), ym));
    }
  }
  const kind = document.querySelector('#rKind input:checked').value;
  // Fee reminders are for the current month; reports default to last month (sent at the start of a month).
  sel.disabled = kind === 'fee';
  if (kind === 'fee') sel.selectedIndex = 0;
  reportData = await App.api(`api/admin/reports?month=${sel.value}`);
  drawReminders(kind);
}
function feeText(m, d) {
  const mon = monthLabel(m.fee.month, { month: 'long' });
  const late = m.fee.status === 'overdue';
  return `Hi ${firstName(m.name)}, a gentle reminder from Rhythm Rehearsal Studio 🎤\n\n`
    + `Your ${mon} membership fee of ${App.money(m.fee_due, d.currency)} (${m.plan_name} plan) ${late ? `was due before the ${ordinal(d.due_day)} – please pay today.` : `is due before the ${ordinal(d.due_day)} ${mon}.`}\n\n`
    + `Pay by UPI: ${d.upi_id}\nOr scan the QR on your member page and send us the transaction ID: ${siteUrl('member.html')}\n\nThank you!`;
}
function reportText(m, d) {
  const weeks = m.weeks.map((n, i) => `W${i + 1}: ${n}`).slice(0, new Date(Number(d.month.slice(0, 4)), Number(d.month.slice(5, 7)), 0).getDate() > 28 ? 5 : 4).join(' | ');
  const songs = m.songs.map((s, i) => `${i + 1}. ${s.title}${s.album ? ` (${s.album})` : ''}`).join('\n');
  return `Hi ${firstName(m.name)} 🎤 Your Rhythm Rehearsal Studio report for ${monthLabel(d.month)}\n\n`
    + `Plan: ${m.plan_name}${m.plan_limit == null ? ' (unlimited)' : ` (${m.plan_limit} songs / month)`}\n`
    + `Songs sung: ${m.count}\n${weeks}\n\n${songs ? `Songs:\n${songs}\n\n` : ''}`
    + `See all your songs: ${siteUrl('member.html')}`;
}
function drawReminders(kind) {
  const d = reportData;
  const list = kind === 'fee' ? d.members.filter((m) => m.fee.status !== 'paid') : d.members;
  $('rHelp').textContent = kind === 'fee'
    ? `Singers who haven't paid ${monthLabel(d.members[0] ? d.members[0].fee.month : d.month)} yet. Tap Send – WhatsApp opens with the message ready; press send there. The bell also reminds you 3 days before the ${ordinal(d.due_day)} and on the day.`
    : `Each singer's songs for ${monthLabel(d.month)} – per week, the list of songs and their plan. Tap Send to open WhatsApp with the report ready.`;
  $('remindTable').innerHTML = list.length ? `<table class="data"><thead><tr><th>Singer</th><th>${kind === 'fee' ? 'Fee' : 'Songs'}</th><th></th></tr></thead><tbody>
    ${list.map((m) => `<tr>
      <td><b>${esc(m.name)}</b><br><small class="muted">${esc(m.member_no)} · ${esc(m.phone)} · ${esc(m.plan_name)}</small></td>
      <td>${kind === 'fee' ? `${feePill(m.fee)} <b>${money(m.fee_due)}</b>` : `<b>${m.count}</b> <small class="muted">${m.weeks.map((n, i) => `W${i + 1}:${n}`).join(' ')}</small>`}</td>
      <td style="text-align:right"><a class="btn btn-green btn-sm" target="_blank" rel="noopener" data-sent href="${waLink(m.phone, kind === 'fee' ? feeText(m, d) : reportText(m, d))}">Send on WhatsApp</a></td>
    </tr>`).join('')}</tbody></table>` : `<div class="empty">${kind === 'fee' ? '🎉 Everyone has paid this month.' : 'No singers yet.'}</div>`;
}
$('rMonth').addEventListener('change', () => loadReminders().catch((e) => App.toast(e.message, 'error')));
document.querySelectorAll('#rKind input').forEach((r) => r.addEventListener('change', () => loadReminders().catch((e) => App.toast(e.message, 'error'))));
$('remindTable').addEventListener('click', (e) => { const a = e.target.closest('[data-sent]'); if (a) { a.textContent = '✓ Opened'; a.classList.replace('btn-green', 'btn-ghost'); } });
const _loadMembers = LOADERS.members;
LOADERS.members = async () => { await _loadMembers(); await loadReminders(); };

// ---------- weekly events ----------
let eventsData = null;
const evStatus = (e) => e.done ? '<span class="pill approved">✔ Done</span>'
  : e.published ? '<span class="pill paid">📋 Line-up published</span>'
    : e.songs_open ? '<span class="pill pending">🎵 Taking songs</span>'
      : e.voting_open ? '<span class="pill pending">🗳 Voting open</span>' : '<span class="pill unpaid">Paused</span>';
const fmtEvDay = (d) => App.fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

async function loadEvents() {
  eventsData = await App.api('api/admin/events');
  const old = eventsData.events.filter((e) => e.old);
  $('eventsHelp').textContent = `Events are kept for ${eventsData.keep_weeks} weeks. Older weeks are greyed out – delete them with "Delete old weeks" when you're happy (songs already counted stay in each singer's record).`;
  $('deleteOld').textContent = `🗑 Delete old weeks${old.length ? ` (${old.length})` : ''}`;
  $('deleteOld').disabled = !old.length;
  $('eventTable').innerHTML = eventsData.events.length ? `<table class="data"><thead><tr><th>Date</th><th>Event</th><th>Status</th><th>In</th><th>Sent songs</th><th>Line-up</th><th></th></tr></thead><tbody>
    ${eventsData.events.map((e) => `<tr class="${e.old ? 'muted-row' : ''}">
      <td style="white-space:nowrap">${fmtEvDay(e.event_date)}${e.event_time ? `<br><small class="muted">${esc(e.event_time)}</small>` : ''}</td>
      <td><a href="#" data-ev="${e.id}"><b>${esc(e.title)}</b></a>${e.video_link ? ' 🎬' : ''}${e.old ? ' <span class="pill unpaid">Older than ' + eventsData.keep_weeks + ' weeks</span>' : ''}</td>
      <td>${evStatus(e)}</td><td><b>${e.going}</b> <small class="muted">/ ${e.going + e.not_going} voted</small></td><td>${e.sent_songs}</td><td>${e.lineup} song${e.lineup === 1 ? '' : 's'}</td>
      <td><button class="btn btn-primary btn-sm" data-ev="${e.id}">Open</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No events yet – create this week\'s event and share the link in the WhatsApp group.</div>';
}
LOADERS.events = loadEvents;

$('eventTable').addEventListener('click', (e) => { const b = e.target.closest('[data-ev]'); if (b) { e.preventDefault(); openEvent(Number(b.dataset.ev)); } });
$('deleteOld').onclick = async () => {
  const old = eventsData.events.filter((e) => e.old);
  if (!old.length) return;
  if (!confirm(`Delete ${old.length} event${old.length === 1 ? '' : 's'} older than ${eventsData.keep_weeks} weeks?\n\n${old.map((e) => `• ${e.title} – ${e.event_date}`).join('\n')}\n\nVotes, song choices and line-ups of these weeks will be removed. Songs already counted stay in each singer's record. This can't be undone.`)) return;
  try {
    const r = await App.api('api/admin/events/delete-old', { method: 'POST', body: { confirm: true } });
    App.toast(`${r.deleted} old event${r.deleted === 1 ? '' : 's'} deleted`, 'ok');
    loadEvents();
  } catch (err) { App.toast(err.message, 'error'); }
};

function nextSunday() { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return App.ymd(d); }
const eventForm = (e = {}) => `<div class="form-grid">
  <div class="field full"><label>Title <span class="req">*</span></label><input name="title" required maxlength="120" value="${esc(e.title || 'Weekly Karaoke Night')}"></div>
  <div class="field"><label>Date <span class="req">*</span></label><input name="event_date" type="date" required value="${esc(e.event_date || nextSunday())}"></div>
  <div class="field"><label>Time</label><input name="event_time" maxlength="40" placeholder="6:00 PM" value="${esc(e.event_time || '')}"></div>
  <div class="field full"><label>Venue</label><input name="venue" maxlength="120" placeholder="Rhythm Rehearsal Studio" value="${esc(e.venue || '')}"></div>
  <div class="field full"><label>Notes for singers</label><textarea name="notes" maxlength="1000" placeholder="e.g. Please send songs by Friday 9 PM">${esc(e.notes || '')}</textarea></div></div>`;

$('newEvent').onclick = () => modal('New weekly event', eventForm(), { submitText: 'Create event', onSubmit: async (f) => {
  const r = await App.api('api/admin/events', { method: 'POST', body: f });
  App.toast('Event created – share the voting link in the WhatsApp group', 'ok');
  loadEvents();
  openEvent(r.id, 'share');
} });

// ----- event workspace (modal with tabs) -----
let evModal = null, evTab = 'share', ev = null;
const TABS = [['share', 'Details & sharing'], ['votes', 'Votes'], ['songs', 'Song choices'], ['lineup', 'Line-up']];

async function openEvent(id, tab) {
  ev = await App.api(`api/admin/events/${id}`);
  if (tab) evTab = tab;
  const e = ev.event, going = ev.votes.filter((v) => v.going);
  const counts = { votes: `${going.length} in`, songs: new Set(ev.choices.map((c) => c.member_id)).size, lineup: ev.lineup.length };
  const body = `<div class="ev-tabs" role="tablist">${TABS.map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === evTab}" class="${k === evTab ? 'on' : ''}" data-tab="${k}">${t}${counts[k] !== undefined ? ` <small>${counts[k]}</small>` : ''}</button>`).join('')}</div>
    <div class="ev-tab-body">${({ share: tabShare, votes: tabVotes, songs: tabSongs, lineup: tabLineup })[evTab]()}</div>`;
  const title = `${esc(e.title)} · ${fmtEvDay(e.event_date)}`;
  if (evModal && document.body.contains(evModal.el)) {
    evModal.el.querySelector('.modal-head h3').innerHTML = title;
    evModal.el.querySelector('.modal-body').innerHTML = body;
  } else {
    evModal = modal(title, body, { wide: true });
    evModal.el.querySelector('.modal').style.maxWidth = '1040px';
    evModal.el.addEventListener('click', onEventClick);
    evModal.el.addEventListener('change', onEventChange);
    evModal.el.addEventListener('input', onEventInput);
  }
}
const refresh = () => { loadEvents(); return openEvent(ev.event.id); };

// Details & sharing
function tabShare() {
  const e = ev.event, link = siteUrl(`event.html?id=${e.id}`);
  const when = [fmtEvDay(e.event_date), e.event_time, e.venue].filter(Boolean).join(' · ');
  const msgs = {
    vote: `🎤 *${e.title}*\n${when}\n\nAre you singing this week? Tap to vote:\n${link}`,
    songs: `🎵 Song choices are open for *${e.title}* (${fmtEvDay(e.event_date)}).\nAdd your solo and duet songs here:\n${link}`,
    lineup: `📋 The line-up for *${e.title}* is ready! Check your songs and partners:\n${link}`,
    video: `🎬 Videos from *${e.title}* (${fmtEvDay(e.event_date)}) are up – open the event page to watch:\n${link}`,
  };
  const sw = (k, label, help) => `<label class="ev-switch"><input type="checkbox" data-flag="${k}" ${e[k] ? 'checked' : ''}><span><b>${label}</b><br><small class="muted">${help}</small></span></label>`;
  return `<div class="ev-grid">
    <div>
      <h4>Steps</h4>
      ${sw('voting_open', '1 · Voting open', 'Singers say I\'m in / Not this week')}
      ${sw('songs_open', '2 · Song choices open', 'Singers who are in add solo and duet songs')}
      ${sw('published', '3 · Line-up published', 'Each singer sees only their own songs')}
      <div class="ev-finish">${e.done
        ? `<span class="pill approved">✔ Finished – ${ev.lineup.length} line-up songs added to the singers' monthly counts</span> <button type="button" class="btn btn-ghost btn-sm" data-act="finish">Count again</button>`
        : `<button type="button" class="btn btn-dark" data-act="finish">4 · Finish week &amp; count songs</button><br><small class="muted">After the evening: adds every line-up song to the singers' records (a duet counts for both). Plans move up automatically if a singer passes their limit.</small>`}</div>
      <h4 style="margin-top:20px">🎬 Video link (Google Drive)</h4>
      <div style="display:flex;gap:8px"><input id="evVideo" type="url" placeholder="https://drive.google.com/…" value="${esc(e.video_link || '')}" style="flex:1;min-width:0">
        <button type="button" class="btn btn-primary btn-sm" data-act="video">Save</button></div>
      <small class="muted">Shown on the event page to the singers who took part. In Drive, set sharing to "Anyone with the link".</small>
    </div>
    <div>
      <h4>Share in the WhatsApp group</h4>
      <div style="display:flex;gap:8px;margin-bottom:10px"><input readonly value="${esc(link)}" style="flex:1;min-width:0" id="evLink"><button type="button" class="btn btn-ghost btn-sm" data-act="copy">Copy</button></div>
      <div class="ev-share">
        <a class="btn btn-green btn-sm" target="_blank" rel="noopener" href="${waShare(msgs.vote)}">📣 Ask to vote</a>
        <a class="btn btn-green btn-sm" target="_blank" rel="noopener" href="${waShare(msgs.songs)}">🎵 Songs open</a>
        <a class="btn btn-green btn-sm" target="_blank" rel="noopener" href="${waShare(msgs.lineup)}">📋 Line-up ready</a>
        ${e.video_link ? `<a class="btn btn-green btn-sm" target="_blank" rel="noopener" href="${waShare(msgs.video)}">🎬 Videos up</a>` : ''}
      </div>
      <small class="muted">WhatsApp opens with the message ready – choose your group and send.</small>
      <form id="evEdit" style="margin-top:18px"><h4>Event details</h4>${eventForm(e)}
        <div class="actions" style="margin-top:12px"><button class="btn btn-primary btn-sm">Save details</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="delete" style="color:var(--red)">Delete event</button></div></form>
    </div></div>`;
}

// Votes
function tabVotes() {
  const e = ev.event, link = siteUrl(`event.html?id=${e.id}`);
  const ins = ev.votes.filter((v) => v.going), outs = ev.votes.filter((v) => !v.going);
  const person = (m, btns) => `<li><span><b>${esc(m.name)}</b> <small class="muted">${m.gender === 'Female' ? '♀' : '♂'} ${esc(m.member_no)}</small>${m.approved ? '' : ' <span class="pill pending">New</span>'}</span><span class="actions">${btns}</span></li>`;
  const remind = (m) => `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${waLink(m.phone, `Hi ${firstName(m.name)}, are you singing at ${e.title} (${fmtEvDay(e.event_date)})? Please vote here: ${link}`)}">💬 Remind</a>`;
  const col = (title, list, btns, empty) => `<div><h4>${title} <small class="muted">${list.length}</small></h4>${list.length ? `<ul class="ev-people">${list.map((m) => person(m, btns(m))).join('')}</ul>` : `<p class="muted">${empty}</p>`}</div>`;
  const byG = (g) => ins.filter((v) => v.gender === g).length;
  return `<p class="muted" style="margin-top:0">${ins.length} in (${byG('Male')} male, ${byG('Female')} female) · ${outs.length} not coming · ${ev.silent.length} haven't answered. You can set an answer yourself for singers who replied on WhatsApp.</p>
    <div class="ev-grid three">
      ${col('🎤 In', ins, (m) => `<button type="button" class="btn btn-ghost btn-sm" data-vote="${m.id}" data-going="0">Mark out</button>`, 'Nobody yet.')}
      ${col('🙅 Not coming', outs, (m) => `<button type="button" class="btn btn-ghost btn-sm" data-vote="${m.id}" data-going="1">Mark in</button>`, 'Nobody.')}
      ${col('… No answer', ev.silent, (m) => `${remind(m)}<button type="button" class="btn btn-ghost btn-sm" data-vote="${m.id}" data-going="1">In</button><button type="button" class="btn btn-ghost btn-sm" data-vote="${m.id}" data-going="0">Out</button>`, 'Everyone has answered.')}
    </div>`;
}

// Song choices
const nameOf = (id) => { const v = ev.votes.find((x) => x.id === id); return v ? v.name : `#${id}`; };
const labelOf = (id) => { const v = ev.votes.find((x) => x.id === id); return v ? `${v.name} (${v.member_no})` : ''; };
function tabSongs() {
  const ins = ev.votes.filter((v) => v.going);
  const list = (id, kind) => ev.choices.filter((c) => c.member_id === id && c.kind === kind);
  const fmt = (arr) => (arr.length ? `<ol class="ev-mini">${arr.map((c) => `<li>${esc(c.title)}${c.album ? ` <small class="muted">${esc(c.album)}</small>` : ''}</li>`).join('')}</ol>` : '<span class="muted">–</span>');
  return `<div class="card-head" style="margin-bottom:8px"><p class="muted" style="margin:0">${ev.event.songs_open ? 'Song choices are open – singers add them on the event page.' : 'Song choices are closed. Turn on step 2 in Details to let singers add songs.'}</p>
      <div class="actions"><button type="button" class="btn btn-ghost btn-sm" data-act="ch-template">⬇ Template</button><button type="button" class="btn btn-ghost btn-sm" data-act="ch-upload">⬆ Upload Excel</button><button type="button" class="btn btn-ghost btn-sm" data-act="ch-download">⬇ Download Excel</button></div></div>
    ${ins.length ? `<table class="data"><thead><tr><th>Singer</th><th>Solo</th><th>Duet</th><th></th></tr></thead><tbody>
      ${ins.map((m) => `<tr><td><b>${esc(m.name)}</b><br><small class="muted">${m.gender} · ${esc(m.member_no)}</small></td><td>${fmt(list(m.id, 'solo'))}</td><td>${fmt(list(m.id, 'duet'))}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-editch="${m.id}">Edit</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">No singers are in yet.</div>'}`;
}

// Line-up editor
let draft = null;
function tabLineup() {
  const ins = ev.votes.filter((v) => v.going);
  if (!draft || draft.eventId !== ev.event.id) {
    draft = { eventId: ev.event.id, rows: ev.lineup.map((r) => ({ male: r.male_id || '', female: r.female_id || '', title: r.title, album: r.album || '' })) };
  }
  if (!draft.rows.length) draft.rows.push({ male: '', female: '', title: '', album: '' });
  const males = ins.filter((v) => v.gender === 'Male'), females = ins.filter((v) => v.gender === 'Female');
  const opts = (list, sel, none) => `<option value="">${none}</option>${list.map((m) => `<option value="${m.id}" ${String(sel) === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}`;
  const per = {};
  for (const r of draft.rows) for (const k of ['male', 'female']) if (r[k]) per[r[k]] = (per[r[k]] || 0) + 1;
  return `<div class="card-head" style="margin-bottom:8px"><p class="muted" style="margin:0">Pick the male singer, choose his partner from the dropdown and the song. Leave one side empty for a solo. Song suggestions come from both singers' choices.</p>
      <div class="actions"><button type="button" class="btn btn-ghost btn-sm" data-act="lu-template">⬇ Template</button><button type="button" class="btn btn-ghost btn-sm" data-act="lu-upload">⬆ Upload Excel</button><button type="button" class="btn btn-ghost btn-sm" data-act="lu-download">⬇ Download Excel</button></div></div>
    <div class="table-wrap"><table class="data lineup-edit"><thead><tr><th>#</th><th>Male singer</th><th>Female singer</th><th>Song</th><th>Movie / album</th><th></th></tr></thead><tbody>
      ${draft.rows.map((r, i) => `<tr data-i="${i}"><td class="muted">${i + 1}</td>
        <td><select data-f="male">${opts(males, r.male, '— none (solo) —')}</select></td>
        <td><select data-f="female">${opts(females, r.female, '— none (solo) —')}</select></td>
        <td><input data-f="title" list="dl${i}" value="${esc(r.title)}" placeholder="Song"><datalist id="dl${i}">${suggestions(r).map((s) => `<option value="${esc(s.title)}">${esc(s.who)}${s.album ? ' · ' + esc(s.album) : ''}</option>`).join('')}</datalist></td>
        <td><input data-f="album" value="${esc(r.album)}" placeholder="Optional"></td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-rmrow="${i}" aria-label="Remove row">×</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="actions" style="margin-top:10px">
      <button type="button" class="btn btn-ghost btn-sm" data-act="lu-add">+ Add row</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="lu-males">+ One row per male singer</button>
      <span class="spacer"></span>
      <button type="button" class="btn btn-outline" data-act="lu-save">Save draft</button>
      <button type="button" class="btn btn-primary" data-act="lu-publish">${ev.event.published ? 'Save & keep published' : 'Save & publish to singers'}</button>
    </div>
    ${ins.length ? `<p class="muted" style="font-size:13px">Songs per singer: ${ins.map((m) => `${esc(firstName(m.name))} ${per[m.id] || 0}`).join(' · ')}</p>` : '<p class="muted">No singers are in yet.</p>'}`;
}
function suggestions(r) {
  const out = [];
  for (const id of [r.male, r.female].filter(Boolean).map(Number)) {
    const kind = r.male && r.female ? 'duet' : 'solo';
    for (const c of ev.choices.filter((x) => x.member_id === id && x.kind === kind)) out.push({ title: c.title, album: c.album, who: `${nameOf(id)}'s ${kind}` });
  }
  return out;
}
const readDraft = () => {
  evModal.el.querySelectorAll('.lineup-edit tbody tr').forEach((tr) => {
    const r = draft.rows[Number(tr.dataset.i)];
    tr.querySelectorAll('[data-f]').forEach((el) => { r[el.dataset.f] = el.value; });
  });
};

async function saveLineup(publish) {
  readDraft();
  const rows = draft.rows.filter((r) => r.male || r.female || r.title.trim()).map((r) => ({ male: r.male ? Number(r.male) : null, female: r.female ? Number(r.female) : null, title: r.title, album: r.album }));
  const r = await App.api(`api/admin/events/${ev.event.id}/lineup`, { method: 'PUT', body: { rows, publish: publish || ev.event.published ? true : undefined } });
  if (!r.ok) return App.toast(r.errors.join(' · '), 'error');
  App.toast(publish && !ev.event.published ? `Line-up published – ${r.rows} songs. Share "Line-up ready" in the group.` : `Line-up saved – ${r.rows} songs`, 'ok');
  draft = null;
  await refresh();
}

async function onEventChange(e) {
  const f = e.target.dataset.flag;
  if (f) {
    try {
      await App.api(`api/admin/events/${ev.event.id}`, { method: 'PUT', body: { [f]: e.target.checked } });
      App.toast('Updated', 'ok');
      await refresh();
    } catch (err) { App.toast(err.message, 'error'); e.target.checked = !e.target.checked; }
    return;
  }
  // Line-up: a new singer choice refreshes the song suggestions for that row.
  const tr = e.target.closest('.lineup-edit tr[data-i]');
  if (tr && (e.target.dataset.f === 'male' || e.target.dataset.f === 'female')) {
    readDraft();
    const r = draft.rows[Number(tr.dataset.i)];
    tr.querySelector('datalist').innerHTML = suggestions(r).map((s) => `<option value="${esc(s.title)}">${esc(s.who)}${s.album ? ' · ' + esc(s.album) : ''}</option>`).join('');
  }
}
function onEventInput(e) {
  // Picking a suggested song fills in its movie / album.
  if (e.target.dataset.f !== 'title') return;
  const tr = e.target.closest('tr[data-i]');
  readDraft();
  const r = draft.rows[Number(tr.dataset.i)];
  const hit = suggestions(r).find((s) => s.title === e.target.value);
  const alb = tr.querySelector('[data-f=album]');
  if (hit && hit.album && !alb.value) { alb.value = hit.album; r.album = hit.album; }
}

async function onEventClick(e) {
  const t = e.target.closest('button, a');
  if (!t || t.hasAttribute('data-close')) return;
  const id = ev.event.id;
  try {
    if (t.dataset.tab) { if (evTab === 'lineup' && draft) readDraft(); evTab = t.dataset.tab; return openEvent(id); }
    if (t.dataset.vote) {
      await App.api(`api/admin/events/${id}/votes/${t.dataset.vote}`, { method: 'PUT', body: { going: t.dataset.going === '1' } });
      return refresh();
    }
    if (t.dataset.editch) return editChoices(Number(t.dataset.editch));
    if (t.dataset.rmrow) { readDraft(); draft.rows.splice(Number(t.dataset.rmrow), 1); return openEvent(id); }
    switch (t.dataset.act) {
      case 'copy': navigator.clipboard.writeText($('evLink').value).then(() => App.toast('Link copied', 'ok')); return undefined;
      case 'video':
        await App.api(`api/admin/events/${id}`, { method: 'PUT', body: { video_link: $('evVideo').value.trim() } });
        App.toast('Video link saved – participants see it on the event page', 'ok');
        return refresh();
      case 'delete':
        if (!confirm(`Delete "${ev.event.title}" (${ev.event.event_date}) with its votes, song choices and line-up?\nSongs already counted stay in the singers' records. This can't be undone.`)) return undefined;
        await App.api(`api/admin/events/${id}`, { method: 'DELETE' });
        evModal.close();
        App.toast('Event deleted', 'ok');
        return loadEvents();
      case 'finish': {
        if (!confirm(`Finish "${ev.event.title}" and add the ${ev.lineup.length} line-up songs to the singers' monthly counts?\n\nA duet counts for both singers. Plans move up automatically if anyone passes their limit. Voting and song choices will close.`)) return undefined;
        const r = await App.api(`api/admin/events/${id}/finish`, { method: 'POST' });
        App.toast(`Done – ${r.songs} songs added for ${r.singers} singers${r.upgraded ? ` · ${r.upgraded} plan${r.upgraded === 1 ? '' : 's'} moved up` : ''}`, 'ok');
        return refresh();
      }
      case 'lu-add': readDraft(); draft.rows.push({ male: '', female: '', title: '', album: '' }); return openEvent(id);
      case 'lu-males': {
        readDraft();
        const used = new Set(draft.rows.map((r) => String(r.male)));
        ev.votes.filter((v) => v.going && v.gender === 'Male' && !used.has(String(v.id))).forEach((m) => draft.rows.push({ male: m.id, female: '', title: '', album: '' }));
        draft.rows = draft.rows.filter((r) => r.male || r.female || r.title);
        return openEvent(id);
      }
      case 'lu-save': return saveLineup(false);
      case 'lu-publish': return saveLineup(true);
      case 'lu-template':
        return xlDownload('lineup-template.xlsx', 'Line-up', ['Male Singer', 'Female Singer', 'Song', 'Movie'], [
          ['Ravi Kumar', 'Seetha Raman', 'Uyire Uyire', 'Bombay'], ['RRS1003', '9840022334', 'Vennilave Vennilave', 'Minsara Kanavu'], ['Ravi Kumar', '', 'Ilaya Nila (solo)', 'Payanangal Mudivathillai']]);
      case 'lu-download':
        return xlDownload(`lineup-${ev.event.event_date}.xlsx`, 'Line-up', ['Male Singer', 'Female Singer', 'Song', 'Movie'],
          ev.lineup.map((r) => [r.male_id ? labelOf(r.male_id) || r.male_name : '', r.female_id ? labelOf(r.female_id) || r.female_name : '', r.title, r.album || '']));
      case 'lu-upload':
        return xlImport({
          title: 'Upload line-up',
          map: { malesinger: 'male', male: 'male', femalesinger: 'female', female: 'female', song: 'title', songname: 'title', movie: 'album', moviealbum: 'album', album: 'album' },
          send: (rows, dry) => App.api(`api/admin/events/${id}/lineup`, { method: 'PUT', body: { rows, dry_run: dry, from_excel: true } }),
          describe: (r) => (r.dry_run ? `<b>${r.rows}</b> line-up songs found. Saving replaces the current line-up.` : `Line-up uploaded – ${r.rows} songs`),
          after: () => { draft = null; return refresh(); },
        });
      case 'ch-template':
        return xlDownload('song-choices-template.xlsx', 'Song choices', ['Singer', 'Type', 'Song', 'Movie'], [
          ['Ravi Kumar', 'Solo', 'Ilaya Nila', 'Payanangal Mudivathillai'], ['Ravi Kumar', 'Duet', 'Uyire Uyire', 'Bombay'], ['9840022334', 'Duet', 'Vennilave Vennilave', 'Minsara Kanavu']]);
      case 'ch-download':
        return xlDownload(`song-choices-${ev.event.event_date}.xlsx`, 'Song choices', ['Singer', 'Type', 'Song', 'Movie'],
          ev.choices.map((c) => [labelOf(c.member_id), c.kind === 'solo' ? 'Solo' : 'Duet', c.title, c.album || '']));
      case 'ch-upload':
        return xlImport({
          title: 'Upload song choices',
          map: { singer: 'member', name: 'member', member: 'member', phone: 'member', memberno: 'member', type: 'kind', soloduet: 'kind', kind: 'kind', song: 'title', songname: 'title', movie: 'album', moviealbum: 'album', album: 'album' },
          send: (rows, dry) => App.api(`api/admin/events/${id}/choices/import`, { method: 'POST', body: { rows, dry_run: dry } }),
          describe: (r) => `<b>${r.songs}</b> songs for <b>${r.singers}</b> singer${r.singers === 1 ? '' : 's'}. Saving replaces those singers' choices and marks them as "in".`,
          after: refresh,
        });
      default: return undefined;
    }
  } catch (err) { App.toast(err.message, 'error'); }
}

function editChoices(memberId) {
  const lines = (kind) => ev.choices.filter((c) => c.member_id === memberId && c.kind === kind).map((c) => c.title + (c.album ? ' – ' + c.album : '')).join('\n');
  modal(`Song choices – ${esc(nameOf(memberId))}`, `<p class="muted" style="margin-top:0">One song per line, optionally "Song – Movie".</p><div class="form-grid">
    <div class="field"><label>Solo songs</label><textarea name="solo" style="min-height:180px">${esc(lines('solo'))}</textarea></div>
    <div class="field"><label>Duet songs</label><textarea name="duet" style="min-height:180px">${esc(lines('duet'))}</textarea></div></div>`,
  { submitText: 'Save', wide: true, onSubmit: async (f) => {
    const parse = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [title, ...rest] = l.split(/\s+[–—-]\s+/); return { title: title.trim(), album: rest.join(' - ').trim() }; });
    await App.api(`api/admin/events/${ev.event.id}/choices/${memberId}`, { method: 'PUT', body: { solo: parse(f.solo), duet: parse(f.duet) } });
    App.toast('Song choices saved', 'ok');
    await refresh();
  } });
}

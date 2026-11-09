// Weekly singing events: the admin posts an event, singers vote (anyone with the link; new phone numbers become
// singers waiting for approval), those going send their solo / duet song choices, the admin publishes the line-up
// (male + female pairs and solos) and a video link. Each singer only sees the line-up rows they are part of.
// Finishing an event adds its songs to the singers' monthly counts (plans move up automatically).
const { db, getSettings, hashPassword, verifyPassword } = require('./db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const keepWeeks = () => { const n = Number(getSettings().events_keep_weeks); return n >= 4 && n <= 104 ? n : 13; };
const cutoff = () => { const d = new Date(); d.setDate(d.getDate() - keepWeeks() * 7); return ymd(d); };
const err = (status, message) => Object.assign(new Error(message), { status });

const getEvent = (id) => db.prepare('SELECT * FROM events WHERE id = ?').get(id);
const memberLite = (m) => m && { id: m.id, member_no: m.member_no, name: m.name, gender: m.gender, phone: m.phone, approved: m.approved !== 0 };

function choicesOf(eventId, memberId) {
  const rows = db.prepare('SELECT kind, title, album FROM event_choices WHERE event_id = ? AND member_id = ? ORDER BY kind, sort, id').all(eventId, memberId);
  return { solo: rows.filter((r) => r.kind === 'solo').map(({ title, album }) => ({ title, album })), duet: rows.filter((r) => r.kind === 'duet').map(({ title, album }) => ({ title, album })) };
}

function lineup(eventId, memberId = null) {
  const rows = db.prepare(`SELECT p.id, p.title, p.album, p.sort, p.male_id, p.female_id, m.name male_name, f.name female_name
    FROM event_pairs p LEFT JOIN members m ON m.id = p.male_id LEFT JOIN members f ON f.id = p.female_id
    WHERE p.event_id = ? ORDER BY p.sort, p.id`).all(eventId);
  return memberId == null ? rows : rows.filter((r) => r.male_id === memberId || r.female_id === memberId);
}

// Public view of an event for the given (possibly logged-out) visitor.
function eventView(e, me) {
  const going = db.prepare('SELECT COUNT(*) n FROM event_votes WHERE event_id = ? AND going = 1').get(e.id).n;
  const view = { id: e.id, title: e.title, event_date: e.event_date, event_time: e.event_time, venue: e.venue, notes: e.notes,
    open: !!e.voting_open && !e.done, voting_open: !!e.voting_open && !e.done, published: !!e.published, done: !!e.done, going_count: going,
    video_link: null, me: null };
  if (me) {
    const v = db.prepare('SELECT going, admin_out, note FROM event_votes WHERE event_id = ? AND member_id = ?').get(e.id, me.id);
    const vote = v ? (v.going ? 'yes' : 'no') : null;
    view.me = { member: memberLite(me), vote, removed: !!(v && v.admin_out), note: v && v.admin_out ? v.note : null, choices: choicesOf(e.id, me.id), lineup: e.published && vote === 'yes' ? lineup(e.id, me.id) : [] };
    // The week's video goes to the singers who took part.
    if (vote === 'yes') view.video_link = e.video_link || null;
  }
  return view;
}

module.exports = function mountEvents(app, { notify, members }) {
  const { memberFromReq, requireMember, setMemberCookie, autoUpgrade, plansFor, memberByPhone, phoneKey, nextMemberNo, monthEndOf } = members;
  const fail = (res, status, error) => res.status(status).json({ error });

  // ---------- singers ----------
  // Current = the next event that isn't finished (else the latest one).
  app.get('/api/events/current', (req, res) => {
    const e = db.prepare('SELECT * FROM events WHERE done = 0 ORDER BY event_date, id LIMIT 1').get()
      || db.prepare('SELECT * FROM events ORDER BY event_date DESC, id DESC LIMIT 1').get();
    res.json({ event: e ? eventView(e, memberFromReq(req)) : null, logged_in: !!memberFromReq(req) });
  });
  app.get('/api/events/:id', (req, res) => {
    const e = getEvent(req.params.id);
    if (!e) return fail(res, 404, 'Event not found.');
    res.json({ event: eventView(e, memberFromReq(req)), logged_in: !!memberFromReq(req) });
  });

  // My events in the kept period: vote, my line-up rows and the video link.
  app.get('/api/member/events', requireMember, (req, res) => {
    const list = db.prepare('SELECT * FROM events WHERE event_date >= ? ORDER BY event_date DESC, id DESC').all(cutoff());
    res.json({ events: list.map((e) => eventView(e, req.member)) });
  });

  // Vote. Logged-in singers just vote; others give their phone (+ PIN if already a singer, or name + gender if new).
  app.post('/api/events/:id/vote', (req, res) => {
    const e = getEvent(req.params.id);
    if (!e) return fail(res, 404, 'Event not found.');
    if (!e.voting_open || e.done) return fail(res, 400, 'This event is closed.');
    const going = req.body.going ? 1 : 0;
    let m = memberFromReq(req), newPin = null;
    if (!m) {
      const phone = clean(req.body.phone, 20);
      if (phoneKey(phone).length < 10) return fail(res, 400, 'Please enter your 10-digit mobile number.');
      m = memberByPhone(phone);
      if (m) {
        if (!verifyPassword(String(req.body.pin || ''), m.pin_hash)) {
          return res.status(401).json({ error: 'This number is already registered – enter your PIN (first PIN: last 4 digits of your phone).', need_pin: true });
        }
      } else {
        const name = clean(req.body.name, 80);
        const gender = req.body.gender === 'Female' ? 'Female' : req.body.gender === 'Male' ? 'Male' : null;
        if (!name || !gender) return res.status(400).json({ error: 'New here? Please enter your name and choose Male or Female.', need_details: true });
        const plan = plansFor(gender)[0];
        if (!plan) return fail(res, 500, 'No membership plans are set up.');
        newPin = phoneKey(phone).slice(-4);
        const start = today();
        const id = db.prepare(`INSERT INTO members (member_no, name, gender, phone, plan, start_date, valid_until, pin_hash)
          VALUES (?,?,?,?,?,?,?,?)`).run(nextMemberNo(), name, gender, phone, plan.key, start, monthEndOf(start.slice(0, 7)), hashPassword(newPin)).lastInsertRowid;
        m = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
        notify('membership', `New singer ${m.name} (${m.member_no}, ${m.phone}) joined through "${e.title}"`);
      }
      setMemberCookie(res, m.id);
    }
    const prev = db.prepare('SELECT admin_out, note FROM event_votes WHERE event_id = ? AND member_id = ?').get(e.id, m.id);
    if (going && prev && prev.admin_out) {
      return res.status(400).json({ error: `The studio has taken you off this week${prev.note ? `: ${prev.note.replace(/[.!?]*$/, '.')}` : '.'} Please contact the studio for any questions.`, event: eventView(e, m) });
    }
    db.prepare(`INSERT INTO event_votes (event_id, member_id, going) VALUES (?,?,?)
      ON CONFLICT(event_id, member_id) DO UPDATE SET going = excluded.going, voted_at = datetime('now')`).run(e.id, m.id, going);
    // "I'm in" and the song list are sent together from the event page.
    let saved = null;
    if (going && (Array.isArray(req.body.solo) || Array.isArray(req.body.duet))) saved = saveChoices(e.id, m.id, req.body);
    if (!going) db.prepare('DELETE FROM event_choices WHERE event_id = ? AND member_id = ?').run(e.id, m.id);
    res.json({ ok: true, member_no: m.member_no, new_pin: newPin, saved, event: eventView(e, m) });
  });

  // Song choices (solo and duet lists) from a singer who is going.
  function saveChoices(eventId, memberId, body) {
    const norm = (list) => (Array.isArray(list) ? list : []).map((s) => ({ title: clean(s && s.title, 120), album: clean(s && s.album, 120) || null }))
      .filter((s) => s.title).slice(0, 30);
    const solo = norm(body.solo), duet = norm(body.duet);
    db.prepare('DELETE FROM event_choices WHERE event_id = ? AND member_id = ?').run(eventId, memberId);
    const ins = db.prepare('INSERT INTO event_choices (event_id, member_id, kind, title, album, sort) VALUES (?,?,?,?,?,?)');
    solo.forEach((s, i) => ins.run(eventId, memberId, 'solo', s.title, s.album, i));
    duet.forEach((s, i) => ins.run(eventId, memberId, 'duet', s.title, s.album, i));
    return { solo: solo.length, duet: duet.length };
  }
  app.put('/api/events/:id/songs', requireMember, (req, res) => {
    const e = getEvent(req.params.id);
    if (!e) return fail(res, 404, 'Event not found.');
    if (!e.voting_open || e.done) return fail(res, 400, 'This event is closed.');
    const v = db.prepare('SELECT going FROM event_votes WHERE event_id = ? AND member_id = ?').get(e.id, req.member.id);
    if (!v || !v.going) return fail(res, 400, 'Vote "I\'m in" first to send your songs.');
    const n = saveChoices(e.id, req.member.id, req.body);
    res.json({ ok: true, ...n });
  });

  // ---------- admin ----------
  const eventFields = (b, old = {}) => {
    const title = clean(b.title ?? old.title, 120);
    const date = b.event_date ?? old.event_date;
    if (!title) throw err(400, 'Please give the event a title.');
    if (!DATE_RE.test(date || '')) throw err(400, 'Please choose the event date.');
    const link = clean(b.video_link ?? old.video_link, 500);
    if (link && !/^https:\/\//.test(link)) throw err(400, 'The video link must start with https:// (e.g. a Google Drive share link).');
    const flag = (k, d) => (b[k] === undefined ? (old[k] ?? d) : b[k] ? 1 : 0);
    return { title, event_date: date, event_time: clean(b.event_time ?? old.event_time, 40) || null, venue: clean(b.venue ?? old.venue, 120) || null,
      notes: clean(b.notes ?? old.notes, 1000) || null, voting_open: flag('voting_open', 1), songs_open: flag('songs_open', 0),
      published: flag('published', 0), video_link: link || null };
  };

  app.get('/api/admin/events', (req, res) => {
    const list = db.prepare(`SELECT e.*,
        (SELECT COUNT(*) FROM event_votes v WHERE v.event_id = e.id AND v.going = 1) going,
        (SELECT COUNT(*) FROM event_votes v WHERE v.event_id = e.id AND v.going = 0) not_going,
        (SELECT COUNT(DISTINCT member_id) FROM event_choices c WHERE c.event_id = e.id) sent_songs,
        (SELECT COUNT(*) FROM event_pairs p WHERE p.event_id = e.id) lineup
      FROM events e ORDER BY e.event_date DESC, e.id DESC`).all();
    const cut = cutoff();
    res.json({ events: list.map((e) => ({ ...e, old: e.event_date < cut })), keep_weeks: keepWeeks(), cutoff: cut });
  });

  app.post('/api/admin/events', (req, res) => {
    const f = eventFields(req.body);
    const id = db.prepare(`INSERT INTO events (title, event_date, event_time, venue, notes, voting_open, songs_open, published, video_link)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(f.title, f.event_date, f.event_time, f.venue, f.notes, f.voting_open, f.songs_open, f.published, f.video_link).lastInsertRowid;
    res.json({ ok: true, id });
  });

  app.put('/api/admin/events/:id', (req, res) => {
    const e = getEvent(req.params.id);
    if (!e) return fail(res, 404, 'Event not found.');
    const f = eventFields(req.body, e);
    db.prepare('UPDATE events SET title=?, event_date=?, event_time=?, venue=?, notes=?, voting_open=?, songs_open=?, published=?, video_link=? WHERE id=?')
      .run(f.title, f.event_date, f.event_time, f.venue, f.notes, f.voting_open, f.songs_open, f.published, f.video_link, e.id);
    res.json({ ok: true });
  });

  // Deleting needs the admin's explicit confirmation from the UI; songs already added to monthly counts stay.
  app.delete('/api/admin/events/:id', (req, res) => {
    db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/admin/events/delete-old', (req, res) => {
    if (req.body.confirm !== true) return fail(res, 400, 'Please confirm the deletion.');
    const n = db.prepare('DELETE FROM events WHERE event_date < ?').run(cutoff()).changes;
    res.json({ ok: true, deleted: n });
  });

  // Everything for one event: votes, choices, line-up and singers who haven't answered.
  app.get('/api/admin/events/:id', (req, res) => {
    const e = getEvent(req.params.id);
    if (!e) return fail(res, 404, 'Event not found.');
    const votes = db.prepare(`SELECT v.going, v.voted_at, v.admin_out, v.note, m.* FROM event_votes v JOIN members m ON m.id = v.member_id
      WHERE v.event_id = ? ORDER BY m.gender DESC, m.name`).all(e.id);
    const voted = new Set(votes.map((v) => v.id));
    const silent = db.prepare('SELECT * FROM members ORDER BY name').all().filter((m) => !voted.has(m.id));
    const choices = db.prepare(`SELECT c.member_id, c.kind, c.title, c.album FROM event_choices c WHERE c.event_id = ? ORDER BY c.member_id, c.kind, c.sort, c.id`).all(e.id);
    res.json({
      event: e,
      votes: votes.map((v) => ({ ...memberLite(v), going: !!v.going, voted_at: v.voted_at, admin_out: !!v.admin_out, note: v.note })),
      silent: silent.map(memberLite),
      choices,
      lineup: lineup(e.id),
    });
  });

  // Admin sets a vote for a singer (e.g. someone who answered on WhatsApp).
  app.put('/api/admin/events/:id/votes/:memberId', (req, res) => {
    const e = getEvent(req.params.id);
    if (!e) return fail(res, 404, 'Event not found.');
    // Taking a singer out records the studio's message (shown to the singer) and stops them re-joining this week.
    const going = req.body.going ? 1 : 0, out = going ? 0 : req.body.admin_out ? 1 : 0;
    db.prepare(`INSERT INTO event_votes (event_id, member_id, going, admin_out, note) VALUES (?,?,?,?,?)
      ON CONFLICT(event_id, member_id) DO UPDATE SET going = excluded.going, admin_out = excluded.admin_out, note = excluded.note`)
      .run(e.id, req.params.memberId, going, out, out ? clean(req.body.note, 300) || null : null);
    if (out) db.prepare('DELETE FROM event_pairs WHERE event_id = ? AND (male_id = ? OR female_id = ?)').run(e.id, req.params.memberId, req.params.memberId);
    res.json({ ok: true });
  });

  // Admin edits / imports song choices. rows: [{ member (no., phone or name), kind, title, album }]
  const findMember = (key) => {
    const k = clean(key, 80);
    if (!k) return null;
    // "Ravi Kumar (RRS1001)" as written by the Excel download
    const tagged = /\((RRS\d+)\)\s*$/i.exec(k);
    if (tagged) return db.prepare('SELECT * FROM members WHERE member_no = ?').get(tagged[1].toUpperCase());
    return db.prepare('SELECT * FROM members WHERE member_no = ?').get(k.toUpperCase())
      || (phoneKey(k).length === 10 ? memberByPhone(k) : null)
      || db.prepare('SELECT * FROM members WHERE lower(name) = lower(?)').get(k);
  };
  app.put('/api/admin/events/:id/choices/:memberId', (req, res) => {
    const e = getEvent(req.params.id);
    if (!e) return fail(res, 404, 'Event not found.');
    res.json({ ok: true, ...saveChoices(e.id, Number(req.params.memberId), req.body) });
  });
  app.post('/api/admin/events/:id/choices/import', (req, res) => {
    const e = getEvent(req.params.id);
    if (!e) return fail(res, 404, 'Event not found.');
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 3000) : [];
    const errors = [], byMember = new Map();
    rows.forEach((r, i) => {
      const m = findMember(r.member);
      const kind = /^d/i.test(r.kind || '') ? 'duet' : /^s/i.test(r.kind || '') ? 'solo' : null;
      if (!m) return errors.push(`Row ${i + 2}: singer "${r.member || ''}" not found (use member no., phone or exact name).`);
      if (!kind) return errors.push(`Row ${i + 2}: type must be Solo or Duet.`);
      if (!clean(r.title)) return errors.push(`Row ${i + 2}: song name is empty.`);
      if (!byMember.has(m.id)) byMember.set(m.id, { solo: [], duet: [] });
      byMember.get(m.id)[kind].push({ title: r.title, album: r.album });
    });
    if (!req.body.dry_run && !errors.length) {
      db.exec('BEGIN');
      for (const [id, c] of byMember) {
        saveChoices(e.id, id, c);
        db.prepare(`INSERT INTO event_votes (event_id, member_id, going) VALUES (?,?,1)
          ON CONFLICT(event_id, member_id) DO UPDATE SET going = 1`).run(e.id, id);
      }
      db.exec('COMMIT');
    }
    res.json({ ok: !errors.length, singers: byMember.size, songs: rows.length - errors.length, errors, dry_run: !!req.body.dry_run });
  });

  // Line-up: rows of { male, female, title, album } — male/female are member ids (UI) or no./phone/name (Excel).
  app.put('/api/admin/events/:id/lineup', (req, res) => {
    const e = getEvent(req.params.id);
    if (!e) return fail(res, 404, 'Event not found.');
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 500) : [];
    const errors = [], out = [];
    // The admin screen sends member ids; an Excel sheet has member no., phone or name.
    const resolve = (v) => (req.body.from_excel ? findMember(v) : db.prepare('SELECT * FROM members WHERE id = ?').get(Number(v)));
    // Same-gender duets (two male or two female singers) are allowed. From Excel we ask once to be sure it
    // isn't a typo: answers come back as confirm (row indexes to keep) / skip (row indexes to leave out).
    const confirm = new Set((req.body.confirm || []).map(Number)), skip = new Set((req.body.skip || []).map(Number));
    const questions = [];
    rows.forEach((r, i) => {
      const line = req.body.from_excel ? `Row ${i + 2}` : `Line ${i + 1}`;
      const title = clean(r.title, 120);
      const a = r.male ? resolve(r.male) : null, b = r.female ? resolve(r.female) : null;
      if (!title && !r.male && !r.female) return; // empty row
      if (skip.has(i)) return;
      if (r.male && !a) return errors.push(`${line}: singer "${r.male}" not found.`);
      if (r.female && !b) return errors.push(`${line}: singer "${r.female}" not found.`);
      if (!a && !b) return errors.push(`${line}: choose at least one singer.`);
      if (!title) return errors.push(`${line}: song name is empty.`);
      if (a && b && a.id === b.id) return errors.push(`${line}: the same singer is in both columns.`);
      let male = a, female = b;
      if (a && b && a.gender !== b.gender) { male = a.gender === 'Female' ? b : a; female = a.gender === 'Female' ? a : b; }
      else if (!a || !b) { const one = a || b; male = one.gender === 'Female' ? null : one; female = one.gender === 'Female' ? one : null; }
      else if (req.body.from_excel && !confirm.has(i)) {
        const g = a.gender === 'Female' ? 'Female' : 'Male';
        const t = String(r.duet_type || '').trim().toLowerCase();
        const said = t.startsWith(g.toLowerCase()) || t === g[0].toLowerCase() || t === 'yes' || t.startsWith('same');
        if (!said) return questions.push({ row: i, gender: g, text: `${line}: ${a.name} & ${b.name} – "${title}". Is it a ${g} duet?` });
      }
      out.push({ male: male && male.id, female: female && female.id, title, album: clean(r.album, 120) || null });
    });
    if (questions.length) return res.json({ ok: !errors.length, rows: out.length, errors, questions, dry_run: true });
    if (errors.length || req.body.dry_run) return res.json({ ok: !errors.length, rows: out.length, errors, dry_run: !!req.body.dry_run });
    db.exec('BEGIN');
    db.prepare('DELETE FROM event_pairs WHERE event_id = ?').run(e.id);
    const ins = db.prepare('INSERT INTO event_pairs (event_id, male_id, female_id, title, album, sort) VALUES (?,?,?,?,?,?)');
    out.forEach((r, i) => ins.run(e.id, r.male, r.female, r.title, r.album, i));
    if (req.body.publish !== undefined) db.prepare('UPDATE events SET published = ? WHERE id = ?').run(req.body.publish ? 1 : 0, e.id);
    const mark = db.prepare(`INSERT INTO event_votes (event_id, member_id, going) VALUES (?,?,1)
      ON CONFLICT(event_id, member_id) DO UPDATE SET going = 1, admin_out = 0`);
    for (const r of out) for (const id of [r.male, r.female]) if (id) mark.run(e.id, id);
    db.exec('COMMIT');
    const recount = e.done ? countEvent(e) : null;
    res.json({ ok: true, rows: out.length, recounted: recount });
  });

  // Count the week: the final pairing list (line-up) decides. Every line-up song is added to the singers'
  // song records on the event date (a duet counts for both). Running it again replaces that event's songs.
  function countEvent(e) {
    const rows = lineup(e.id);
    db.exec('BEGIN');
    db.prepare('DELETE FROM member_songs WHERE event_id = ?').run(e.id);
    const ins = db.prepare('INSERT INTO member_songs (member_id, sung_on, title, album, event_id) VALUES (?,?,?,?,?)');
    const singers = new Set();
    let songs = 0;
    for (const r of rows) for (const id of [r.male_id, r.female_id]) if (id) { ins.run(id, e.event_date, r.title, r.album, e.id); singers.add(id); songs++; }
    db.prepare('UPDATE events SET done = 1, voting_open = 0 WHERE id = ?').run(e.id);
    db.exec('COMMIT');
    let upgraded = 0;
    if (e.event_date.slice(0, 7) === today().slice(0, 7)) for (const id of singers) if (autoUpgrade(id)) upgraded++;
    return { singers: singers.size, songs, upgraded };
  }

  app.post('/api/admin/events/:id/finish', (req, res) => {
    const e = getEvent(req.params.id);
    if (!e) return fail(res, 404, 'Event not found.');
    if (e.event_date > today()) return fail(res, 400, 'The event date hasn\'t come yet.');
    if (!lineup(e.id).length) return fail(res, 400, 'Add the line-up first.');
    res.json({ ok: true, ...countEvent(e) });
  });

  // Automatic count at 00:01 (India time) the day after the event, from the pairing list in the system.
  const autoCount = () => {
    try {
      const due = db.prepare('SELECT * FROM events WHERE done = 0 AND event_date < ? AND EXISTS (SELECT 1 FROM event_pairs p WHERE p.event_id = events.id)').all(today());
      for (const e of due) { const r = countEvent(e); console.log(`Event ${e.id} (${e.event_date}) counted automatically: ${r.songs} songs, ${r.singers} singers`); }
    } catch (err) { console.error('auto count failed', err); }
  };
  setTimeout(autoCount, 5000);
  setInterval(autoCount, 60 * 1000).unref();

  app.use(['/api/events', '/api/admin/events'], (e, req, res, next) => {
    if (e.status) return fail(res, e.status, e.message);
    next(e);
  });
};

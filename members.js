// Membership: singers, monthly song limits per plan, song log (kept 12 months) and the singer login.
const crypto = require('node:crypto');
const { db, getSettings, setSetting, hashPassword, verifyPassword } = require('./db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const GENDERS = ['Male', 'Female'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const thisMonth = () => today().slice(0, 7);
const clean = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));

function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(y, m - 1 + n, d);
  if (t.getDate() !== d) t.setDate(0); // 31 Jan + 1 month -> 28/29 Feb
  return ymd(t);
}
const addDays = (dateStr, n) => { const [y, m, d] = dateStr.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
// One month of membership: start date up to the day before the same date next month.
const periodEnd = (start) => addDays(addMonths(start, 1), -1);

// ---------- plans ----------
function getPlans() {
  try {
    const list = JSON.parse(getSettings().membership_plans || '[]');
    if (Array.isArray(list) && list.length) return list;
  } catch { /* fall through */ }
  return [];
}
const priceOf = (tier, gender) => Number(gender === 'Female' ? tier.price_female : tier.price_male) || 0;

// Smallest plan that covers `count` songs (plans are ordered from smallest to largest).
function planCovering(plans, count) {
  return plans.find((p) => p.limit == null || count <= p.limit) || plans[plans.length - 1];
}

// ---------- retention ----------
function purgeOldSongs() {
  db.prepare('DELETE FROM member_songs WHERE sung_on < ?').run(addMonths(today(), -12));
}
purgeOldSongs();
setInterval(purgeOldSongs, 6 * 60 * 60 * 1000).unref();

// ---------- summaries ----------
function monthCount(memberId, ym = thisMonth()) {
  return db.prepare("SELECT COUNT(*) n FROM member_songs WHERE member_id = ? AND substr(sung_on,1,7) = ?").get(memberId, ym).n;
}

function summary(m, plans = getPlans(), ym = thisMonth()) {
  const tier = plans.find((p) => p.key === m.plan) || plans[0];
  const count = monthCount(m.id, ym);
  const idx = plans.indexOf(tier);
  const covering = planCovering(plans, count);
  const over = tier.limit != null && count > tier.limit;
  const tierView = (t) => t && { key: t.key, name: t.name, limit: t.limit, price: priceOf(t, m.gender) };
  const req = m.upgrade_request && plans.find((p) => p.key === m.upgrade_request);
  const { pin_hash, ...pub } = m;
  return {
    ...pub,
    plan_name: tier.name,
    plan_limit: tier.limit,
    plan_price: priceOf(tier, m.gender),
    month: ym,
    month_count: count,
    remaining: tier.limit == null ? null : Math.max(0, tier.limit - count),
    over_limit: over,
    // Next plan that would cover this month's songs (only when the current one doesn't).
    suggested: over ? tierView(plans.indexOf(covering) > idx ? covering : plans[idx + 1]) : null,
    requested: tierView(req),
    active: m.valid_until >= today(),
  };
}

function history(memberId) {
  const songs = db.prepare('SELECT id, sung_on, title, album FROM member_songs WHERE member_id = ? ORDER BY sung_on DESC, id DESC').all(memberId);
  // Last 12 months, newest first, with song counts (months without songs show 0).
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    months.push({ month: ym, count: songs.filter((s) => s.sung_on.startsWith(ym)).length });
  }
  return { songs, months, total: songs.length };
}

function nextMemberNo() {
  const row = db.prepare("SELECT MAX(CAST(substr(member_no, 4) AS INTEGER)) n FROM members WHERE member_no LIKE 'RRS%'").get();
  const n = Math.max(1000, row.n || 0) + 1;
  if (n > 9999) throw Object.assign(new Error('Member numbers RRS1001–RRS9999 are all used.'), { status: 400 });
  return 'RRS' + n;
}

const getMember = (id) => db.prepare('SELECT * FROM members WHERE id = ?').get(id);

module.exports = function mountMembers(app, { sign, readCookie, notify, cookiePath }) {
  const fail = (res, status, error) => res.status(status).json({ error });

  // ----- singer session (signed cookie: id.expiry.signature) -----
  const COOKIE = 'rrs_member';
  function memberFromReq(req) {
    const token = readCookie(req, COOKIE);
    if (!token) return null;
    const [id, exp, sig] = token.split('.');
    if (!id || !exp || !sig || Number(exp) < Date.now()) return null;
    const expected = sign(`member:${id}.${exp}`);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return getMember(id) || null;
  }
  function requireMember(req, res, next) {
    const m = memberFromReq(req);
    if (!m) return fail(res, 401, 'Please log in with your member number.');
    req.member = m;
    next();
  }

  // ----- public -----
  app.get('/api/membership/plans', (req, res) => res.json({ plans: getPlans(), currency: getSettings().currency || '₹' }));

  app.post('/api/member/login', (req, res) => {
    const no = clean(req.body.member_no, 12).toUpperCase().replace(/\s+/g, '');
    const m = db.prepare('SELECT * FROM members WHERE member_no = ?').get(no);
    if (!m || !verifyPassword(String(req.body.pin || ''), m.pin_hash)) return fail(res, 401, 'Member number or PIN is incorrect.');
    const exp = Date.now() + 1000 * 60 * 60 * 24 * 7;
    res.setHeader('Set-Cookie', `${COOKIE}=${m.id}.${exp}.${sign(`member:${m.id}.${exp}`)}; HttpOnly; SameSite=Lax; Path=${cookiePath}; Max-Age=${60 * 60 * 24 * 7}`);
    res.json({ ok: true });
  });
  app.post('/api/member/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=${cookiePath}; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get('/api/member/me', requireMember, (req, res) => {
    res.json({ member: summary(req.member), ...history(req.member.id), plans: getPlans() });
  });

  // Singers update their own contact / demographic details. Gender and plan are set by the studio (they decide the price).
  app.put('/api/member/me', requireMember, (req, res) => {
    const b = req.body, m = req.member;
    const name = clean(b.name, 80), phone = clean(b.phone, 20);
    if (!name || !phone) return fail(res, 400, 'Name and contact number are required.');
    if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) return fail(res, 400, 'Please enter a valid email.');
    if (b.dob && !DATE_RE.test(b.dob)) return fail(res, 400, 'Please enter a valid date of birth.');
    let pinHash = m.pin_hash;
    if (b.new_pin) {
      if (!/^\d{4,6}$/.test(b.new_pin)) return fail(res, 400, 'PIN must be 4 to 6 digits.');
      pinHash = hashPassword(b.new_pin);
    }
    db.prepare('UPDATE members SET name=?, phone=?, email=?, dob=?, address=?, pin_hash=? WHERE id=?')
      .run(name, phone, clean(b.email, 120) || null, b.dob || null, clean(b.address, 300) || null, pinHash, m.id);
    res.json({ ok: true });
  });

  app.post('/api/member/upgrade-request', requireMember, (req, res) => {
    const m = req.member, plans = getPlans();
    const target = plans.find((p) => p.key === req.body.plan);
    if (!target || plans.indexOf(target) <= plans.findIndex((p) => p.key === m.plan)) return fail(res, 400, 'Please pick a higher plan.');
    db.prepare('UPDATE members SET upgrade_request = ? WHERE id = ?').run(target.key, m.id);
    notify('membership', `${m.member_no} ${m.name} asked to upgrade to ${target.name} (${monthCount(m.id)} songs this month)`);
    res.json({ ok: true });
  });

  // ----- admin (the /api/admin prefix is already behind the admin login) -----
  app.get('/api/admin/members', (req, res) => {
    const ym = MONTH_RE.test(req.query.month || '') ? req.query.month : thisMonth();
    const plans = getPlans();
    const list = db.prepare('SELECT * FROM members ORDER BY member_no').all().map((m) => summary(m, plans, ym));
    res.json({ members: list, plans, month: ym });
  });

  app.get('/api/admin/members/:id', (req, res) => {
    const m = getMember(req.params.id);
    if (!m) return fail(res, 404, 'Member not found.');
    res.json({ member: summary(m), ...history(m.id) });
  });

  function memberFields(b, plans) {
    const name = clean(b.name, 80), phone = clean(b.phone, 20);
    if (!name || !phone) throw Object.assign(new Error('Name and contact number are required.'), { status: 400 });
    if (!GENDERS.includes(b.gender)) throw Object.assign(new Error('Please choose Male or Female.'), { status: 400 });
    if (!plans.some((p) => p.key === b.plan)) throw Object.assign(new Error('Please choose a membership plan.'), { status: 400 });
    if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) throw Object.assign(new Error('Please enter a valid email.'), { status: 400 });
    return { name, phone, gender: b.gender, plan: b.plan, email: clean(b.email, 120) || null,
      dob: DATE_RE.test(b.dob || '') ? b.dob : null, address: clean(b.address, 300) || null };
  }

  app.post('/api/admin/members', (req, res) => {
    const f = memberFields(req.body, getPlans());
    const start = DATE_RE.test(req.body.start_date || '') ? req.body.start_date : today();
    // Default PIN = last 4 digits of the phone number (the studio tells the singer; they can change it after login).
    const pin = /^\d{4,6}$/.test(req.body.pin || '') ? req.body.pin : f.phone.replace(/\D/g, '').slice(-4).padStart(4, '0');
    const no = nextMemberNo();
    const id = db.prepare(`INSERT INTO members (member_no, name, gender, phone, email, dob, address, plan, start_date, valid_until, pin_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(no, f.name, f.gender, f.phone, f.email, f.dob, f.address, f.plan, start, periodEnd(start), hashPassword(pin)).lastInsertRowid;
    res.json({ ok: true, id, member_no: no, pin });
  });

  app.put('/api/admin/members/:id', (req, res) => {
    const m = getMember(req.params.id);
    if (!m) return fail(res, 404, 'Member not found.');
    const f = memberFields({ ...m, ...req.body }, getPlans());
    const validUntil = DATE_RE.test(req.body.valid_until || '') ? req.body.valid_until : m.valid_until;
    const pinHash = /^\d{4,6}$/.test(req.body.pin || '') ? hashPassword(req.body.pin) : m.pin_hash;
    // Moving to the plan the singer asked for (or any other plan) settles their request.
    const request = f.plan !== m.plan ? null : m.upgrade_request;
    db.prepare('UPDATE members SET name=?, gender=?, phone=?, email=?, dob=?, address=?, plan=?, valid_until=?, pin_hash=?, upgrade_request=? WHERE id=?')
      .run(f.name, f.gender, f.phone, f.email, f.dob, f.address, f.plan, validUntil, pinHash, request, m.id);
    res.json({ ok: true });
  });

  // Renew for one more month, from the current expiry (or from today if it has already lapsed).
  app.post('/api/admin/members/:id/renew', (req, res) => {
    const m = getMember(req.params.id);
    if (!m) return fail(res, 404, 'Member not found.');
    const from = m.valid_until >= today() ? addDays(m.valid_until, 1) : today();
    const until = periodEnd(from);
    db.prepare('UPDATE members SET valid_until = ? WHERE id = ?').run(until, m.id);
    res.json({ ok: true, valid_until: until });
  });

  app.delete('/api/admin/members/:id', (req, res) => {
    db.prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Log one or more songs for a member. Responds with the updated summary so the UI can prompt an upgrade.
  app.post('/api/admin/members/:id/songs', (req, res) => {
    const m = getMember(req.params.id);
    if (!m) return fail(res, 404, 'Member not found.');
    const date = DATE_RE.test(req.body.sung_on || '') ? req.body.sung_on : today();
    if (date > today()) return fail(res, 400, 'Songs can’t be logged for a future date.');
    if (date < addMonths(today(), -12)) return fail(res, 400, 'Records are kept for 12 months only.');
    const songs = (Array.isArray(req.body.songs) ? req.body.songs : [])
      .map((s) => ({ title: clean(s.title, 120), album: clean(s.album, 120) || null })).filter((s) => s.title).slice(0, 50);
    if (!songs.length) return fail(res, 400, 'Add at least one song.');
    const ins = db.prepare('INSERT INTO member_songs (member_id, sung_on, title, album) VALUES (?,?,?,?)');
    for (const s of songs) ins.run(m.id, date, s.title, s.album);
    res.json({ ok: true, added: songs.length, member: summary(getMember(m.id), getPlans(), date.slice(0, 7)) });
  });

  app.delete('/api/admin/members/:id/songs/:songId', (req, res) => {
    db.prepare('DELETE FROM member_songs WHERE id = ? AND member_id = ?').run(req.params.songId, req.params.id);
    res.json({ ok: true });
  });

  app.put('/api/admin/membership-plans', (req, res) => {
    const old = getPlans();
    const list = Array.isArray(req.body.plans) ? req.body.plans : [];
    if (list.length !== old.length) return fail(res, 400, 'All plans must be included.');
    let prev = 0;
    const next = old.map((o, i) => {
      const p = list[i] || {};
      const limit = p.limit === null || p.limit === '' ? null : Math.round(Number(p.limit));
      if (limit !== null && !(limit > prev)) throw Object.assign(new Error('Song limits must go up from one plan to the next.'), { status: 400 });
      if (limit === null && i !== old.length - 1) throw Object.assign(new Error('Only the last plan can be unlimited.'), { status: 400 });
      if (limit !== null) prev = limit;
      return { key: o.key, name: clean(p.name, 30) || o.name, limit,
        price_male: Math.max(0, Number(p.price_male) || 0), price_female: Math.max(0, Number(p.price_female) || 0) };
    });
    setSetting('membership_plans', JSON.stringify(next));
    res.json({ ok: true, plans: next });
  });

  // Errors thrown with a status (validation) become JSON 4xx responses.
  app.use(['/api/admin/members', '/api/admin/membership-plans', '/api/member'], (err, req, res, next) => {
    if (err.status) return fail(res, err.status, err.message);
    next(err);
  });
};

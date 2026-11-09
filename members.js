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
// Male and female singers have separate tariffs; each gender's plans are ordered from smallest to largest.
const plansFor = (gender, plans = getPlans()) => plans.filter((p) => p.gender === gender);
const priceOf = (tier) => Number(tier && tier.price) || 0;

// Smallest plan that covers `count` songs (pass one gender's plans).
function planCovering(plans, count) {
  return plans.find((p) => p.limit == null || count <= p.limit) || plans[plans.length - 1];
}

// ---------- retention ----------
function purgeOldSongs() {
  db.prepare('DELETE FROM member_songs WHERE sung_on < ?').run(addMonths(today(), -12));
}
purgeOldSongs();
setInterval(purgeOldSongs, 6 * 60 * 60 * 1000).unref();

// ---------- monthly fee ----------
// The fee for each calendar month must be paid before the "due day" (default the 10th); from that day it is overdue. A month is paid when its payment
// covers the current plan price; after an upgrade the difference shows as a balance.
function dueDay() {
  const n = Number(getSettings().membership_due_day);
  return n >= 2 && n <= 28 ? n : 10;
}
const monthEndOf = (ym) => addDays(addMonths(ym + '-01', 1), -1);
const prevMonth = (ym) => addMonths(ym + '-01', -1).slice(0, 7);

function fees(m, tier) {
  const rows = db.prepare('SELECT month, amount, paid_on FROM member_payments WHERE member_id = ?').all(m.id);
  const paid = Object.fromEntries(rows.map((r) => [r.month, r]));
  const day = pad(dueDay()), now = thisMonth(), t = today();
  const first = [m.start_date.slice(0, 7), addMonths(t, -11).slice(0, 7)].sort()[1]; // joining month, at most 12 months back
  const list = [];
  for (let ym = now; ym >= first; ym = prevMonth(ym)) {
    const row = paid[ym];
    // This month is charged at the current plan; past months at what was paid (or the current price if unpaid).
    const amount = ym === now || !row ? priceOf(tier) : row.amount;
    const balance = Math.max(0, amount - (row ? row.amount : 0));
    const due_date = `${ym}-${day}`;
    const late = ym < now || t >= due_date; // due_date itself is already late ("pay before the 10th")
    list.push({ month: ym, amount, paid: row ? row.amount : 0, balance, paid_on: row ? row.paid_on : null, due_date,
      status: balance === 0 ? 'paid' : late ? 'overdue' : 'due', part_paid: !!row && balance > 0 });
  }
  return list;
}

// Valid through the end of the latest paid month (the joining month if nothing has been paid yet).
function refreshValidity(m) {
  const last = db.prepare('SELECT MAX(month) m FROM member_payments WHERE member_id = ?').get(m.id).m;
  db.prepare('UPDATE members SET valid_until = ? WHERE id = ?').run(monthEndOf(last || m.start_date.slice(0, 7)), m.id);
}

// ---------- summaries ----------
function monthCount(memberId, ym = thisMonth()) {
  return db.prepare("SELECT COUNT(*) n FROM member_songs WHERE member_id = ? AND substr(sung_on,1,7) = ?").get(memberId, ym).n;
}

function summary(m, allPlans = getPlans(), ym = thisMonth()) {
  const plans = plansFor(m.gender, allPlans);
  const tier = plans.find((p) => p.key === m.plan) || plans[0];
  const count = monthCount(m.id, ym);
  const idx = plans.indexOf(tier);
  const covering = planCovering(plans, count);
  const over = tier.limit != null && count > tier.limit;
  const tierView = (t) => t && { key: t.key, name: t.name, limit: t.limit, price: priceOf(t) };
  const req = m.upgrade_request && plans.find((p) => p.key === m.upgrade_request);
  const { pin_hash, ...pub } = m;
  const feeList = fees(m, tier);
  const unpaid = feeList.filter((f) => f.status !== 'paid');
  const claims = db.prepare('SELECT month, amount, ref, created_at FROM payment_claims WHERE member_id = ? ORDER BY month DESC').all(m.id)
    .filter((c) => feeList.some((f) => f.month === c.month && f.status !== 'paid'));
  return {
    ...pub,
    plan_name: tier.name,
    plan_limit: tier.limit,
    plan_price: priceOf(tier),
    month: ym,
    month_count: count,
    remaining: tier.limit == null ? null : Math.max(0, tier.limit - count),
    over_limit: over,
    // Next plan that would cover this month's songs (only when the current one doesn't).
    suggested: over ? tierView(plans.indexOf(covering) > idx ? covering : plans[idx + 1]) : null,
    requested: tierView(req),
    // Still active in the grace period: paid through last month and this month's fee isn't due yet.
    active: m.valid_until >= today() || (feeList[0].status === 'due' && m.valid_until >= monthEndOf(prevMonth(thisMonth()))),
    fee: feeList[0],                 // this month
    fees: feeList,                   // this month back to joining (max 12 months), newest first
    fee_due: unpaid.reduce((a, f) => a + f.balance, 0),
    fee_overdue: unpaid.filter((f) => f.status === 'overdue').map((f) => f.month),
    due_day: dueDay(),
    approved: m.approved !== 0,
    claims,                          // "I've paid" messages waiting for the admin to confirm
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
// Phone numbers are matched on their last 10 digits ("+91 98400 11223" = "9840011223").
const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-10);
function memberByPhone(phone) {
  const k = phoneKey(phone);
  if (k.length < 10) return null;
  return db.prepare('SELECT * FROM members').all().find((m) => phoneKey(m.phone) === k) || null;
}

// Plan goes up automatically when this month's songs pass the limit (the price difference shows as a fee balance).
function autoUpgrade(memberId, notify) {
  const m = getMember(memberId);
  if (!m) return null;
  const plans = plansFor(m.gender);
  const tier = plans.find((p) => p.key === m.plan) || plans[0];
  const count = monthCount(m.id);
  if (!tier || tier.limit == null || count <= tier.limit) return null;
  const target = planCovering(plans, count);
  if (!target || plans.indexOf(target) <= plans.indexOf(tier)) return null;
  db.prepare('UPDATE members SET plan = ?, upgrade_request = NULL WHERE id = ?').run(target.key, m.id);
  if (notify) notify('membership', `${m.member_no} ${m.name} moved up to ${target.name} automatically (${count} songs this month)`);
  return target;
}

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
  function setMemberCookie(res, id) {
    const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
    res.setHeader('Set-Cookie', `${COOKIE}=${id}.${exp}.${sign(`member:${id}.${exp}`)}; HttpOnly; SameSite=Lax; Path=${cookiePath}; Max-Age=${60 * 60 * 24 * 30}`);
  }
  function requireMember(req, res, next) {
    const m = memberFromReq(req);
    if (!m) return fail(res, 401, 'Please log in with your member number.');
    req.member = m;
    next();
  }

  // ----- public -----
  app.get('/api/membership/plans', (req, res) => res.json({ plans: getPlans(), currency: getSettings().currency || '₹', due_day: dueDay() }));

  app.post('/api/member/login', (req, res) => {
    // Log in with the member number (RRS1001) or the phone number.
    const id = clean(req.body.member_no, 20);
    const no = id.toUpperCase().replace(/\s+/g, '');
    const m = db.prepare('SELECT * FROM members WHERE member_no = ?').get(no) || (/^RRS/.test(no) ? null : memberByPhone(id));
    if (!m || !verifyPassword(String(req.body.pin || ''), m.pin_hash)) return fail(res, 401, 'Member number / phone or PIN is incorrect.');
    setMemberCookie(res, m.id);
    res.json({ ok: true });
  });
  app.post('/api/member/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=${cookiePath}; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get('/api/member/me', requireMember, (req, res) => {
    res.json({ member: summary(req.member), ...history(req.member.id), plans: plansFor(req.member.gender) });
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
    const m = req.member, plans = plansFor(m.gender);
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
    res.json({ members: list, plans, month: ym, due_day: dueDay() });
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
    if (!plansFor(b.gender, plans).some((p) => p.key === b.plan)) throw Object.assign(new Error(`Please choose a ${b.gender.toLowerCase()} membership plan.`), { status: 400 });
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
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(no, f.name, f.gender, f.phone, f.email, f.dob, f.address, f.plan, start, monthEndOf(start.slice(0, 7)), hashPassword(pin)).lastInsertRowid;
    // Joining-month fee collected at sign-up.
    if (req.body.paid) {
      const tier = getPlans().find((p) => p.key === f.plan);
      db.prepare('INSERT INTO member_payments (member_id, month, plan, amount, paid_on) VALUES (?,?,?,?,?)').run(id, start.slice(0, 7), f.plan, priceOf(tier), today());
    }
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

  // Record a month's fee as paid (at the member's current plan price). Paying a month extends validity to its end.
  app.post('/api/admin/members/:id/payments', (req, res) => {
    const m = getMember(req.params.id);
    if (!m) return fail(res, 404, 'Member not found.');
    const ym = MONTH_RE.test(req.body.month || '') ? req.body.month : thisMonth();
    if (ym > thisMonth() || ym < m.start_date.slice(0, 7)) return fail(res, 400, 'That month is outside this membership.');
    const tier = getPlans().find((p) => p.key === m.plan) || plansFor(m.gender)[0];
    db.prepare(`INSERT INTO member_payments (member_id, month, plan, amount, paid_on) VALUES (?,?,?,?,?)
      ON CONFLICT(member_id, month) DO UPDATE SET plan = excluded.plan, amount = excluded.amount, paid_on = excluded.paid_on`)
      .run(m.id, ym, m.plan, priceOf(tier), today());
    db.prepare('DELETE FROM payment_claims WHERE member_id = ? AND month = ?').run(m.id, ym);
    refreshValidity(m);
    res.json({ ok: true, member: summary(getMember(m.id)) });
  });
  app.delete('/api/admin/members/:id/payments/:month', (req, res) => {
    const m = getMember(req.params.id);
    if (!m) return fail(res, 404, 'Member not found.');
    db.prepare('DELETE FROM member_payments WHERE member_id = ? AND month = ?').run(m.id, req.params.month);
    refreshValidity(m);
    res.json({ ok: true });
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
    const upgraded = date.slice(0, 7) === thisMonth() ? autoUpgrade(m.id, notify) : null;
    res.json({ ok: true, added: songs.length, upgraded: upgraded && upgraded.name, member: summary(getMember(m.id), getPlans(), date.slice(0, 7)) });
  });

  app.delete('/api/admin/members/:id/songs/:songId', (req, res) => {
    db.prepare('DELETE FROM member_songs WHERE id = ? AND member_id = ?').run(req.params.songId, req.params.id);
    res.json({ ok: true });
  });

  // ----- singer: "I've paid" with the UPI transaction reference -----
  app.post('/api/member/payment-claim', requireMember, (req, res) => {
    const m = req.member, s = summary(m);
    const ym = MONTH_RE.test(req.body.month || '') ? req.body.month : s.fee.month;
    const fee = s.fees.find((f) => f.month === ym);
    if (!fee || fee.status === 'paid') return fail(res, 400, 'This month is already paid.');
    const ref = clean(req.body.ref, 40);
    if (!/^[A-Za-z0-9]{6,40}$/.test(ref)) return fail(res, 400, 'Please enter the UPI transaction ID (UTR) shown in your payment app.');
    db.prepare(`INSERT INTO payment_claims (member_id, month, amount, ref) VALUES (?,?,?,?)
      ON CONFLICT(member_id, month) DO UPDATE SET amount = excluded.amount, ref = excluded.ref, created_at = datetime('now')`).run(m.id, ym, fee.balance, ref);
    notify('membership', `${m.member_no} ${m.name} paid ${fee.balance} for ${ym} by UPI (ref ${ref}) - please confirm`);
    res.json({ ok: true });
  });
  app.delete('/api/admin/members/:id/claims/:month', (req, res) => {
    db.prepare('DELETE FROM payment_claims WHERE member_id = ? AND month = ?').run(req.params.id, req.params.month);
    res.json({ ok: true });
  });
  app.post('/api/admin/members/:id/approve', (req, res) => {
    db.prepare('UPDATE members SET approved = 1 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ----- Excel import of singers: rows of { name, phone, gender, plan, email, member_no } -----
  // Matches existing singers by member number, then phone; others are created (PIN = last 4 digits of phone).
  app.post('/api/admin/members/import', (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 2000) : [];
    const dry = !!req.body.dry_run, all = getPlans();
    const out = { created: 0, updated: 0, errors: [] };
    const planFor = (gender, name) => {
      const list = plansFor(gender, all);
      if (!name) return list[0];
      const n = String(name).trim().toLowerCase();
      return list.find((p) => p.name.toLowerCase() === n || p.key === n) || null;
    };
    db.exec('BEGIN');
    try {
      const seen = new Set();
      rows.forEach((r, i) => {
        const line = i + 2; // header is row 1 in the sheet
        const name = clean(r.name, 80), phone = clean(r.phone, 20);
        const gender = /^f/i.test(r.gender || '') ? 'Female' : /^m/i.test(r.gender || '') ? 'Male' : null;
        if (!name || phoneKey(phone).length < 10) return out.errors.push(`Row ${line}: name and a 10-digit phone number are needed.`);
        if (!gender) return out.errors.push(`Row ${line} (${name}): gender must be Male or Female.`);
        if (seen.has(phoneKey(phone))) return out.errors.push(`Row ${line} (${name}): phone number repeated in the sheet.`);
        seen.add(phoneKey(phone));
        const tier = planFor(gender, r.plan);
        if (!tier) return out.errors.push(`Row ${line} (${name}): unknown ${gender.toLowerCase()} plan "${r.plan}".`);
        const no = clean(r.member_no, 12).toUpperCase();
        const existing = (no && db.prepare('SELECT * FROM members WHERE member_no = ?').get(no)) || memberByPhone(phone);
        const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email || '') ? clean(r.email, 120) : null;
        if (existing) {
          const plan = existing.gender === gender && !r.plan ? existing.plan : tier.key;
          db.prepare('UPDATE members SET name=?, phone=?, gender=?, plan=?, email=COALESCE(?, email), approved=1 WHERE id=?')
            .run(name, phone, gender, plan, email, existing.id);
          out.updated++;
        } else {
          const start = today();
          db.prepare(`INSERT INTO members (member_no, name, gender, phone, email, plan, start_date, valid_until, pin_hash)
            VALUES (?,?,?,?,?,?,?,?,?)`).run(nextMemberNo(), name, gender, phone, email, tier.key, start, monthEndOf(start.slice(0, 7)), hashPassword(phoneKey(phone).slice(-4)));
          out.created++;
        }
      });
      db.exec(dry ? 'ROLLBACK' : 'COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true, dry_run: dry, ...out });
  });

  // ----- monthly report per singer (songs per week, song list, plan) and fee reminders -----
  app.get('/api/admin/reports', (req, res) => {
    const ym = MONTH_RE.test(req.query.month || '') ? req.query.month : thisMonth();
    const all = getPlans(), st = getSettings();
    const list = db.prepare('SELECT * FROM members WHERE approved = 1 ORDER BY name').all().map((m) => {
      const songs = db.prepare('SELECT sung_on, title, album FROM member_songs WHERE member_id = ? AND substr(sung_on,1,7) = ? ORDER BY sung_on, id').all(m.id, ym);
      const weeks = [0, 0, 0, 0, 0];
      for (const x of songs) weeks[Math.min(4, Math.floor((Number(x.sung_on.slice(8)) - 1) / 7))]++;
      const s = summary(m, all, ym);
      return { id: m.id, member_no: m.member_no, name: m.name, phone: m.phone, gender: m.gender, plan_name: s.plan_name,
        plan_limit: s.plan_limit, plan_price: s.plan_price, count: songs.length, weeks, songs, fee: s.fee, fee_due: s.fee_due };
    });
    res.json({ month: ym, members: list, due_day: dueDay(), currency: st.currency || '₹', upi_id: st.upi_id || '' });
  });

  app.put('/api/admin/membership-plans', (req, res) => {
    const old = getPlans();
    const list = Array.isArray(req.body.plans) ? req.body.plans : [];
    const byKey = Object.fromEntries(list.map((p) => [p && p.key, p]));
    if (!old.every((o) => byKey[o.key])) return fail(res, 400, 'All plans must be included.');
    const next = [];
    for (const g of GENDERS) {
      const group = plansFor(g, old);
      let prev = 0;
      group.forEach((o, i) => {
        const p = byKey[o.key];
        const limit = p.limit === null || p.limit === '' ? null : Math.round(Number(p.limit));
        if (limit !== null && !(limit > prev)) throw Object.assign(new Error(`${g} plans: song limits must go up from one plan to the next.`), { status: 400 });
        if (limit === null && i !== group.length - 1) throw Object.assign(new Error(`${g} plans: only the last plan can be unlimited.`), { status: 400 });
        if (limit !== null) prev = limit;
        next.push({ key: o.key, gender: g, name: clean(p.name, 30) || o.name, limit, price: Math.max(0, Number(p.price) || 0) });
      });
    }
    setSetting('membership_plans', JSON.stringify(next));
    if (req.body.due_day !== undefined) {
      const d = Math.round(Number(req.body.due_day));
      if (!(d >= 2 && d <= 28)) return fail(res, 400, 'Fee due day must be between 2 and 28.');
      setSetting('membership_due_day', String(d));
    }
    res.json({ ok: true, plans: next });
  });

  // Fee notices in the admin bell: a reminder a few days before the due day, and the overdue list on the day.
  function feeNotices() {
    const day = Number(today().slice(8)), due = dueDay(), ym = thisMonth(), s = getSettings();
    const all = getPlans();
    const pending = db.prepare('SELECT * FROM members WHERE approved = 1').all().map((m) => summary(m, all)).filter((m) => m.fee.status !== 'paid');
    if (!pending.length) return;
    if (day >= due - 3 && day < due && s.fee_notice_due !== ym) {
      setSetting('fee_notice_due', ym);
      notify('membership', `${pending.length} singer(s) haven't paid the ${ym} fee yet - due before the ${due}th. Send reminders from Members > Reminders.`);
    }
    if (day >= due && s.fee_notice_overdue !== ym) {
      setSetting('fee_notice_overdue', ym);
      notify('membership', `${pending.length} singer(s) are overdue for ${ym}: ${pending.slice(0, 6).map((m) => m.name).join(', ')}${pending.length > 6 ? '...' : ''}`);
    }
  }
  feeNotices();
  setInterval(feeNotices, 60 * 60 * 1000).unref();

  // Errors thrown with a status (validation) become JSON 4xx responses.
  app.use(['/api/admin/members', '/api/admin/membership-plans', '/api/member'], (err, req, res, next) => {
    if (err.status) return fail(res, err.status, err.message);
    next(err);
  });

  return { memberFromReq, requireMember, setMemberCookie, autoUpgrade: (id) => autoUpgrade(id, notify), plansFor, memberByPhone, phoneKey, nextMemberNo, monthEndOf, getMember };
};

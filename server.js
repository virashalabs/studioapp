try { process.loadEnvFile(); } catch { /* .env is optional */ }

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { db, getSettings, setSetting, hashPassword, verifyPassword } = require('./db');
const { sendMail, bookingTable, esc } = require('./mailer');
const mountMembers = require('./members');
const persist = require('./persist');

const app = express();
const PORT = Number(process.env.PORT || 3000);
// Sub-path the site is served under, e.g. "/studioapp" (empty = site root).
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '').replace(/^(?=[^/])/, '/');
const COOKIE_PATH = BASE_PATH + '/';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbs');
fs.mkdirSync(THUMB_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));
// Pages link their CSS/JS with "?v=<build>" so browsers fetch fresh copies after every deploy
// instead of using a cached old version for up to 10 minutes.
const BUILD = (process.env.RENDER_GIT_COMMIT || Date.now().toString(36)).slice(0, 8);
const PUBLIC_DIR = path.join(__dirname, 'public');
const pageCache = new Map();
app.get(/(^\/$|\.html$)/, (req, res, next) => {
  const rel = req.path.endsWith('/') ? req.path + 'index.html' : req.path;
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return next();
  let html = pageCache.get(file);
  if (html === undefined) {
    if (!fs.existsSync(file)) return next();
    html = fs.readFileSync(file, 'utf8').replace(/((?:href|src)="(?:css|js)\/[\w.-]+\.(?:css|js))"/g, `$1?v=${BUILD}"`);
    pageCache.set(file, html);
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(html);
});
// Images uploaded before thumbnails existed have no small copy: serve the full image instead.
app.get('/uploads/thumbs/:file', (req, res, next) => {
  const file = path.basename(req.params.file);
  if (fs.existsSync(path.join(THUMB_DIR, file))) return next();
  if (!fs.existsSync(path.join(UPLOAD_DIR, file))) return next();
  res.sendFile(path.join(UPLOAD_DIR, file), { headers: { 'Cache-Control': 'public, max-age=3600' } });
});
// Cache headers let Cloudflare serve static files from its edge instead of tunnelling every request to this PC.
// Uploads get unique file names, so they can be cached for a long time; CSS/JS briefly so edits still show up soon.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    const rel = path.relative(path.join(__dirname, 'public'), file).replaceAll('\\', '/');
    if (/^(uploads|img)\//.test(rel)) res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    else if (/\.(css|js)$/.test(rel)) res.setHeader('Cache-Control', 'public, max-age=600');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ---------- helpers ----------
const SLOTS = ['first', 'second', 'full'];
const STATUSES = ['pending', 'approved', 'cancelled'];
const ACTIVE = "status IN ('pending','approved')";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function slotLabel(slot, s = getSettings()) {
  if (slot === 'first') return `${s.first_half_label} (${s.first_half_time})`;
  if (slot === 'second') return `${s.second_half_label} (${s.second_half_time})`;
  return `Full Day (${s.full_day_time})`;
}

function priceFor(slot, s = getSettings()) {
  return Number(slot === 'full' ? s.price_full : s.price_half) || 0;
}

// Returns which halves are taken on a date by active (pending/approved) bookings.
function takenOn(date, excludeId = null) {
  const rows = db.prepare(`SELECT id, slot FROM bookings WHERE date = ? AND ${ACTIVE}`).all(date);
  const taken = { first: false, second: false };
  for (const r of rows) {
    if (r.id === excludeId) continue;
    if (r.slot === 'full' || r.slot === 'first') taken.first = true;
    if (r.slot === 'full' || r.slot === 'second') taken.second = true;
  }
  return taken;
}

function slotFree(date, slot, excludeId = null) {
  const t = takenOn(date, excludeId);
  if (slot === 'first') return !t.first;
  if (slot === 'second') return !t.second;
  return !t.first && !t.second;
}

function makeRef() {
  return 'SB' + Date.now().toString(36).toUpperCase().slice(-5) + crypto.randomBytes(2).toString('hex').toUpperCase();
}

function notify(type, message, bookingId = null) {
  db.prepare('INSERT INTO notifications (type, message, booking_id) VALUES (?,?,?)').run(type, message, bookingId);
}

function clean(v, max = 500) {
  return v == null ? '' : String(v).trim().slice(0, max);
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- auth (signed cookie) ----------
function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function isAdmin(req) {
  const token = readCookie(req, 'sb_admin');
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Please log in as admin.' });
  next();
}

// ---------- public API ----------
const PUBLIC_SETTINGS = [
  'studio_name', 'tagline', 'phone', 'whatsapp', 'email', 'address', 'map_link', 'currency',
  'price_half', 'price_full', 'first_half_label', 'first_half_time', 'second_half_label',
  'second_half_time', 'full_day_time', 'booking_window_days', 'about_title', 'about_text',
  'attractions', 'instagram', 'youtube', 'gallery_categories',
];

app.get('/api/settings', (req, res) => {
  const s = getSettings();
  res.json(Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, s[k]])));
});

app.get('/api/banners', (req, res) => {
  res.json(db.prepare('SELECT * FROM banners WHERE active = 1 ORDER BY sort, id').all());
});

app.get('/api/gallery', (req, res) => {
  res.json(db.prepare('SELECT * FROM gallery ORDER BY sort, id').all());
});

app.get('/api/testimonials', (req, res) => {
  res.json(db.prepare('SELECT id, name, band, message, rating, created_at FROM testimonials WHERE approved = 1 ORDER BY id DESC').all());
});

app.post('/api/testimonials', (req, res) => {
  const name = clean(req.body.name, 80);
  const message = clean(req.body.message, 600);
  const rating = Math.min(5, Math.max(1, Number(req.body.rating) || 5));
  if (!name || message.length < 10) return res.status(400).json({ error: 'Please share your name and a few words about your experience.' });
  const r = db.prepare('INSERT INTO testimonials (name, band, message, rating, approved) VALUES (?,?,?,?,0)')
    .run(name, clean(req.body.band, 80), message, rating);
  notify('testimonial', `New review from ${name} awaiting approval`);
  res.json({ ok: true, id: r.lastInsertRowid });
});

// Availability for a month: { "YYYY-MM-DD": { first: bool, second: bool } } (true = booked)
app.get('/api/availability', (req, res) => {
  const month = String(req.query.month || '');
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const rows = db.prepare(`SELECT date, slot FROM bookings WHERE date LIKE ? AND ${ACTIVE}`).all(month + '-%');
  const days = {};
  for (const r of rows) {
    const d = (days[r.date] ||= { first: false, second: false });
    if (r.slot !== 'second') d.first = true;
    if (r.slot !== 'first') d.second = true;
  }
  res.json({ month, today: todayStr(), days });
});

app.post('/api/bookings', wrap(async (req, res) => {
  const s = getSettings();
  const b = {
    date: clean(req.body.date, 10),
    slot: clean(req.body.slot, 10),
    name: clean(req.body.name, 100),
    group_type: clean(req.body.group_type, 20) || 'Band',
    phone: clean(req.body.phone, 20),
    email: clean(req.body.email, 120).toLowerCase(),
    event_type: clean(req.body.event_type, 60),
    attendees: Number(req.body.attendees) || null,
    notes: clean(req.body.notes, 500),
  };

  const errors = [];
  if (!DATE_RE.test(b.date) || isNaN(Date.parse(b.date))) errors.push('Choose a valid date.');
  if (!SLOTS.includes(b.slot)) errors.push('Choose a slot.');
  if (b.name.length < 2) errors.push('Enter the name of your band / group.');
  if (!['Band', 'Individual', 'Group'].includes(b.group_type)) errors.push('Choose Band, Individual or Group.');
  if (b.phone.replace(/\D/g, '').length < 10) errors.push('Enter a valid contact number.');
  if (!EMAIL_RE.test(b.email)) errors.push('Enter a valid email address.');
  if (b.date < todayStr()) errors.push('That date is in the past.');
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + Number(s.booking_window_days || 120));
  if (new Date(b.date) > maxDate) errors.push(`Bookings open only ${s.booking_window_days} days in advance.`);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  b.amount = priceFor(b.slot, s);
  b.ref = makeRef();

  // Check + insert atomically so two people can't grab the same slot.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!slotFree(b.date, b.slot)) {
      db.exec('ROLLBACK');
      return res.status(409).json({ error: 'Sorry, that slot was just booked. Please pick another slot or date.' });
    }
    const r = db.prepare(`INSERT INTO bookings (ref, date, slot, name, group_type, phone, email, event_type, attendees, notes, amount)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(b.ref, b.date, b.slot, b.name, b.group_type, b.phone, b.email, b.event_type, b.attendees, b.notes, b.amount);
    b.id = Number(r.lastInsertRowid);
    notify('booking', `New booking ${b.ref}: ${b.name} – ${b.date}, ${slotLabel(b.slot, s)}`, b.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  b.status = 'pending';

  const table = bookingTable(b, slotLabel(b.slot, s), s.currency);
  sendMail({
    to: s.owner_email || s.email,
    subject: `🎸 New booking request ${b.ref} – ${b.date}`,
    html: `<h2>New booking request</h2>${table}<p>Approve or cancel it from the admin dashboard.</p>`,
  });
  sendMail({
    to: b.email,
    subject: `${s.studio_name}: booking request received (${b.ref})`,
    html: `<p>Hi ${esc(b.name)},</p><p>Thanks for choosing ${esc(s.studio_name)}! Your slot is on hold and we will confirm shortly.</p>${table}<p>Questions? Call us on ${esc(s.phone)}.</p>`,
  });

  res.json({ ok: true, booking: { ref: b.ref, date: b.date, slot: b.slot, slot_label: slotLabel(b.slot, s), amount: b.amount, status: b.status, name: b.name, email: b.email } });
}));

app.get('/api/bookings/lookup', (req, res) => {
  const ref = clean(req.query.ref, 20).toUpperCase();
  const email = clean(req.query.email, 120).toLowerCase();
  const b = db.prepare('SELECT ref, date, slot, name, amount, status, payment_status FROM bookings WHERE ref = ? AND email = ?').get(ref, email);
  if (!b) return res.status(404).json({ error: 'No booking found with that Booking ID and email.' });
  res.json({ ...b, slot_label: slotLabel(b.slot) });
});

// ---------- admin API ----------
// Failed admin logins per IP: after 10 wrong tries, wait 15 minutes.
const loginFails = new Map();
app.post('/api/admin/login', (req, res) => {
  const s = getSettings();
  const demo = s.admin_demo_mode === '1';
  const ip = req.ip || 'unknown', now = Date.now();
  const f = loginFails.get(ip);
  if (f && f.until > now) return res.status(429).json({ error: 'Too many wrong attempts. Please try again in 15 minutes.' });
  // Username is not case sensitive ("Admin" = "admin").
  const userOk = String(req.body.username || '').trim().toLowerCase() === String(s.admin_username || 'admin').toLowerCase();
  if (!demo && !(userOk && verifyPassword(String(req.body.password || ''), s.admin_password_hash))) {
    // Count failures within a 15-minute window that starts at the first one.
    const fresh = !f || now - f.since > 15 * 60 * 1000;
    const n = (fresh ? 0 : f.n) + 1;
    loginFails.set(ip, { n, since: fresh ? now : f.since, until: n >= 10 ? now + 15 * 60 * 1000 : 0 });
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  loginFails.delete(ip);
  const exp = String(Date.now() + 1000 * 60 * 60 * 12);
  res.setHeader('Set-Cookie', `sb_admin=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=${60 * 60 * 12}`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', `sb_admin=; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req), demo: getSettings().admin_demo_mode === '1' }));

app.use('/api/admin', requireAdmin);

app.get('/api/admin/stats', (req, res) => {
  const today = todayStr();
  const month = today.slice(0, 7);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const monthBookings = db.prepare(`SELECT date, slot FROM bookings WHERE date LIKE ? AND ${ACTIVE}`).all(month + '-%');

  // Free dates remaining this month (from today onwards, with at least one half open)
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const taken = {};
  for (const r of monthBookings) {
    const d = (taken[r.date] ||= { first: false, second: false });
    if (r.slot !== 'second') d.first = true;
    if (r.slot !== 'first') d.second = true;
  }
  let fullyFree = 0, partlyFree = 0;
  for (let d = Number(today.slice(8)); d <= daysInMonth; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    const t = taken[ds];
    if (!t) fullyFree++;
    else if (!t.first || !t.second) partlyFree++;
  }

  res.json({
    today,
    pending: one("SELECT COUNT(*) n FROM bookings WHERE status = 'pending'").n,
    todays: db.prepare(`SELECT * FROM bookings WHERE date = ? AND ${ACTIVE} ORDER BY slot`).all(today),
    month_bookings: one(`SELECT COUNT(*) n FROM bookings WHERE date LIKE ? AND ${ACTIVE}`, month + '-%').n,
    month_revenue: one("SELECT COALESCE(SUM(amount),0) v FROM bookings WHERE date LIKE ? AND status = 'approved'", month + '-%').v,
    month_collected: one("SELECT COALESCE(SUM(amount),0) v FROM bookings WHERE date LIKE ? AND status = 'approved' AND payment_status = 'paid'", month + '-%').v,
    free_dates: fullyFree,
    partly_free_dates: partlyFree,
    upcoming: db.prepare(`SELECT * FROM bookings WHERE date >= ? AND ${ACTIVE} ORDER BY date, slot LIMIT 8`).all(today),
    recent: db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 6').all(),
  });
});

app.get('/api/admin/bookings', (req, res) => {
  const where = [];
  const params = [];
  if (MONTH_RE.test(req.query.month || '')) { where.push('date LIKE ?'); params.push(req.query.month + '-%'); }
  if (STATUSES.includes(req.query.status)) { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.q) {
    where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ? OR ref LIKE ?)');
    const q = `%${clean(req.query.q, 60)}%`;
    params.push(q, q, q, q);
  }
  const sql = `SELECT * FROM bookings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, slot LIMIT 500`;
  res.json(db.prepare(sql).all(...params));
});

// Manual / walk-in booking created by admin (approved immediately)
app.post('/api/admin/bookings', (req, res) => {
  const s = getSettings();
  const date = clean(req.body.date, 10);
  const slot = clean(req.body.slot, 10);
  const name = clean(req.body.name, 100);
  if (!DATE_RE.test(date) || !SLOTS.includes(slot) || !name) return res.status(400).json({ error: 'Date, slot and name are required.' });
  if (!slotFree(date, slot)) return res.status(409).json({ error: 'That slot is already booked.' });
  const amount = req.body.amount === '' || req.body.amount == null ? priceFor(slot, s) : Number(req.body.amount);
  const ref = makeRef();
  db.prepare(`INSERT INTO bookings (ref, date, slot, name, group_type, phone, email, event_type, notes, amount, status, payment_status, source)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'approved', ?, 'admin')`).run(
    ref, date, slot, name, clean(req.body.group_type, 20) || 'Band', clean(req.body.phone, 20), clean(req.body.email, 120),
    clean(req.body.event_type, 60), clean(req.body.notes, 500), amount, req.body.payment_status === 'paid' ? 'paid' : 'unpaid'
  );
  res.json({ ok: true, ref });
});

app.patch('/api/admin/bookings/:id', wrap(async (req, res) => {
  const s = getSettings();
  const id = Number(req.params.id);
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });

  const next = { ...b };
  if (req.body.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });
    next.status = req.body.status;
  }
  if (req.body.payment_status !== undefined) next.payment_status = req.body.payment_status === 'paid' ? 'paid' : 'unpaid';
  if (req.body.amount !== undefined) next.amount = Math.max(0, Number(req.body.amount) || 0);

  // Re-activating a cancelled booking must not collide with a newer one.
  if (b.status === 'cancelled' && next.status !== 'cancelled' && !slotFree(b.date, b.slot, b.id)) {
    return res.status(409).json({ error: 'This slot has since been taken by another booking.' });
  }

  db.prepare("UPDATE bookings SET status = ?, payment_status = ?, amount = ?, updated_at = datetime('now') WHERE id = ?")
    .run(next.status, next.payment_status, next.amount, id);

  if (next.status !== b.status && b.email && next.status !== 'pending') {
    const approved = next.status === 'approved';
    sendMail({
      to: b.email,
      subject: `${s.studio_name}: booking ${approved ? 'confirmed ✅' : 'cancelled'} (${b.ref})`,
      html: `<p>Hi ${esc(b.name)},</p><p>Your booking has been <b>${approved ? 'confirmed' : 'cancelled'}</b>.</p>${bookingTable(next, slotLabel(b.slot, s), s.currency)}<p>Call us on ${esc(s.phone)} for any help.</p>`,
    });
  }
  res.json({ ok: true, booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) });
}));

app.get('/api/admin/revenue', (req, res) => {
  const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : todayStr().slice(0, 4);
  const rows = db.prepare(`
    SELECT substr(date, 6, 2) AS m,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN amount END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN status = 'approved' AND payment_status = 'paid' THEN amount END), 0) AS collected,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pipeline,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
      SUM(CASE WHEN status = 'approved' AND slot = 'full' THEN 1 ELSE 0 END) AS full_count,
      SUM(CASE WHEN status = 'approved' AND slot != 'full' THEN 1 ELSE 0 END) AS half_count,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
    FROM bookings WHERE date LIKE ? GROUP BY m`).all(year + '-%');
  const byMonth = Object.fromEntries(rows.map((r) => [r.m, r]));
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    return { month: `${year}-${m}`, ...(byMonth[m] || { revenue: 0, collected: 0, pipeline: 0, approved_count: 0, full_count: 0, half_count: 0, cancelled_count: 0 }) };
  });
  res.json({ year, months });
});

// Notifications
app.get('/api/admin/notifications', (req, res) => {
  res.json({
    unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE read = 0').get().n,
    items: db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 30').all(),
  });
});
app.post('/api/admin/notifications/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  res.json({ ok: true });
});

// Uploads (base64 data URL -> file in /uploads)
app.post('/api/admin/upload', (req, res) => {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.dataUrl || ''));
  if (!m) return res.status(400).json({ error: 'Upload a PNG, JPG, WEBP or GIF image.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Image must be under 6 MB.' });
  const file = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
  persist.putFile('uploads/' + file, buf);
  // Optional small copy for grids/tiles, generated in the browser; served from uploads/thumbs/.
  const t = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.thumbDataUrl || ''));
  if (t) {
    const tbuf = Buffer.from(t[2], 'base64');
    if (tbuf.length <= 1024 * 1024) { fs.writeFileSync(path.join(THUMB_DIR, file), tbuf); persist.putFile('uploads/thumbs/' + file, tbuf); }
  }
  res.json({ url: 'uploads/' + file });
});

function removeUpload(url) {
  if (url && /^\/?uploads\//.test(url)) {
    fs.rm(path.join(UPLOAD_DIR, path.basename(url)), { force: true }, () => {});
    fs.rm(path.join(THUMB_DIR, path.basename(url)), { force: true }, () => {});
    persist.removeFile('uploads/' + path.basename(url));
    persist.removeFile('uploads/thumbs/' + path.basename(url));
  }
}

// Banners
app.get('/api/admin/banners', (req, res) => res.json(db.prepare('SELECT * FROM banners ORDER BY sort, id').all()));
app.post('/api/admin/banners', (req, res) => {
  const b = req.body;
  if (!clean(b.title)) return res.status(400).json({ error: 'Title is required.' });
  const vals = [clean(b.title, 120), clean(b.subtitle, 300), DATE_RE.test(b.event_date || '') ? b.event_date : null,
    clean(b.image, 500), clean(b.cta_text, 40), clean(b.cta_link, 300), b.active ? 1 : 0, Number(b.sort) || 0];
  if (b.id) {
    const old = db.prepare('SELECT image FROM banners WHERE id = ?').get(b.id);
    db.prepare('UPDATE banners SET title=?, subtitle=?, event_date=?, image=?, cta_text=?, cta_link=?, active=?, sort=? WHERE id=?').run(...vals, b.id);
    if (old && old.image !== vals[3]) removeUpload(old.image);
  } else {
    db.prepare('INSERT INTO banners (title, subtitle, event_date, image, cta_text, cta_link, active, sort) VALUES (?,?,?,?,?,?,?,?)').run(...vals);
  }
  res.json({ ok: true });
});
app.delete('/api/admin/banners/:id', (req, res) => {
  const old = db.prepare('SELECT image FROM banners WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
  if (old) removeUpload(old.image);
  res.json({ ok: true });
});

// Gallery
app.post('/api/admin/gallery', (req, res) => {
  const image = clean(req.body.image, 500);
  if (!image) return res.status(400).json({ error: 'Image is required.' });
  const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 s FROM gallery').get().s;
  db.prepare('INSERT INTO gallery (image, caption, category, credit, sort) VALUES (?,?,?,?,?)')
    .run(image, clean(req.body.caption, 120), clean(req.body.category, 60) || 'Live Room', clean(req.body.credit, 300), sort);
  res.json({ ok: true });
});
app.patch('/api/admin/gallery/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM gallery WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Photo not found.' });
  db.prepare('UPDATE gallery SET caption = ?, category = ? WHERE id = ?').run(
    req.body.caption !== undefined ? clean(req.body.caption, 120) : g.caption,
    req.body.category !== undefined ? clean(req.body.category, 60) || g.category : g.category,
    req.params.id
  );
  res.json({ ok: true });
});
app.delete('/api/admin/gallery/:id', (req, res) => {
  const old = db.prepare('SELECT image FROM gallery WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM gallery WHERE id = ?').run(req.params.id);
  if (old) removeUpload(old.image);
  res.json({ ok: true });
});

// Testimonials
app.get('/api/admin/testimonials', (req, res) => res.json(db.prepare('SELECT * FROM testimonials ORDER BY approved, id DESC').all()));
app.post('/api/admin/testimonials', (req, res) => {
  const name = clean(req.body.name, 80), message = clean(req.body.message, 600);
  if (!name || !message) return res.status(400).json({ error: 'Name and message are required.' });
  db.prepare('INSERT INTO testimonials (name, band, message, rating, approved) VALUES (?,?,?,?,1)')
    .run(name, clean(req.body.band, 80), message, Math.min(5, Math.max(1, Number(req.body.rating) || 5)));
  res.json({ ok: true });
});
app.patch('/api/admin/testimonials/:id', (req, res) => {
  db.prepare('UPDATE testimonials SET approved = ? WHERE id = ?').run(req.body.approved ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/testimonials/:id', (req, res) => {
  db.prepare('DELETE FROM testimonials WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Settings
app.get('/api/admin/settings', (req, res) => {
  const { admin_password_hash, ...rest } = getSettings();
  res.json(rest);
});
app.put('/api/admin/settings', (req, res) => {
  const allowed = [...PUBLIC_SETTINGS, 'owner_email', 'admin_demo_mode'];
  for (const k of allowed) if (req.body[k] !== undefined) setSetting(k, String(req.body[k]).slice(0, 5000));
  res.json({ ok: true });
});
app.post('/api/admin/password', (req, res) => {
  const s = getSettings();
  if (!verifyPassword(String(req.body.current || ''), s.admin_password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (String(req.body.next || '').length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  setSetting('admin_password_hash', hashPassword(req.body.next));
  res.json({ ok: true });
});

// ---------- membership (singer login + admin member management) ----------
mountMembers(app, { sign, readCookie, notify, cookiePath: COOKIE_PATH });

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const server = express();
server.set('trust proxy', true);
// Old addresses (e.g. studio.virashalabs.online, www.) permanently redirect to the main domain, keeping the path.
// Off until CANONICAL_HOST is set; the onrender.com address is left alone for health checks and keep-awake pings.
const CANONICAL_HOST = (process.env.CANONICAL_HOST || '').trim().toLowerCase();
const REDIRECT_HOSTS = new Set((process.env.REDIRECT_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
server.use((req, res, next) => {
  if (CANONICAL_HOST && REDIRECT_HOSTS.has(req.hostname) && req.hostname !== CANONICAL_HOST) {
    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  }
  next();
});
// "/studioapp" -> "/studioapp/" so the pages' relative links resolve inside the app.
server.use((req, res, next) => {
  const [p, q] = req.originalUrl.split('?');
  if (BASE_PATH && p === BASE_PATH) return res.redirect(301, BASE_PATH + '/' + (q ? '?' + q : ''));
  next();
});
server.use(BASE_PATH || '/', app);

server.listen(PORT, () => {
  console.log(`\n🎸 Studio Booking running at http://localhost:${PORT}${COOKIE_PATH}`);
  console.log(`   Admin dashboard:        http://localhost:${PORT}${COOKIE_PATH}admin.html`);
  if (!process.env.ADMIN_PASSWORD) console.log('   Default admin password: admin123 (change it in Admin → Settings)');
});

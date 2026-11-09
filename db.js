// SQLite storage using Node's built-in driver (no native build step needed).
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Fresh install (e.g. a host whose disk is wiped on restart): start from the demo content in seed/.
const DB_FILE = path.join(DATA_DIR, 'studio.db');
const SEED_FILE = path.join(__dirname, 'seed', 'studio.db');
if (!fs.existsSync(DB_FILE) && fs.existsSync(SEED_FILE)) fs.copyFileSync(SEED_FILE, DB_FILE);

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ref            TEXT UNIQUE NOT NULL,
  date           TEXT NOT NULL,              -- YYYY-MM-DD
  slot           TEXT NOT NULL CHECK (slot IN ('first','second','full')),
  name           TEXT NOT NULL,
  group_type     TEXT NOT NULL DEFAULT 'Band',
  phone          TEXT NOT NULL,
  email          TEXT NOT NULL,
  event_type     TEXT,
  attendees      INTEGER,
  notes          TEXT,
  amount         REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')),
  source         TEXT NOT NULL DEFAULT 'online',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);

CREATE TABLE IF NOT EXISTS banners (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  subtitle   TEXT,
  event_date TEXT,
  image      TEXT,
  cta_text   TEXT,
  cta_link   TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gallery (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  image      TEXT NOT NULL,
  caption    TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS testimonials (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  band       TEXT,
  message    TEXT NOT NULL,
  rating     INTEGER NOT NULL DEFAULT 5,
  approved   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS members (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  member_no       TEXT UNIQUE NOT NULL,          -- RRS + 4 digits
  name            TEXT NOT NULL,
  gender          TEXT NOT NULL CHECK (gender IN ('Male','Female')),
  phone           TEXT NOT NULL,
  email           TEXT,
  dob             TEXT,
  address         TEXT,
  plan            TEXT NOT NULL,                 -- tier key from the membership_plans setting
  start_date      TEXT NOT NULL,
  valid_until     TEXT NOT NULL,
  upgrade_request TEXT,                          -- tier key the singer asked to move to
  pin_hash        TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per song a member sang. Kept for 12 months (older rows are purged by the server).
CREATE TABLE IF NOT EXISTS member_songs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  sung_on    TEXT NOT NULL,                      -- YYYY-MM-DD
  title      TEXT NOT NULL,
  album      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_member_songs ON member_songs(member_id, sung_on);

-- Monthly membership fee: one row per member per paid month.
CREATE TABLE IF NOT EXISTS member_payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,                      -- YYYY-MM
  plan       TEXT NOT NULL,
  amount     REAL NOT NULL,
  paid_on    TEXT NOT NULL,                      -- YYYY-MM-DD
  UNIQUE (member_id, month)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  booking_id INTEGER,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Weekly singing events: voting, song choices, pairing (line-up) and the week's video link.
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  event_date   TEXT NOT NULL,                      -- YYYY-MM-DD
  event_time   TEXT,
  venue        TEXT,
  notes        TEXT,
  voting_open  INTEGER NOT NULL DEFAULT 1,
  songs_open   INTEGER NOT NULL DEFAULT 0,
  published    INTEGER NOT NULL DEFAULT 0,         -- line-up visible to singers
  done         INTEGER NOT NULL DEFAULT 0,         -- songs added to the singers' monthly counts
  video_link   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS event_votes (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  going      INTEGER NOT NULL,
  voted_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, member_id)
);
-- Songs a singer would like to sing that week (solo or duet).
CREATE TABLE IF NOT EXISTS event_choices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('solo','duet')),
  title      TEXT NOT NULL,
  album      TEXT,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_event_choices ON event_choices(event_id, member_id);
-- Line-up made by the admin: a duet (male + female) or a solo (female_id NULL / male_id NULL).
CREATE TABLE IF NOT EXISTS event_pairs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  male_id    INTEGER REFERENCES members(id) ON DELETE CASCADE,
  female_id  INTEGER REFERENCES members(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  album      TEXT,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_event_pairs ON event_pairs(event_id);
-- "I've paid" messages from singers (UPI reference), confirmed by the admin.
CREATE TABLE IF NOT EXISTS payment_claims (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  amount     REAL NOT NULL,
  ref        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (member_id, month)
);
`);
const memberCols = db.prepare('PRAGMA table_info(members)').all().map((c) => c.name);
// Singers who joined through an event vote link wait for the admin's approval.
if (!memberCols.includes('approved')) db.exec('ALTER TABLE members ADD COLUMN approved INTEGER NOT NULL DEFAULT 1');
const songCols = db.prepare('PRAGMA table_info(member_songs)').all().map((c) => c.name);
// Songs added automatically from a weekly event (so finishing it again replaces them).
if (!songCols.includes('event_id')) db.exec('ALTER TABLE member_songs ADD COLUMN event_id INTEGER');

// Migrations for databases created before a column existed.
const galleryCols = db.prepare('PRAGMA table_info(gallery)').all().map((c) => c.name);
if (!galleryCols.includes('category')) db.exec("ALTER TABLE gallery ADD COLUMN category TEXT NOT NULL DEFAULT 'Live Room'");
if (!galleryCols.includes('credit')) db.exec('ALTER TABLE gallery ADD COLUMN credit TEXT');
// Site paths are stored relative ("img/x.svg", "book.html") so the app can run under a sub-path like /studioapp.
db.exec(`
UPDATE banners SET image = substr(image, 2) WHERE image LIKE '/%' AND image NOT LIKE '//%';
UPDATE banners SET cta_link = './' || substr(cta_link, 2) WHERE cta_link LIKE '/%' AND cta_link NOT LIKE '//%';
UPDATE gallery SET image = substr(image, 2) WHERE image LIKE '/%' AND image NOT LIKE '//%';
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

const DEFAULT_SETTINGS = {
  studio_name: 'Rhythm Rehearsal Studio',
  tagline: 'Plug in. Play loud. Make memories.',
  phone: '+91 99622 58845',
  whatsapp: '919962258845',
  email: 'rhythmmusicals2024@gmail.com',
  owner_email: '',
  address: '91C, 11th West Street, Metha Nagar, Kundrathur, Chennai, Tamil Nadu 600069',
  map_link: 'https://www.google.com/maps/search/?api=1&query=Rhythm+Rehearsal+Studio+Kundrathur+Chennai+600069',
  currency: '₹',
  price_half: '2500',
  price_full: '4500',
  first_half_label: 'First Half',
  first_half_time: '9:00 AM – 2:00 PM',
  second_half_label: 'Second Half',
  second_half_time: '3:00 PM – 10:00 PM',
  full_day_time: '9:00 AM – 10:00 PM',
  booking_window_days: '120',
  about_title: 'A home for every band, every sound',
  about_text:
    'Rhythm Rehearsal Studio is a fully air-conditioned, acoustically treated rehearsal space built by musicians, for musicians. ' +
    'Whether you are a five-piece rock band tightening a setlist, a choir preparing for a concert, or a group of friends ' +
    'celebrating with a jam night, our room is ready the moment you walk in.\n\n' +
    'Book a half day for a focused rehearsal, or take the whole day for workshops, music meets, album pre-production ' +
    'or a private celebration. Our in-house engineer is around to help you dial in your sound.',
  attractions: JSON.stringify([
    { icon: '🥁', title: 'Full Backline', text: 'Pearl 5-piece kit, Marshall & Fender amps, Ampeg bass rig, 88-key stage piano.' },
    { icon: '🎚️', title: 'Pro PA & Mixer', text: '16-channel digital mixer, 2kW PA, stage monitors and Shure mics.' },
    { icon: '🔇', title: 'Acoustic Treatment', text: 'Soundproofed, treated walls so you hear every note – and the neighbours don\'t.' },
    { icon: '❄️', title: 'Air Conditioned', text: '800 sq.ft. live room that stays cool through the longest sessions.' },
    { icon: '🎙️', title: 'Record Your Jam', text: 'Multitrack recording of your session on request.' },
    { icon: '🎉', title: 'Events & Celebrations', text: 'Lounge seating, mood lighting and space for up to 40 guests.' },
    { icon: '🅿️', title: 'Parking & Loading', text: 'Easy gear loading bay and parking for the band van.' },
    { icon: '☕', title: 'Green Room', text: 'Chill-out lounge with tea, coffee and Wi-Fi between takes.' },
  ]),
  admin_username: 'admin', // admin login name (not case sensitive)
  admin_demo_mode: '1', // demo site: admin dashboard opens without a password
  gallery_categories: 'Live Room, Audio System, Mixing Desk, Green Room Lounge, Pantry Area, Events',
  // Membership tiers, separate for male and female singers: songs per calendar month (null = unlimited) and monthly price.
  // Within each gender the plans are ordered from smallest to largest.
  membership_plans: JSON.stringify([
    { key: 'basic', gender: 'Male', name: 'Budget', limit: 20, price: 1500 },
    { key: 'economy', gender: 'Male', name: 'Economy', limit: 30, price: 2500 },
    { key: 'premium', gender: 'Male', name: 'Premium', limit: 40, price: 3500 },
    { key: 'unlimited', gender: 'Male', name: 'Unlimited', limit: null, price: 4000 },
    { key: 'f_basic', gender: 'Female', name: 'Budget', limit: 20, price: 1000 },
    { key: 'f_economy', gender: 'Female', name: 'Economy', limit: 25, price: 1500 },
    { key: 'f_standard', gender: 'Female', name: 'Standard', limit: 35, price: 2500 },
    { key: 'f_premium', gender: 'Female', name: 'Premium', limit: 50, price: 3000 },
    { key: 'f_elite', gender: 'Female', name: 'Elite', limit: 100, price: 4000 },
  ]),
  membership_due_day: '10',
  // UPI payment details shown to singers (QR image in public/img/upi-qr.png).
  upi_id: '9962258845@okbizaxis',
  upi_name: 'Rhythm Rehearsal Studio',
  events_keep_weeks: '13', // weekly events older than this are offered for deletion // monthly fee must be paid by this day of the month
  instagram: 'https://instagram.com',
  youtube: 'https://youtube.com',
};

function seed() {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

  const hasPw = db.prepare("SELECT 1 FROM settings WHERE key = 'admin_password_hash'").get();
  if (!hasPw) {
    insertSetting.run('admin_password_hash', hashPassword(process.env.ADMIN_PASSWORD || 'admin123'));
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM banners').get().n === 0) {
    const ins = db.prepare(
      'INSERT INTO banners (title, subtitle, event_date, image, cta_text, cta_link, sort) VALUES (?,?,?,?,?,?,?)'
    );
    const d = (offset) => {
      const t = new Date();
      t.setDate(t.getDate() + offset);
      return t.toISOString().slice(0, 10);
    };
    ins.run('Sunday Open Jam', 'Bring your instrument, meet new musicians and jam till late. Entry free!', d(5), 'img/banner-jam.svg', 'Book Your Slot', 'book.html', 1);
    ins.run('Unplugged Acoustic Night', 'An intimate evening of acoustic covers and originals.', d(12), 'img/banner-acoustic.svg', 'Know More', 'about.html', 2);
    ins.run('Weekday Rehearsal Offer', 'Flat 15% off on all weekday half-day slots this month.', null, 'img/banner-offer.svg', 'Grab the Offer', 'book.html', 3);
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM gallery').get().n === 0) {
    const ins = db.prepare('INSERT INTO gallery (image, caption, category, sort) VALUES (?,?,?,?)');
    [
      ['img/gallery-1.svg', 'The Live Room', 'Live Room'],
      ['img/gallery-2.svg', 'Drum Corner', 'Live Room'],
      ['img/gallery-3.svg', 'Amp Wall', 'Audio System'],
      ['img/gallery-4.svg', 'Mixing Desk', 'Mixing Desk'],
      ['img/gallery-5.svg', 'Green Room Lounge', 'Green Room Lounge'],
      ['img/gallery-6.svg', 'Celebration Night', 'Events'],
    ].forEach(([img, cap, cat], i) => ins.run(img, cap, cat, i));
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM testimonials').get().n === 0) {
    const ins = db.prepare('INSERT INTO testimonials (name, band, message, rating, approved) VALUES (?,?,?,?,1)');
    ins.run('Arjun Menon', 'The Backbenchers', 'Best-sounding room in the city. The drum kit is always tuned and the AC actually works! We rehearse here every week.', 5);
    ins.run('Priya Sharma', 'Harmony Choir', 'We booked a full day for our concert prep – spacious, clean and the staff helped us set up the mics. Booking online took a minute.', 5);
    ins.run('Rohit & Friends', 'Birthday Jam', 'Celebrated my birthday with a jam session here. Mood lighting, great sound and zero hassle. Highly recommend!', 4);
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM members').get().n === 0) seedMembers();
}

// Demo singers, created on every fresh start with songs dated around today so "this month" always has data.
function seedMembers() {
  const SONGS = [
    ['Ilaya Nila', 'Payanangal Mudivathillai'], ['Munbe Vaa', 'Sillunu Oru Kaadhal'], ['Vaseegara', 'Minnale'],
    ['Snehithane', 'Alaipayuthey'], ['Kadhal Rojave', 'Roja'], ['Uyire Uyire', 'Bombay'],
    ['Nenjukkul Peidhidum', 'Vaaranam Aayiram'], ['Why This Kolaveri Di', '3'], ['Kannaana Kanney', 'Viswasam'],
    ['Thalli Pogathey', 'Achcham Yenbadhu Madamaiyada'], ['Pachai Nirame', 'Alaipayuthey'], ['Ennavale Adi Ennavale', 'Kadhalan'],
    ['Mukkala Mukkabala', 'Kadhalan'], ['Putham Pudhu Kaalai', 'Alaigal Oivathillai'], ['Sundari Kannal', 'Thalapathi'],
    ['Raja Raja Chozhan', 'Rettai Vaal Kuruvi'], ['Anjali Anjali', 'Duet'], ['Poongatru Puthithanathu', 'Moondram Pirai'],
    ['Kannalane', 'Bombay'], ['Vennilave Vennilave', 'Minsara Kanavu'], ['Nila Kaigirathu', 'Indira'],
    ['Thendral Vanthu', 'Avatharam'], ['Unakkenna Venum Sollu', 'Yennai Arindhaal'], ['Pookkalae Sattru Oyivedungal', 'I'],
    ['Kanave Kanave', 'David'], ['Oru Naalil', 'Pudhupettai'], ['Mannil Indha Kadhal', 'Keladi Kanmani'],
  ];
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date();
  const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return ymd(d); };
  // n songs spread over the days of a month (monthsAgo = 0 is this month, up to today).
  const datesIn = (monthsAgo, n) => {
    const first = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
    const last = monthsAgo === 0 ? today.getDate() : new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return Array.from({ length: n }, (_, i) => ymd(new Date(first.getFullYear(), first.getMonth(), 1 + Math.floor((i * last) / n))));
  };
  const insM = db.prepare(`INSERT INTO members (member_no, name, gender, phone, email, dob, address, plan, start_date, valid_until, upgrade_request, pin_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insS = db.prepare('INSERT INTO member_songs (member_id, sung_on, title, album) VALUES (?,?,?,?)');
  const insP = db.prepare('INSERT INTO member_payments (member_id, month, plan, amount, paid_on) VALUES (?,?,?,?,?)');
  const plans = JSON.parse(DEFAULT_SETTINGS.membership_plans);
  const monthOf = (ago) => ymd(new Date(today.getFullYear(), today.getMonth() - ago, 1)).slice(0, 7);
  const monthEnd = (ago) => ymd(new Date(today.getFullYear(), today.getMonth() - ago + 1, 0));
  const pin = hashPassword('1234');
  const demo = [
    // member_no, name, gender, phone, email, plan, upgrade request, songs per month [this month, 1 ago, 2 ago, ...],
    // unpaid months (0 = this month, 1 = last month; every other month since joining is paid)
    ['RRS1001', 'Ram Kumar', 'Male', '+91 98400 11223', 'ram.kumar@example.com', 'basic', null, [22, 18, 20, 16, 19], []],
    ['RRS1002', 'Priya Lakshmi', 'Female', '+91 98410 22334', 'priya.l@example.com', 'f_standard', null, [14, 27, 25, 22], []],
    ['RRS1003', 'Karthik Raja', 'Male', '+91 98420 33445', 'karthik.r@example.com', 'premium', null, [31, 38, 36, 38, 29, 35], [0]],
    ['RRS1004', 'Meena Sundar', 'Female', '+91 98430 44556', 'meena.s@example.com', 'f_elite', null, [52, 61, 48], []],
    ['RRS1005', 'Arun Prakash', 'Male', '+91 98440 55667', 'arun.p@example.com', 'basic', null, [19, 12, 15], [0, 1]],
    ['RRS1006', 'Divya Ramesh', 'Female', '+91 98450 66778', 'divya.r@example.com', 'f_basic', 'f_economy', [24, 20], []],
  ];
  let k = 0;
  const paidDay = (ago) => (ago === 0 ? Math.min(3, today.getDate()) : 5);
  for (const [no, name, gender, phone, email, plan, req, months, unpaid] of demo) {
    const tier = plans.find((p) => p.key === plan);
    const price = tier.price;
    const paidAgo = months.map((_, ago) => ago).filter((ago) => !unpaid.includes(ago));
    // Valid through the end of the latest paid month (or the joining month if nothing is paid yet).
    const validUntil = monthEnd(paidAgo.length ? Math.min(...paidAgo) : months.length - 1);
    const id = insM.run(no, name, gender, phone, email, null, 'Chennai', plan, monthOf(months.length - 1) + '-01', validUntil, req, pin).lastInsertRowid;
    months.forEach((n, ago) => datesIn(ago, n).forEach((d) => { const [t, a] = SONGS[k++ % SONGS.length]; insS.run(id, d, t, a); }));
    for (const ago of paidAgo) insP.run(id, monthOf(ago), plan, price, `${monthOf(ago)}-${pad(paidDay(ago))}`);
  }
}
seed();
migrateGenderPlans();

// Older databases had one plan list with a male and a female price per plan. Female singers now have their own
// tariff (different song limits), so switch to the per-gender list and move each female singer to the female plan
// that covers at least the songs her old plan allowed.
function migrateGenderPlans() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'membership_plans'").get();
  let list = [];
  try { list = JSON.parse(row.value); } catch { /* replaced below */ }
  if (Array.isArray(list) && list.length && list.every((p) => p.gender)) return;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'membership_plans'").run(DEFAULT_SETTINGS.membership_plans);
  const toFemale = { basic: 'f_basic', economy: 'f_standard', premium: 'f_premium', unlimited: 'f_elite' };
  const order = JSON.parse(DEFAULT_SETTINGS.membership_plans).filter((p) => p.gender === 'Female').map((p) => p.key);
  const female = db.prepare("SELECT id, plan, upgrade_request FROM members WHERE gender = 'Female'").all();
  const upd = db.prepare('UPDATE members SET plan = ?, upgrade_request = ? WHERE id = ?');
  for (const m of female) {
    const plan = toFemale[m.plan] || 'f_basic';
    // A pending upgrade request becomes a request for the next female plan up.
    upd.run(plan, m.upgrade_request ? order[order.indexOf(plan) + 1] || null : null, m.id);
  }
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

module.exports = { db, getSettings, setSetting, hashPassword, verifyPassword };

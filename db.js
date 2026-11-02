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

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  booking_id INTEGER,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

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
  studio_name: 'Riff Room Studios',
  tagline: 'Plug in. Play loud. Make memories.',
  phone: '+91 98765 43210',
  whatsapp: '919876543210',
  email: 'hello@riffroom.studio',
  owner_email: '',
  address: '2nd Floor, Melody Arcade, MG Road, Bengaluru 560001',
  map_link: 'https://maps.google.com',
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
    'Riff Room Studios is a fully air-conditioned, acoustically treated rehearsal space built by musicians, for musicians. ' +
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
  admin_demo_mode: '1', // demo site: admin dashboard opens without a password
  gallery_categories: 'Live Room, Audio System, Mixing Desk, Green Room Lounge, Pantry Area, Events',
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
}
seed();

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

module.exports = { db, getSettings, setSetting, hashPassword, verifyPassword };

// Keeps the site's data across restarts on hosts with a throw-away disk (Render free plan).
// The SQLite database and uploaded images are mirrored to a private Supabase Storage bucket:
//   - on start, the latest database snapshot and any missing uploads are downloaded
//   - after changes, a consistent snapshot (VACUUM INTO) is uploaded within a few seconds
//   - uploads/deletes of images are mirrored straight away
//   - one dated backup per day is kept under backups/
// Without SUPABASE_URL / SUPABASE_SERVICE_KEY everything here is a no-op (local development).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'studio';
const enabled = !!(URL_ && KEY);

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'studio.db');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const DB_OBJECT = 'db/studio.db';

// Uploading is only allowed once we know the remote state (restored it, or confirmed there is none).
// If Supabase could not be reached at start, we must not overwrite good remote data with the demo seed.
let syncAllowed = false;

const headers = (extra = {}) => ({ Authorization: `Bearer ${KEY}`, apikey: KEY, ...extra });
const objUrl = (p) => `${URL_}/storage/v1/object/${BUCKET}/${p.split('/').map(encodeURIComponent).join('/')}`;

async function download(p) {
  const r = await fetch(objUrl(p), { headers: headers() });
  if (r.status === 404 || r.status === 400) {
    const body = await r.text();
    if (r.status === 404 || /not.?found/i.test(body)) return null; // object doesn't exist
    throw new Error(`Supabase download ${p}: ${r.status} ${body}`);
  }
  if (!r.ok) throw new Error(`Supabase download ${p}: ${r.status} ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

async function upload(p, buf, type = 'application/octet-stream') {
  const r = await fetch(objUrl(p), { method: 'POST', headers: headers({ 'Content-Type': type, 'x-upsert': 'true', 'Cache-Control': 'max-age=0' }), body: buf });
  if (!r.ok) throw new Error(`Supabase upload ${p}: ${r.status} ${await r.text()}`);
}

async function list(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error(`Supabase list ${prefix}: ${r.status} ${await r.text()}`);
    const page = await r.json();
    out.push(...page.filter((o) => o.id)); // folders have no id
    if (page.length < 1000) return out;
  }
}

async function retry(fn, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

const mimeOf = (f) => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' })[path.extname(f).toLowerCase()] || 'application/octet-stream';

// ---------- start-up ----------
async function restore() {
  if (!enabled) { console.log('ℹ️  Supabase not configured: data is kept on local disk only.'); return; }
  try {
    const buf = await retry(() => download(DB_OBJECT));
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (buf) {
      for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) fs.rmSync(f, { force: true });
      fs.writeFileSync(DB_FILE, buf);
      console.log(`✅ Restored database from Supabase (${(buf.length / 1024).toFixed(0)} KB)`);
    } else {
      console.log('ℹ️  No database in Supabase yet: starting from the seed and saving it there.');
    }
    // Images uploaded through the admin that aren't part of the repo.
    for (const dir of ['uploads/', 'uploads/thumbs/']) {
      const objs = await retry(() => list(dir));
      fs.mkdirSync(path.join(UPLOAD_DIR, dir.slice('uploads/'.length)), { recursive: true });
      let n = 0;
      for (const o of objs) {
        const local = path.join(UPLOAD_DIR, dir.slice('uploads/'.length), o.name);
        if (fs.existsSync(local)) continue;
        const b = await retry(() => download(dir + o.name));
        if (b) { fs.writeFileSync(local, b); n++; }
      }
      if (n) console.log(`✅ Restored ${n} file(s) from Supabase ${dir}`);
    }
    syncAllowed = true;
  } catch (e) {
    // Don't start syncing: the remote copy may be fine and newer than what we have.
    console.error('❌ Could not reach Supabase at start-up; changes will NOT be saved until restart.', e.message);
  }
}

// ---------- database snapshots ----------
let db = null, lastChanges = -1, busy = false, lastBackupDay = '';

function snapshot() {
  const tmp = path.join(os.tmpdir(), `studio-snap-${process.pid}-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`); // consistent copy, even with WAL
  const buf = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  return buf;
}

async function flush(force = false) {
  if (!enabled || !syncAllowed || !db || busy) return;
  const changes = db.prepare('SELECT total_changes() n').get().n;
  if (!force && changes === lastChanges) return;
  busy = true;
  try {
    const buf = snapshot();
    await retry(() => upload(DB_OBJECT, buf), 3);
    lastChanges = changes;
    const day = new Date().toISOString().slice(0, 10);
    if (day !== lastBackupDay) {
      await retry(() => upload(`backups/studio-${day}.db`, buf), 2);
      lastBackupDay = day;
    }
  } catch (e) {
    console.error('⚠️  Saving database to Supabase failed (will retry):', e.message);
  } finally { busy = false; }
}

// Called once the database is open. Saves the initial state, then watches for changes.
function watch(database) {
  db = database;
  if (!enabled) return;
  flush(true);
  setInterval(() => flush(), 5000).unref();
}

// ---------- uploaded images ----------
function putFile(rel, buf) {
  if (!enabled || !syncAllowed) return;
  retry(() => upload(rel, buf, mimeOf(rel)), 3).catch((e) => console.error('⚠️  Image upload to Supabase failed:', rel, e.message));
}
function removeFile(rel) {
  if (!enabled || !syncAllowed) return;
  fetch(`${URL_}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: [rel] }) })
    .catch((e) => console.error('⚠️  Image delete in Supabase failed:', rel, e.message));
}

// Final save when the host stops the service (deploys, restarts).
async function shutdown() {
  if (!enabled || !syncAllowed || !db) return;
  for (let i = 0; i < 20 && busy; i++) await new Promise((r) => setTimeout(r, 250));
  await flush(true);
}

module.exports = { enabled, restore, watch, putFile, removeFile, shutdown };

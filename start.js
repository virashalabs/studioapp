// Entry point: restore saved data (Supabase) before the database is opened, then start the web server.
try { process.loadEnvFile(); } catch { /* .env is optional */ }
const persist = require('./persist');

(async () => {
  await persist.restore();
  const { db } = require('./db');
  persist.watch(db);
  require('./server');

  // Save the latest data before the host stops the service (deploy / restart).
  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig} received: saving data…`);
    try { await persist.shutdown(); } catch (e) { console.error(e); }
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  // Render's free plan sleeps after 15 minutes without visitors; a request to our own public
  // address every 10 minutes keeps it awake. RENDER_EXTERNAL_URL is set by Render automatically.
  const self = process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL;
  if (self) {
    setInterval(() => fetch(self, { method: 'HEAD' }).catch(() => {}), 10 * 60 * 1000).unref();
  }
})().catch((e) => { console.error(e); process.exit(1); });

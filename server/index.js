'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
const { getPool } = require('./db');
const auth = require('./auth');
const data = require('./data');

const ROOT = path.join(__dirname, '..');
// Only the front-end files are served; server code and config are never exposed.
const STATIC_FILES = ['index.html', 'styles.css', 'app.js', 'seed.js'];

const app = express();
app.disable('x-powered-by');
if (config.production) app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
});

// CSRF defence: state-changing API calls must be JSON from our own origin.
// Browsers can't send cross-site JSON without a CORS preflight, which we never allow.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // req.is() is null for bodyless requests (e.g. DELETE) and false for a non-JSON body.
  if (req.is('application/json') === false) return res.status(415).json({ error: 'Expected application/json.' });
  const origin = req.get('origin');
  let originHost = null;
  try { originHost = origin && new URL(origin).host; } catch { /* malformed */ }
  if (origin && originHost !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request blocked.' });
  next();
});
app.use('/api', express.json({ limit: '32kb' }));
app.use('/api', auth.loadSession);
app.use('/api/auth', auth.router);
app.use('/api', auth.requireUser, data.router);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));
for (const f of STATIC_FILES) app.get('/' + f, (_req, res) => res.sendFile(path.join(ROOT, f)));

app.use((err, _req, res, _next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error('[server]', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

async function start() {
  const pool = getPool();
  const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM schema_migrations').catch(() => [[null]]);
  if (!row) {
    console.error('[server] Database is not migrated. Run: npm run migrate');
    process.exit(1);
  }
  const server = app.listen(config.port, () => {
    console.log(`[server] Spend Track running at http://localhost:${config.port} (db ${config.db.host}/${config.db.database})`);
  });
  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) start();
module.exports = app;

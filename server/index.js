'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
const { getPool } = require('./db');
const auth = require('./auth');
const data = require('./data');

const ROOT = path.join(__dirname, '..');
// Only the front-end files are served; server code and config are never exposed.
const STATIC_FILES = ['index.html', 'styles.css', 'app.js', 'seed.js', 'api-config.js'];

const app = express();
app.disable('x-powered-by');
// Behind a proxy (or a local tunnel such as cloudflared), use X-Forwarded-For for rate limiting.
app.set('trust proxy', config.production ? 1 : 'loopback');

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
});

// CORS for allowlisted origins only, without credentials: those callers send a bearer
// token, and the session cookie is ignored for them (see auth.loadSession).
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (!origin || !config.allowedOrigins.includes(origin)) return next();
  req.crossOrigin = true;
  res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin' });
  if (req.method !== 'OPTIONS') return next();
  res.set({
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
  });
  res.sendStatus(204);
});

// CSRF defence: state-changing API calls must be JSON from our own origin (or an
// allowlisted one using a bearer token). Browsers can't send cross-site JSON without a
// CORS preflight, which only allowlisted origins pass.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // req.is() is null for bodyless requests (e.g. DELETE) and false for a non-JSON body.
  if (req.is('application/json') === false) return res.status(415).json({ error: 'Expected application/json.' });
  const origin = req.get('origin');
  let originHost = null;
  try { originHost = origin && new URL(origin).host; } catch { /* malformed */ }
  if (origin && !req.crossOrigin && originHost !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request blocked.' });
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

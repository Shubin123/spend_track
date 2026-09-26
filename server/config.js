'use strict';
// Secrets live outside the repo: ~/.config/spend_track/.env by default
// (override with SPEND_TRACK_ENV_FILE). Real environment variables win over the file.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_FILE = process.env.SPEND_TRACK_ENV_FILE || path.join(os.homedir(), '.config', 'spend_track', '.env');

if (fs.existsSync(ENV_FILE)) {
  const mode = fs.statSync(ENV_FILE).mode & 0o077;
  if (mode) console.warn(`[config] ${ENV_FILE} is readable by other users; run: chmod 600 "${ENV_FILE}"`);
  process.loadEnvFile(ENV_FILE); // does not override variables already set
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing ${name}. Run "npm run setup" or set it in ${ENV_FILE}.`);
    process.exit(1);
  }
  return v;
}

module.exports = {
  ENV_FILE,
  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: process.env.DB_NAME || 'spend_track',
    // "required" (default) verifies the server cert against DB_SSL_CA; "off" is for local dev only.
    ssl: (process.env.DB_SSL || 'required').toLowerCase(),
    sslCa: process.env.DB_SSL_CA || '',
  },
  // Optional separate account with DDL rights, used only by scripts/migrate.js.
  migrate: {
    user: process.env.DB_MIGRATE_USER || '',
    password: process.env.DB_MIGRATE_PASSWORD || '',
  },
  port: Number(process.env.PORT || 3000),
  // Other sites allowed to call the API (e.g. the GitHub Pages front end through a tunnel).
  // They authenticate with a bearer token, never the cookie.
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'https://shubin123.github.io')
    .split(',').map(s => s.trim()).filter(Boolean),
  production: process.env.NODE_ENV === 'production',
  sessionDays: Number(process.env.SESSION_TTL_DAYS || 30),
};

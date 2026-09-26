'use strict';
// Operational behaviour: health check, and a real production-mode server process
// (as systemd runs it): secure cookies, no X-Forwarded-For trust, graceful shutdown.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const f = require('./support/factory');
const { useServer, client } = require('./support/http');

const ctx = useServer();

describe('health check', { concurrency: true }, () => {
  it('reports ok with the database up, without auth, never cached', async () => {
    const r = await client(ctx).get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.equal(r.body.db, 'up');
    assert.equal(typeof r.body.uptime, 'number');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  it('is not rate limited and ignores foreign origins', async () => {
    const c = client(ctx, { ip: '198.51.100.1' });
    const results = await Promise.all(Array.from({ length: 50 }, () => c.get('/api/health', { Origin: 'https://evil.example' })));
    assert.ok(results.every(r => r.status === 200));
  });
});

const freePort = () => new Promise(resolve => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

describe('production process', () => {
  let proc, base, output = '';
  before(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
      env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', COOKIE_SECURE: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', d => { output += d; });
    proc.stderr.on('data', d => { output += d; });
    for (let i = 0; i < 100; i++) {
      if ((await fetch(base + '/api/health').catch(() => null))?.ok) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`server did not start:\n${output}`);
  });
  after(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); });

  it('starts in production mode on the configured host', () => {
    assert.match(output, new RegExp(`running at ${base.replace(/\./g, '\\.')} .*production`));
  });

  it('marks the session cookie Secure', async () => {
    const u = await f.createUser();
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password }) });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /; Secure/i);
  });

  it('with TRUST_PROXY=false, a spoofed X-Forwarded-For cannot dodge the rate limit', async () => {
    const attempt = i => fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${i}` }, body: '{}' });
    const statuses = [];
    for (let i = 0; i < 35; i++) statuses.push((await attempt(i)).status);
    assert.ok(statuses.includes(429), `expected 429 despite rotating X-Forwarded-For, got ${[...new Set(statuses)]}`);
  });

  it('shuts down gracefully on SIGTERM (exit code 0)', async () => {
    const exited = new Promise(resolve => proc.once('exit', code => resolve(code)));
    proc.kill('SIGTERM');
    assert.equal(await exited, 0);
    assert.match(output, /SIGTERM received/);
  });
});

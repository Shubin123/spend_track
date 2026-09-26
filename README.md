# Spend Track

A high-fidelity spending tracker with real accounts. The Node/Express API stores users, sessions, transactions, and budgets in MySQL (AWS RDS).

- **Static demo (no login, data stays in your browser):** https://shubin123.github.io/spend_track/
- **Full app with accounts:** run the server locally (see below), or expose it to the Pages site with `npm run tunnel` (see [Connecting GitHub Pages](#connecting-github-pages))

## Features

- **Accounts**: sign up, sign in, and sign out. Passwords are hashed with bcrypt (cost 12). Sessions use an opaque token in an `HttpOnly`, `SameSite=Lax` cookie, and only its SHA-256 is stored in MySQL.
- **Dashboard**: KPIs, spending pace vs. last month and budget, category donut, 6-month trend, and recent activity
- **Transactions**: search, filters, add/edit/delete with undo, and CSV export
- **Budgets**: per-category limits with status and month-end projection
- **Safe updates**:
  - Every change is saved to MySQL before the UI updates.
  - Edits use optimistic concurrency (`version` column). If two tabs or devices edit the same transaction, the second save gets `409` and shows the latest copy instead of silently overwriting.
  - Every query is scoped to the signed-in user.
- Light and dark themes, responsive layout, and the `n` keyboard shortcut for a new transaction

## Setup

Requires Node 21+.

```sh
npm run setup   # prompts for DB host/user/password, then installs, migrates, and optionally creates a login
npm start       # http://localhost:3000
```

`scripts/setup.sh`:
1. Writes credentials to `~/.config/spend_track/.env` with mode `600`. This is **outside the repo**, and the script refuses to write inside the project.
2. Downloads the AWS RDS CA bundle so the database connection uses verified TLS.
3. Runs `npm install` and the migrations.
4. Creates two least-privilege MySQL users and switches the config to them, so the RDS master password isn't stored on disk:
   - `spend_track_app` can only `SELECT/INSERT/UPDATE/DELETE` on `spend_track.*`. The server runs as this user.
   - `spend_track_migrator` has full rights on `spend_track.*` only. `npm run migrate` runs as this user.
   Both require TLS.
5. Optionally creates an account, with or without sample data.

Use `SPEND_TRACK_ENV_FILE=/path/to/.env` to keep the config elsewhere. Real environment variables override the file. See `.env.example` for the keys.

### Secrets policy

- No credentials live in this repository. `.gitignore` blocks `.env*` and `*.pem`, and CI runs [gitleaks](https://github.com/gitleaks/gitleaks) on every push.
- `create-user.js` reads the password from environment variables, so it never lands in shell history or process arguments.
- The app never runs as the RDS master user. Keep the master password in a password manager or the macOS Keychain, not in the `.env` file.
- To rotate the app and migrator passwords: `DB_ADMIN_USER=admin DB_ADMIN_PASSWORD=… node scripts/create-db-users.js`. To keep the password out of shell history, read it from the Keychain: `DB_ADMIN_PASSWORD="$(security find-generic-password -s 'Spend Track RDS master (…)' -w)"`.
- If the master credential is ever committed or shared, rotate it in AWS (RDS → Modify → master password), then rotate the app users as above.

## Connecting GitHub Pages

GitHub Pages only hosts static files, so the Pages site reaches the API through a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) running on this machine:

```sh
npm start                        # terminal 1
npm run tunnel -- --publish      # terminal 2: writes the URL to api-config.js, commits and pushes it
```

- The quick-tunnel URL changes on every run, so re-run with `--publish` after each restart. Pages picks up the change within a few minutes.
- While the tunnel or server is down, the Pages site says so and falls back to browser-only mode.
- Only origins in `ALLOWED_ORIGINS` (default `https://shubin123.github.io`) get CORS access. Those requests authenticate with a bearer token kept in `localStorage`, and the session cookie is ignored for them. Same-origin use (`http://localhost:3000`) keeps the HttpOnly cookie.

## Database changes

Migrations live in `migrations/NNN_name.sql` and are tracked in a `schema_migrations` table with checksums.

```sh
npm run migrate   # applies any new migrations; safe to re-run
```

To change the schema, **add a new numbered file**. Don't edit an applied migration; the runner refuses if a checksum changes.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run setup` | Interactive first-time setup (credentials, TLS CA, install, migrate, optional account) |
| `npm start` | Start the server on `PORT` (default 3000) |
| `npm run dev` | Start with auto-reload |
| `npm run tunnel [-- --publish]` | Expose the local API to the Pages site via a Cloudflare quick tunnel |
| `npm run migrate` | Apply pending migrations (as `DB_MIGRATE_USER` when set) |
| `DB_ADMIN_USER=… DB_ADMIN_PASSWORD=… node scripts/create-db-users.js` | Create or rotate the least-privilege DB users and update the config file |
| `npm test` | Integration tests against the configured DB. They create throwaway users and delete them afterwards. |
| `ST_EMAIL=… ST_PASSWORD=… node scripts/create-user.js` | Create an account or reset its password |

## Layout

```
index.html, styles.css, app.js   Front end
api-config.js                    API URL for the Pages copy (written by scripts/tunnel.sh) (works standalone on GitHub Pages in browser-only mode)
seed.js                          Categories + sample data, shared by browser and server
server/                          Express app: config, db pool, auth, data API
migrations/                      Versioned SQL schema
scripts/                         setup.sh, migrate.js, create-user.js, create-db-users.js, tunnel.sh
test/                            API integration tests (node:test)
```

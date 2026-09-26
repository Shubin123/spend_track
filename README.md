# Spend Track

A high-fidelity spending tracker with real accounts. The Node/Express API stores users, sessions, transactions, and budgets in MySQL (AWS RDS).

- **Static demo (no login, data stays in your browser):** https://shubin123.github.io/spend_track/
- **Full app with accounts:** run the server locally (see below)

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
4. Optionally creates an account, with or without sample data.

Use `SPEND_TRACK_ENV_FILE=/path/to/.env` to keep the config elsewhere. Real environment variables override the file. See `.env.example` for the keys.

### Secrets policy

- No credentials live in this repository. `.gitignore` blocks `.env*` and `*.pem`, and CI runs [gitleaks](https://github.com/gitleaks/gitleaks) on every push.
- `create-user.js` reads the password from environment variables, so it never lands in shell history or process arguments.
- If a credential is ever committed or shared, rotate it in AWS (RDS → Modify → master password), then re-run `npm run setup`.

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
| `npm run migrate` | Apply pending migrations |
| `npm test` | Integration tests against the configured DB. They create throwaway users and delete them afterwards. |
| `ST_EMAIL=… ST_PASSWORD=… node scripts/create-user.js` | Create an account or reset its password |

## Layout

```
index.html, styles.css, app.js   Front end (works standalone on GitHub Pages in browser-only mode)
seed.js                          Categories + sample data, shared by browser and server
server/                          Express app: config, db pool, auth, data API
migrations/                      Versioned SQL schema
scripts/                         setup.sh, migrate.js, create-user.js
test/                            API integration tests (node:test)
```

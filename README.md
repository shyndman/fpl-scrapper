# FPL Web Scraper

A tool that automatically collects player statistics from the Fantasy Premier League (FPL) website and saves them to a local database. It is designed to run on a schedule — after each Premier League gameweek — so you always have up-to-date player data without doing anything manually.

---

## Table of Contents

1. [What this tool does](#1-what-this-tool-does)
2. [How it works](#2-how-it-works)
3. [Folder structure explained](#3-folder-structure-explained)
4. [Prerequisites](#4-prerequisites)
5. [Installation](#5-installation)
6. [Configuration](#6-configuration)
7. [Running the scraper](#7-running-the-scraper)
8. [Running the dashboard webapp](#8-running-the-dashboard-webapp)
9. [Running the tests](#9-running-the-tests)
10. [Verifying your data](#10-verifying-your-data)
11. [Setting up the cron job (OpenClaw)](#11-setting-up-the-cron-job-openclaw)
12. [Querying the database](#12-querying-the-database)
13. [Troubleshooting](#13-troubleshooting)
14. [Keeping the scraper working when FPL changes](#14-keeping-the-scraper-working-when-fpl-changes)

---

## 1. What this tool does

The FPL website at `https://fantasy.premierleague.com/statistics` shows detailed statistics for every player in the Premier League — goals, assists, points, price, ownership, form, expected goals, and much more. This data is served by an undocumented internal API.

This project has two components:

**The scraper** (`src/`):

- **Discovers and calls** that internal API on your behalf
- **Downloads** statistics for all ~700 FPL players
- **Stores** everything in a local SQLite database file (`data/fpl.db`)
- **Runs safely** without getting your account banned — it waits 2–3 seconds between every request and backs off gracefully if the server complains
- **Updates incrementally** — after each gameweek you only need to re-fetch the new data, not everything from scratch

**The dashboard** (`webapp/`):

- A local web application that reads `data/fpl.db` and presents it as interactive pages
- Browse and filter all players and teams, view charts, and compare any players or teams side-by-side
- Launch with `npm run web` and open http://127.0.0.1:8292

The database is also read directly by OpenClaw (or any other tool) for queries and analysis.

---

## 2. How it works

The FPL API is not publicly documented, but the community has reverse-engineered it. There are four key endpoints this tool uses, all of which are public (no login required for basic player stats):

| Endpoint                            | What it returns                                                             |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `/api/bootstrap-static/`            | All ~700 players, all 20 teams, all 38 gameweeks in one large JSON response |
| `/api/element-summary/{player_id}/` | Per-gameweek breakdown for one player — one request per player              |
| `/api/event/{gameweek}/live/`       | Live or provisional points for all players in a given gameweek              |
| `/api/fixtures/`                    | All match fixtures with scores and difficulty ratings                       |

**Two sync modes:**

- **Full sync** (`--full-sync`): Used once at the start. Fetches everything — all players and their complete history. Makes ~700+ HTTP requests. Takes 30–40 minutes because of the intentional rate limiting.
- **Gameweek sync** (`--current-gameweek`): Used every week via cron. Only fetches what changed — the new gameweek's results and updated player prices. Makes ~50–150 requests. Takes 5–15 minutes.

All data is written to `data/fpl.db`, a single SQLite database file. Every write is an upsert (insert or replace), so the tool is safe to re-run if something goes wrong mid-scrape.

---

## 3. Folder structure explained

```
fpl-web-scrapper/
│
├── README.md                  ← You are here
│
├── .env                       ← Your credentials (you create this; never commit it)
├── .gitignore                 ← Tells git to ignore credentials, data, logs
├── package.json               ← npm scripts, runtime deps, dev tooling
├── package-lock.json          ← Locked dependency graph for reproducible installs
├── tsconfig.json              ← TypeScript compiler configuration
├── vitest.config.ts           ← Vitest test runner configuration
├── eslint.config.js           ← ESLint configuration
│
├── config/
│   ├── settings.ts            ← All configurable values (delays, paths, log level)
│   └── .env.example           ← Template for the .env file — copy this to get started
│
├── src/                       ← All scraper TypeScript source code
│   ├── main.ts                ← Entry point behind `npm run cli -- ...`
│   ├── auth.ts                ← Handles FPL login and stores session cookies
│   ├── scraper.ts             ← Makes HTTP requests with rate limiting and retries
│   ├── api.ts                 ← Typed wrappers for each FPL API endpoint
│   ├── transform.ts           ← Converts raw JSON from the API into row models
│   ├── models.ts              ← Schema-aligned classes with `fromDict()` and `toDbTuple()`
│   ├── database.ts            ← Creates the database schema and handles all writes
│   ├── sync.ts                ← Orchestrates the full-sync and gameweek-sync workflows
│   └── logger.ts              ← Sets up logging to the terminal and to a log file
│
├── webapp/                    ← Local web dashboard (separate README inside)
│   ├── README.md              ← Full webapp documentation — read this first
│   ├── server.ts              ← Entry point behind `npm run web`
│   ├── app.ts                 ← Fastify app factory, Nunjucks views, static assets
│   ├── db.ts                  ← Read-only database queries, TTL cache
│   ├── images.ts              ← Downloads player photos and team badges at startup
│   ├── routers/               ← HTML page routes and JSON API routes
│   ├── templates/             ← Jinja2 HTML templates (6 pages + base layout)
│   └── static/                ← CSS, JS helpers, downloaded player/team images
│
├── docs/                      ← Additional reference documentation
│   ├── API.md                 ← Detailed FPL API endpoint documentation
│   ├── SCHEMA.md              ← Full database table and column reference
│   ├── SETUP.md               ← Condensed setup guide
│   └── OPENCLAW.md            ← OpenClaw cron job integration guide
│
├── tests/                     ← Automated Vitest suite
│   ├── test_scraper.ts        ← Tests for rate limiting and HTTP retry logic
│   ├── test_transform.ts      ← Tests for JSON parsing and data cleaning
│   ├── test_database.ts       ← Tests for database schema and upsert operations
│   ├── test_sync.ts           ← Tests for the full-sync and gameweek-sync workflows
│   ├── test_webapp_app.ts     ← Tests for Fastify app wiring and lifecycle behavior
│   ├── test_webapp_pages.ts   ← Tests for HTML routes and rendered pages
│   └── fixtures/              ← Sample API responses used by the tests (no network needed)
│       ├── bootstrap_static.json
│       ├── element_summary_318.json
│       ├── event_25_live.json
│       └── fixtures.json
│
├── data/                      ← Created automatically on first run (git-ignored)
│   ├── fpl.db                 ← The SQLite database
│   └── .session.json          ← Cached login cookies (auto-managed)
│
└── logs/                      ← Created automatically on first run (git-ignored)
    ├── fpl_scraper.log        ← Main application log
    └── cron.log               ← Output from cron runs (if you redirect there)
```

**The files you care about most as a user:**

- `.env` — your FPL credentials (you create this once)
- `data/fpl.db` — the database you query
- `src/main.ts` — the CLI entrypoint behind `npm run cli -- ...`
- `config/settings.ts` — if you need to tune delays or paths

---

## 4. Prerequisites

Before you begin, make sure you have:

1. **Node.js 24 or later**

   ```bash
   node --version
   # Should show v24.x or higher
   ```

   If you don't have it: install the current LTS or newer release from [nodejs.org](https://nodejs.org/).

2. **npm**

   ```bash
   npm --version
   ```

3. **A Fantasy Premier League account**
   Free to create at [fantasy.premierleague.com](https://fantasy.premierleague.com). You only need this to provide credentials in the `.env` file. The main player statistics endpoints are public and work without authentication, but credentials let the scraper re-authenticate if FPL ever adds auth to these endpoints.

4. **About 50 MB of free disk space** for the database.

5. **An internet connection** when running the scraper.

---

## 5. Installation

**Step 1: Get the code**

If you cloned this repository, `cd` into the project folder:

```bash
cd /path/to/fpl-web-scrapper
```

**Step 2: Install dependencies**

```bash
npm install
```

This installs the Node runtime dependencies and the development tooling in one pass: the `tsx` CLI runner, Fastify dashboard server, Vitest, ESLint, Prettier, and TypeScript compiler.

All commands below are run from the project root after `npm install`.

---

## 6. Configuration

**Step 1: Copy the example configuration file**

```bash
cp config/.env.example .env
```

This creates a `.env` file at the project root. It is git-ignored and will never be committed.

**Step 2: Add your FPL credentials**

Open `.env` in any text editor and fill in your FPL account details:

```ini
FPL_LOGIN=your_email@example.com
FPL_PASSWORD=your_password
```

**Step 3: (Optional) Adjust rate limiting**

The defaults are conservative and safe. If you want to change them, you can add these lines to `.env`:

```ini
# Seconds to wait between requests (randomised between min and max)
REQUEST_DELAY_MIN=2.0
REQUEST_DELAY_MAX=3.0

# How many times to retry a failed request
MAX_RETRIES=5

# Log level: DEBUG shows every request; INFO shows progress only
LOG_LEVEL=INFO
```

The full list of configurable options is in `config/.env.example`.

---

## 7. Running the scraper

All commands are run from the project root after `npm install`.

### First run — full sync

Run this once when you first set the project up, and again at the start of each new football season:

```bash
npm run cli -- --full-sync
```

This fetches everything: all teams, all gameweeks, all ~700 players, and the full gameweek-by-gameweek history for each player. It makes roughly 700+ HTTP requests and takes **30–40 minutes** due to rate limiting. This is intentional and keeps your account safe.

You will see progress logged to the terminal:

```
2025-03-11 09:00:00 [INFO    ] src.sync: Starting full sync (run_id=abc-123)
2025-03-11 09:00:02 [INFO    ] src.sync: [1/5] Fetching bootstrap-static…
2025-03-11 09:00:04 [INFO    ] src.sync: Bootstrap: 20 teams, 38 gameweeks, 712 players
2025-03-11 09:00:06 [INFO    ] src.sync: [2/5] Fetching all fixtures…
...
2025-03-11 09:00:10 [INFO    ] src.sync: [4/5] Fetching element-summary for 712 players…
2025-03-11 09:05:00 [INFO    ] src.sync:   Progress: 50/712 players scraped
2025-03-11 09:10:00 [INFO    ] src.sync:   Progress: 100/712 players scraped
...
```

### Weekly update — gameweek sync

Run this after each gameweek's results are confirmed (or let OpenClaw run it automatically):

```bash
npm run cli -- --current-gameweek
```

This automatically detects which gameweek is current from the database and fetches only the new data. Takes 5–15 minutes.

### Re-run a specific gameweek

If something went wrong and you need to re-fetch a particular gameweek:

```bash
npm run cli -- --gameweek 25
```

### Dry run (no database writes)

Fetch data and log what would be written, but don't actually touch the database:

```bash
npm run cli -- --full-sync --dry-run
npm run cli -- --current-gameweek --dry-run
```

Useful for checking the API is working before committing to a full run.

### Discover API structure

Probe all known FPL API endpoints and print their response structure as JSON:

```bash
npm run cli -- --discover-api
```

Use this when you suspect the API has changed (see [section 14](#14-keeping-the-scraper-working-when-fpl-changes)).

### Verbose logging

Add `--log-level DEBUG` to any command to see every HTTP request and database operation:

```bash
npm run cli -- --current-gameweek --log-level DEBUG
```

### Exit codes

The scraper exits with a code that tells OpenClaw (or any calling process) what happened:

| Code | Meaning                                               | Action                              |
| ---- | ----------------------------------------------------- | ----------------------------------- |
| `0`  | Complete success                                      | Nothing needed                      |
| `1`  | Partial — some players failed, DB partially updated   | Re-run the same command; it is safe |
| `2`  | Fatal — auth failure, DB unreachable, or network down | Investigate before re-running       |

---

## 8. Running the dashboard webapp

The webapp reads `data/fpl.db` and presents it as an interactive browser-based dashboard. The scraper must have been run at least once before the webapp has any data to show.

### Start the server

From the project root:

```bash
npm run web
```

Then open **http://127.0.0.1:8292** in your browser. Press `Ctrl+C` to stop the server.

### What you get

| Page          | URL             | Description                                          |
| ------------- | --------------- | ---------------------------------------------------- |
| Dashboard     | `/`             | Current GW summary, top performers, all teams        |
| Players       | `/players`      | Filter and browse all ~700 players; sort by any stat |
| Player detail | `/players/{id}` | Charts, stats, GW history, past seasons              |
| Teams         | `/teams`        | All 20 clubs with badges and records                 |
| Team detail   | `/teams/{id}`   | Squad, fixture difficulty strip, strength radar      |
| Compare       | `/compare`      | Side-by-side charts for up to 5 players or teams     |

**Images:** Player photos and team badges are downloaded from the FPL CDN in the background the first time the server starts. Subsequent restarts skip files that already exist.

**Data freshness:** The webapp caches query results for up to 5 minutes. If you have just run the scraper and want to see fresh data immediately, restart the webapp.

For the full webapp documentation — folder structure, all pages explained, the JSON API, debugging — see **[webapp/README.md](webapp/README.md)**.

---

## 9. Running the tests

The test suite covers the rate limiter, HTTP retry logic, JSON parsing, database operations, and sync workflows. It runs entirely offline using sample JSON responses stored in `tests/fixtures/` — no network connection or FPL account needed.

**Run all tests:**

```bash
npm test
```

You should see output like:

```
 RUN  v4.1.0 /path/to/fpl-web-scrapper

 Test Files  X passed (X)
      Tests  Y passed (Y)
   Duration  ...
```

**Run a specific test file:**

```bash
npm test -- tests/test_scraper.ts
npm test -- tests/test_transform.ts
npm test -- tests/test_database.ts
npm test -- tests/test_sync.ts
```

**Run the other quality checks:**

```bash
npm run lint
npm run typecheck
npx prettier --check .
```

**What each test file covers:**

| File                | What it tests                                                                       |
| ------------------- | ----------------------------------------------------------------------------------- |
| `test_scraper.ts`   | Rate limiter timing, HTTP 200/404/403/429/5xx handling, retry logic, re-auth on 403 |
| `test_transform.ts` | Parsing of every API response type, edge cases like missing fields, malformed data  |
| `test_database.ts`  | Schema creation, all upsert operations, idempotency, query helpers                  |
| `test_sync.ts`      | Full sync and gameweek sync workflows, dry run mode, error tolerance, scrape log    |

---

## 10. Verifying your data

After a successful full sync, open the database to check the data looks right:

```bash
sqlite3 data/fpl.db
```

Then run some queries:

```sql
-- How many players were scraped?
SELECT count(*) FROM players;
-- Expect ~700

-- Top 10 players by total points this season
SELECT web_name, total_points, now_cost / 10.0 AS cost_m
FROM players
ORDER BY total_points DESC
LIMIT 10;

-- Which gameweek is current?
SELECT name, deadline_time, is_current, is_finished
FROM gameweeks
WHERE is_current = 1 OR is_next = 1;

-- Did the last scrape succeed?
SELECT mode, status, players_scraped, requests_made, started_at, finished_at
FROM scrape_log
ORDER BY started_at DESC
LIMIT 3;

-- One player's gameweek-by-gameweek history
SELECT gw.name, ph.total_points, ph.goals_scored, ph.assists, ph.minutes
FROM player_history ph
JOIN gameweeks gw ON gw.fpl_id = ph.gameweek_fpl_id
JOIN players p ON p.fpl_id = ph.player_fpl_id
WHERE p.web_name = 'Salah'
ORDER BY ph.gameweek_fpl_id;
```

Type `.quit` to exit the SQLite shell.

---

## 11. Setting up the cron job (OpenClaw)

OpenClaw calls this scraper automatically after each gameweek. Here is how to set that up.

### Prerequisites

Before the cron can run unattended:

- [ ] The `.env` file exists at the project root with valid FPL credentials
- [ ] Project dependencies are installed (`npm install`)
- [ ] The database has been initialised at least once with `--full-sync`
- [ ] The `data/` and `logs/` directories exist (created automatically on first run)

### The command OpenClaw should call

```bash
cd /absolute/path/to/fpl-web-scrapper && \
  npm run cli -- --current-gameweek \
  >> logs/cron.log 2>&1
```

Use absolute paths for the repository itself. Replace `/absolute/path/to/fpl-web-scrapper` with the actual location on your machine. If your cron environment has a minimal `PATH`, point it at your system `npm` binary explicitly.

### Recommended schedule

Premier League fixtures typically finish by 22:30 UK time. FPL finalises bonus points 1–2 hours after the last match. Running at 02:00 UTC gives a comfortable margin.

| Cron expression | When it runs                 | Covers                   |
| --------------- | ---------------------------- | ------------------------ |
| `0 2 * * 3`     | Every Wednesday at 02:00 UTC | Monday/Tuesday fixtures  |
| `0 2 * * 0`     | Every Sunday at 02:00 UTC    | Saturday/Sunday fixtures |

### Exit codes and what to do with them

| Code | OpenClaw should...                                                         |
| ---- | -------------------------------------------------------------------------- |
| `0`  | Log success, nothing else needed                                           |
| `1`  | Re-trigger the same command once; it will safely pick up where it left off |
| `2`  | Alert — check `logs/cron.log` and `data/fpl.db`'s `scrape_log` table       |

### Re-running a missed gameweek manually

```bash
# If you know which gameweek was missed:
npm run cli -- --gameweek 25

# Or just let it auto-detect:
npm run cli -- --current-gameweek
```

Both commands are safe to re-run at any time — they will not create duplicate data.

For the full OpenClaw integration reference, see [docs/OPENCLAW.md](docs/OPENCLAW.md).

---

## 12. Querying the database

The database at `data/fpl.db` is a standard SQLite file. It can be read by the `sqlite3` CLI, any SQLite client, or tools like [DB Browser for SQLite](https://sqlitebrowser.org).

### Database tables

| Table                 | What it contains                                                         |
| --------------------- | ------------------------------------------------------------------------ |
| `teams`               | All 20 Premier League clubs                                              |
| `gameweeks`           | All 38 gameweeks with deadlines, flags, and summary stats                |
| `players`             | All ~700 FPL players with current season aggregates, price, form, status |
| `player_history`      | Per-player, per-gameweek breakdown (the most detailed stats table)       |
| `player_history_past` | Season summary for each player across prior seasons                      |
| `fixtures`            | All matches with scores and difficulty ratings                           |
| `live_gameweek_stats` | Provisional points during/after a gameweek (before bonus finalisation)   |
| `scrape_log`          | Audit trail of every scraper run                                         |

> **Important:** Prices in the database are stored as integers in tenths of millions. Divide by 10.0 to get the display value (e.g. `130 / 10.0 = £13.0m`). Player positions are stored as integers: `1=GK, 2=DEF, 3=MID, 4=FWD`.

### Useful queries

```sql
-- Top value players (points per £1m spent)
SELECT
    web_name,
    total_points,
    now_cost / 10.0 AS cost_m,
    ROUND(CAST(total_points AS REAL) / (now_cost / 10.0), 2) AS pts_per_m
FROM players
WHERE status = 'a'
ORDER BY pts_per_m DESC
LIMIT 20;

-- Players with injury or suspension news
SELECT web_name, status, news, chance_of_playing_this_round
FROM players
WHERE status != 'a'
ORDER BY now_cost DESC;

-- Price changes in the current gameweek
SELECT web_name, now_cost / 10.0 AS cost_m, cost_change_event
FROM players
WHERE cost_change_event != 0
ORDER BY cost_change_event DESC;

-- Most transferred-in players this gameweek
SELECT web_name, transfers_in_event, transfers_out_event, now_cost / 10.0 AS cost_m
FROM players
ORDER BY transfers_in_event DESC
LIMIT 20;

-- Current gameweek's top scorers
SELECT p.web_name, ph.total_points, ph.goals_scored, ph.assists, ph.minutes
FROM player_history ph
JOIN players p ON p.fpl_id = ph.player_fpl_id
WHERE ph.gameweek_fpl_id = (SELECT fpl_id FROM gameweeks WHERE is_current = 1)
ORDER BY ph.total_points DESC
LIMIT 20;

-- A player's complete season history
SELECT gw.name, ph.total_points, ph.goals_scored, ph.assists,
       ph.minutes, ph.value / 10.0 AS cost_that_gw
FROM player_history ph
JOIN gameweeks gw ON gw.fpl_id = ph.gameweek_fpl_id
JOIN players p ON p.fpl_id = ph.player_fpl_id
WHERE p.web_name = 'Salah'
ORDER BY ph.gameweek_fpl_id;

-- Upcoming fixtures for a team with difficulty ratings
SELECT ht.name AS home, at.name AS away, f.kickoff_time,
       f.team_h_difficulty, f.team_a_difficulty
FROM fixtures f
JOIN teams ht ON ht.fpl_id = f.team_h_fpl_id
JOIN teams at ON at.fpl_id = f.team_a_fpl_id
WHERE f.finished = 0
ORDER BY f.kickoff_time
LIMIT 10;
```

For the complete schema with all column descriptions, see [docs/SCHEMA.md](docs/SCHEMA.md).

---

## 13. Troubleshooting

### "No such file or directory: data/fpl.db"

You haven't run the scraper yet. Run `--full-sync` first:

```bash
npm run cli -- --full-sync
```

### "No current gameweek in the database" when running `--current-gameweek`

The database exists but has no gameweek data. Run a full sync to populate it:

```bash
npm run cli -- --full-sync
```

### HTTP 403 errors / "Authentication failed"

- Verify that `FPL_LOGIN` and `FPL_PASSWORD` in `.env` are correct
- Delete the cached session and try again:
  ```bash
  rm -f data/.session.json
  npm run cli -- --current-gameweek
  ```
- Note: the main player stats endpoints are **public** — a persistent 403 usually means a temporary server-side block, not a credential problem. Wait 15 minutes and try again.

### HTTP 429 errors / "Rate limited"

FPL is throttling your requests. The scraper will automatically wait and retry. If it keeps happening:

- Increase the delays in `.env`:
  ```ini
  REQUEST_DELAY_MIN=4.0
  REQUEST_DELAY_MAX=6.0
  ```
- Wait 15–30 minutes before trying again (FPL blocks are temporary)

### Scrape stops partway through

The scraper is idempotent — just re-run the exact same command. It will skip any data it already has and only fetch what's missing. No data will be duplicated.

### "database is locked"

Another process has the database open with a write transaction. The scraper uses WAL mode, which normally allows concurrent reads while writing. If you see this error, ensure no other scripts are simultaneously running a full sync.

### Tests failing

Make sure you installed the project dependencies:

```bash
npm install
npm test
```

If a specific test is failing after you've modified code, run that test with verbose output:

```bash
npm test -- tests/test_transform.ts
```

### Checking logs

The scraper writes to both the terminal and `logs/fpl_scraper.log`. For historical runs, check the log file:

```bash
tail -100 logs/fpl_scraper.log
```

Or query the scrape log table in the database:

```sql
SELECT * FROM scrape_log ORDER BY started_at DESC LIMIT 10;
```

---

## 14. Keeping the scraper working when FPL changes

FPL occasionally updates its website and the underlying API — adding new fields, changing field names, or altering endpoint behaviour. Here is how to diagnose and fix problems when that happens.

### Step 1: Check what changed

Run the discovery command to probe the live API and print the current structure of each endpoint:

```bash
npm run cli -- --discover-api
```

Compare the output to [docs/API.md](docs/API.md). Look for:

- New top-level keys in the response
- Missing keys that were previously there
- Fields that have been renamed

You can also inspect the raw API response yourself. Open your browser's developer tools (F12), go to `https://fantasy.premierleague.com/statistics`, and look in the Network tab for requests to `https://fantasy.premierleague.com/api/bootstrap-static/`. The response body shows the exact current structure.

### Step 2: Identify what broke

Run the scraper with verbose logging and a dry run to see the exact error without touching the database:

```bash
npm run cli -- --current-gameweek --dry-run --log-level DEBUG
```

Common failure patterns:

| Error                                      | Likely cause                                 |
| ------------------------------------------ | -------------------------------------------- |
| `TypeError: Expected value for some_field` | FPL renamed or removed a field               |
| `TypeError` in transform                   | A field changed type (e.g. int → string)     |
| All players return 0 for a stat            | FPL added a new field name for the same stat |
| HTTP 404 on an endpoint                    | FPL changed the URL path                     |

### Step 3: Fix the issue

**If a field was renamed or removed:**

Open `src/models.ts` and find the `fromDict()` method for the affected model (for example `Player.fromDict()`). Update the field name to match the new API response. Use a fallback so the code still tolerates both shapes while you complete the cutover:

```ts
// Old
_float(d.expected_goals);

// If FPL renamed it to "xg":
_float(d.xg ?? d.expected_goals);
```

**If a new stat field was added and you want to capture it:**

1. Add the column to the relevant table in `src/database.ts` (in `_SCHEMA_SQL`)
2. Add the field to the relevant class in `src/models.ts`
3. Map the field in that class's `fromDict()` method
4. Add it to `toDbTuple()` (order must match the SQL column order)
5. Update the INSERT statement in `src/database.ts` to include the new column
6. Add a test case in `tests/test_transform.ts` and update `tests/fixtures/*.json` with the new field
7. Update [docs/API.md](docs/API.md) and [docs/SCHEMA.md](docs/SCHEMA.md)

**If an API endpoint URL changed:**

Open `src/api.ts` and update the path string in the relevant method. Endpoint paths are clearly labelled:

```ts
async getBootstrapStatic(): Promise<unknown> {
  return await this.#scraper.get("bootstrap-static"); // ← update this string
}
```

**If the login flow changed:**

Open `src/auth.ts`. The login POST parameters and the expected cookie names are near the top of the file:

```ts
const COOKIE_NAMES = new Set(["pl_profile", "sessionid"]);

const payload = new URLSearchParams({
  login: this.#login,
  password: this.#password,
  redirect_uri: "https://fantasy.premierleague.com/",
  app: "plfpl-web", // ← FPL may change this
});
```

Delete `data/.session.json` after any auth changes to force a fresh login.

### Step 4: Update the test fixtures

The tests use saved JSON responses in `tests/fixtures/`. If the API response shape changed, update these files to match the new structure, then re-run the tests:

```bash
npm test
```

### Step 5: Document the change

Update [docs/API.md](docs/API.md) with any endpoint changes so future maintainers understand what the API currently looks like.

---

## Further reading

- [webapp/README.md](webapp/README.md) — Dashboard webapp: full documentation, all pages, JSON API, debugging guide
- [docs/API.md](docs/API.md) — Complete FPL API endpoint reference
- [docs/SCHEMA.md](docs/SCHEMA.md) — All database tables and columns with descriptions
- [docs/SETUP.md](docs/SETUP.md) — Condensed setup guide
- [docs/OPENCLAW.md](docs/OPENCLAW.md) — Full OpenClaw cron integration guide with example SQL queries

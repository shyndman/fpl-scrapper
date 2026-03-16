# Setup Guide

## Prerequisites

- Node.js 24 or later
- npm
- A Fantasy Premier League account (free to create at fantasy.premierleague.com)
- ~50 MB disk space for the database

## Step 1: Install Dependencies

```bash
cd /path/to/fpl-web-scrapper
npm install
```

That installs the runtime, CLI entrypoint, dashboard server, Vitest, ESLint, and Prettier in one go.

## Step 2: Configure Credentials

```bash
cp config/.env.example .env
```

Edit `.env` and fill in your FPL account details:

```ini
FPL_LOGIN=your_email@example.com
FPL_PASSWORD=your_password
```

The `.env` file is git-ignored. Never commit it.

The main player stats endpoints are **public** (no login required). Credentials are used for:

- Accessing `my-team` endpoints if you want your personal squad data
- Refreshing sessions if FPL introduces auth on public endpoints

## Step 3: First Run

```bash
npm run cli -- --full-sync
```

This will:

1. Fetch all teams, gameweeks, and ~700 players from `bootstrap-static`
2. Fetch all fixtures
3. Fetch live stats for the current gameweek
4. Fetch per-gameweek history for every player (one request per player — this takes 30–40 minutes with rate limiting)
5. Write everything to `data/fpl.db`

To do a dry run first (no DB writes):

```bash
npm run cli -- --full-sync --dry-run
```

## Step 4: Verify the Database

```bash
sqlite3 data/fpl.db
```

```sql
-- How many players?
SELECT count(*) FROM players;

-- Top 10 scorers this season
SELECT web_name, total_points, now_cost
FROM players
ORDER BY total_points DESC
LIMIT 10;

-- Most recent gameweek
SELECT name, deadline_time, is_current FROM gameweeks WHERE is_finished = 1 ORDER BY fpl_id DESC LIMIT 3;

-- A player's gameweek-by-gameweek points
SELECT ph.round, ph.total_points, ph.goals_scored, ph.assists, ph.minutes
FROM player_history ph
JOIN players p ON p.fpl_id = ph.player_fpl_id
WHERE p.web_name = 'Salah'
ORDER BY ph.round;
```

## Step 5: Launch the Dashboard (optional)

The dashboard webapp lets you explore the database in a browser — player cards, charts, team comparisons, and more.

```bash
npm run web
```

Open **http://127.0.0.1:8292**. Press `Ctrl+C` to stop.

Player photos and team badges download from the FPL CDN in the background on first startup. Subsequent restarts skip files that already exist.

For the full webapp documentation — all pages, the JSON API, debugging — see [../webapp/README.md](../webapp/README.md).

## Step 6: Quality Checks (optional)

```bash
npm test
npm run lint
npm run typecheck
npx prettier --check .
```

## Step 7: Set Up the Cron Job (OpenClaw)

See [OPENCLAW.md](OPENCLAW.md) for the full integration guide.

Short version — after each gameweek:

```bash
cd /path/to/fpl-web-scrapper && npm run cli -- --current-gameweek
```

## Troubleshooting

### Auth errors (403)

- Check that `FPL_LOGIN` and `FPL_PASSWORD` in `.env` are correct
- FPL sometimes changes the login flow — delete `data/.session.json` to force a fresh login
- The main player stats do NOT require authentication; a 403 on bootstrap-static suggests a temporary server issue

### Rate limit errors (429)

- The default delays (2–3 s) are conservative; if you're still getting 429s, increase `REQUEST_DELAY_MIN` and `REQUEST_DELAY_MAX` in `.env`
- FPL may temporarily block IPs that make hundreds of requests quickly — wait 10–15 minutes before retrying

### Database locked

- If the scraper and OpenClaw are reading/writing simultaneously, WAL mode (enabled by default) handles this
- If you see `database is locked` errors, ensure no other SQLite connection has an open write transaction

### Partial sync / interrupted run

- The scraper is idempotent: just re-run the same command
- The `scrape_log` table records every run's status — check it to see where things failed:
  ```sql
  SELECT * FROM scrape_log ORDER BY started_at DESC LIMIT 5;
  ```

### Slow full sync

- The full sync makes ~700+ HTTP requests with 2–3 s delays: expect 30–40 minutes
- For subsequent runs, use `--current-gameweek` (5–15 minutes) instead

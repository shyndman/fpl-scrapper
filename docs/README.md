# FPL Web Scraper

Scrapes player statistics from the [Fantasy Premier League](https://fantasy.premierleague.com/statistics) API and stores them in a local SQLite database. Designed to run as a cron job via OpenClaw after each Premier League gameweek.

## Features

- Fetches all ~700 FPL player statistics via the undocumented public API
- Stores everything in a well-structured SQLite database with full gameweek-by-gameweek history
- Respects rate limits (2–3 s between requests, exponential back-off on errors)
- Idempotent — safe to re-run after partial failures
- Two sync modes: **full sync** (first run / season reset) and **gameweek sync** (weekly cron)

## Quick Start

```bash
# 1. Create a virtual environment
python3 -m venv .venv && source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure credentials
cp config/.env.example .env
# Edit .env and add your FPL login email + password

# 4. First-time full scrape (~700 players, 30-40 min)
python -m src.main --full-sync

# 5. Check results
sqlite3 data/fpl.db "SELECT web_name, total_points FROM players ORDER BY total_points DESC LIMIT 10;"
```

## Common Commands

| Command | Purpose |
|---|---|
| `python -m src.main --full-sync` | Full scrape — all players and history |
| `python -m src.main --current-gameweek` | Incremental update for the current GW |
| `python -m src.main --gameweek 25` | Re-run a specific gameweek |
| `python -m src.main --discover-api` | Probe API endpoints, print structure |
| `python -m src.main --full-sync --dry-run` | Fetch data, do NOT write to DB |
| `python -m src.main --gameweek 25 --log-level DEBUG` | Verbose logging |

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | All data synced successfully |
| `1` | Partial success — some players failed, re-run is safe |
| `2` | Fatal error — auth failure, DB unreachable, or network down |

## Project Structure

```
fpl-web-scrapper/
├── src/            # Python source (scraper, API client, DB, sync logic)
├── config/         # Settings and .env template
├── docs/           # Documentation
├── tests/          # Pytest test suite
├── data/           # Runtime: SQLite database (git-ignored)
└── logs/           # Runtime: log files (git-ignored)
```

## Further Reading

- [SETUP.md](SETUP.md) — Detailed installation and first-run guide
- [API.md](API.md) — FPL API endpoint documentation
- [SCHEMA.md](SCHEMA.md) — Database schema reference
- [OPENCLAW.md](OPENCLAW.md) — Cron job integration guide

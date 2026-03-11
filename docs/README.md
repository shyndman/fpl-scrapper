# FPL Web Scraper + Dashboard

Scrapes player statistics from the [Fantasy Premier League](https://fantasy.premierleague.com/statistics) API, stores them in a local SQLite database, and provides a local web dashboard to explore the data visually.

## Components

| Component | Location | Purpose |
|---|---|---|
| **Scraper** | `src/` | Fetches player/team data from the FPL API; writes to `data/fpl.db` |
| **Dashboard** | `webapp/` | Local web app that reads `data/fpl.db` and displays it in a browser |

## Scraper Quick Start

```bash
# 1. Create a virtual environment
python3 -m venv .venv && source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure credentials
cp config/.env.example .env
# Edit .env and add your FPL login email + password

# 4. First-time full scrape (~700 players, 30–40 min)
python -m src.main --full-sync

# 5. Check results
sqlite3 data/fpl.db "SELECT web_name, total_points FROM players ORDER BY total_points DESC LIMIT 10;"
```

## Dashboard Quick Start

```bash
# 1. Install webapp dependencies (in same venv)
pip install -r webapp/requirements.txt

# 2. Start the server
python -m webapp

# 3. Open http://127.0.0.1:8000 in your browser
```

## Scraper Commands

| Command | Purpose |
|---|---|
| `python -m src.main --full-sync` | Full scrape — all players and history |
| `python -m src.main --current-gameweek` | Incremental update for the current GW |
| `python -m src.main --gameweek 25` | Re-run a specific gameweek |
| `python -m src.main --discover-api` | Probe API endpoints, print structure |
| `python -m src.main --full-sync --dry-run` | Fetch data, do NOT write to DB |
| `python -m src.main --gameweek 25 --log-level DEBUG` | Verbose logging |

## Scraper Exit Codes

| Code | Meaning |
|---|---|
| `0` | All data synced successfully |
| `1` | Partial success — some players failed, re-run is safe |
| `2` | Fatal error — auth failure, DB unreachable, or network down |

## Project Structure

```
fpl-web-scrapper/
├── src/            # Scraper source (HTTP client, API wrappers, DB writes, sync logic)
├── webapp/         # Dashboard web app (FastAPI, Jinja2 templates, Chart.js)
├── config/         # Settings and .env template
├── docs/           # Reference documentation
├── tests/          # Pytest test suite (47 tests, runs offline)
├── data/           # Runtime: SQLite database (git-ignored)
└── logs/           # Runtime: log files (git-ignored)
```

## Further Reading

- [../webapp/README.md](../webapp/README.md) — Dashboard webapp: pages, JSON API, debugging guide
- [SETUP.md](SETUP.md) — Detailed installation and first-run guide
- [API.md](API.md) — FPL API endpoint documentation
- [SCHEMA.md](SCHEMA.md) — Database schema reference
- [OPENCLAW.md](OPENCLAW.md) — Cron job integration guide

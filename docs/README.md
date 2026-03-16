# FPL Web Scraper + Dashboard

Scrapes player statistics from the [Fantasy Premier League](https://fantasy.premierleague.com/statistics) API, stores them in a local SQLite database, and provides a local web dashboard to explore the data visually.

## Components

| Component     | Location  | Purpose                                                             |
| ------------- | --------- | ------------------------------------------------------------------- |
| **Scraper**   | `src/`    | Fetches player/team data from the FPL API; writes to `data/fpl.db`  |
| **Dashboard** | `webapp/` | Local web app that reads `data/fpl.db` and displays it in a browser |

## Scraper Quick Start

```bash
# 1. Install Node dependencies
npm install

# 2. Configure credentials
cp config/.env.example .env
# Edit .env and add your FPL login email + password

# 3. First-time full scrape (~700 players, 30–40 min)
npm run cli -- --full-sync

# 4. Check results
sqlite3 data/fpl.db "SELECT web_name, total_points FROM players ORDER BY total_points DESC LIMIT 10;"
```

## Dashboard Quick Start

```bash
# 1. Start the server from the project root
npm run web

# 2. Open http://127.0.0.1:8292 in your browser
```

## Scraper Commands

| Command                                                       | Purpose                               |
| ------------------------------------------------------------- | ------------------------------------- |
| `npm run cli -- --full-sync`                                  | Full scrape — all players and history |
| `npm run cli -- --current-gameweek`                           | Incremental update for the current GW |
| `npm run cli -- --gameweek 25`                                | Re-run a specific gameweek            |
| `npm run cli -- --discover-api`                               | Probe API endpoints, print structure  |
| `npm run cli -- --full-sync --dry-run`                        | Fetch data, do NOT write to DB        |
| `npm run cli -- --gameweek 25 --log-level DEBUG`              | Verbose logging                       |
| `npm test`                                                    | Run the Vitest suite                  |
| `npm run lint && npm run typecheck && npx prettier --check .` | Quality checks before a commit        |

## Scraper Exit Codes

| Code | Meaning                                                     |
| ---- | ----------------------------------------------------------- |
| `0`  | All data synced successfully                                |
| `1`  | Partial success — some players failed, re-run is safe       |
| `2`  | Fatal error — auth failure, DB unreachable, or network down |

## Project Structure

```
fpl-web-scrapper/
├── package.json      # npm scripts, runtime deps, dev tooling
├── src/              # Scraper source (TypeScript CLI, API wrappers, DB writes, sync logic)
├── webapp/           # Dashboard web app (Fastify, Nunjucks templates, static assets)
├── config/           # settings.ts and .env template
├── docs/             # Reference documentation
├── tests/            # Vitest suite with offline fixtures and webapp coverage
├── data/             # Runtime: SQLite database (git-ignored)
└── logs/             # Runtime: log files (git-ignored)
```

## Further Reading

- [../webapp/README.md](../webapp/README.md) — Dashboard webapp: pages, JSON API, debugging guide
- [SETUP.md](SETUP.md) — Detailed installation and first-run guide
- [API.md](API.md) — FPL API endpoint documentation
- [SCHEMA.md](SCHEMA.md) — Database schema reference
- [OPENCLAW.md](OPENCLAW.md) — Cron job integration guide

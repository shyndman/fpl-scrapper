# OpenClaw Integration Guide

This guide covers how to configure OpenClaw to automatically update the FPL database after each Premier League gameweek.

## Architecture

```
OpenClaw (cron scheduler)
    │
    │  triggers after gameweek results are confirmed
    ▼
python -m src.main --current-gameweek
    │
    ├── GET /api/bootstrap-static/  (player prices, form, ownership)
    ├── GET /api/fixtures/?event=N  (fixture results)
    ├── GET /api/event/N/live/      (provisional points)
    └── GET /api/element-summary/{id}/ × ~50-150 active players
    │
    ▼
data/fpl.db  (SQLite, WAL mode)
    │
    ▼
OpenClaw reads directly via SQLite
```

## Cron Schedule

Premier League fixtures typically finish by 22:30 UK time (22:30 BST / 21:30 GMT). FPL bonus points are confirmed ~1–2 hours after the final whistle.

**Recommended schedule:**

| Day | Time (UTC) | Purpose |
|---|---|---|
| Wednesday 02:00 | `0 2 * * 3` | Covers Monday/Tuesday evening fixtures |
| Sunday 02:00 | `0 2 * * 0` | Covers Saturday/Sunday fixtures |

These times are conservative — the data should be fully confirmed several hours before.

## OpenClaw Cron Configuration

In OpenClaw, create a scheduled task with:

**Command:**
```bash
cd /path/to/fpl-web-scrapper && \
  /path/to/.venv/bin/python -m src.main --current-gameweek \
  >> logs/cron.log 2>&1
```

**Exit code handling:**
- `0` — Success. All data updated.
- `1` — Partial. Some players failed to scrape. Re-trigger the same command; it is safe to re-run.
- `2` — Fatal. Auth failed, DB unreachable, or network error. Alert and investigate.

## Environment Requirements

Before the cron runs, ensure:

- [ ] `.env` exists at the project root with `FPL_LOGIN` and `FPL_PASSWORD`
- [ ] `data/` directory exists and is writable (created automatically on first run)
- [ ] `logs/` directory exists (created automatically on first run)
- [ ] Python virtual environment is installed: `pip install -r requirements.txt`
- [ ] The database has been initialised with `--full-sync` at least once

## Idempotency Guarantee

The `--current-gameweek` command is **fully idempotent**. All DB writes use `INSERT OR REPLACE` on `UNIQUE` constraints. Re-running after a partial failure:
- Will not create duplicate rows
- Will refresh any data that was missed
- Will update player prices, ownership, and form from the latest bootstrap

Safe to schedule and run multiple times per week.

## Reading the Database from OpenClaw

The SQLite file at `data/fpl.db` can be queried directly from OpenClaw using any SQLite client or the Python `sqlite3` module.

### Key Queries

```sql
-- ── Current gameweek player points ──────────────────────────────────────
SELECT
    p.web_name,
    p.element_type,        -- 1=GK 2=DEF 3=MID 4=FWD
    ph.total_points,
    ph.minutes,
    ph.goals_scored,
    ph.assists,
    ph.bonus,
    ph.value / 10.0 AS cost_m
FROM player_history ph
JOIN players p ON p.fpl_id = ph.player_fpl_id
WHERE ph.gameweek_fpl_id = (
    SELECT fpl_id FROM gameweeks WHERE is_current = 1 LIMIT 1
)
ORDER BY ph.total_points DESC;

-- ── Top value players (points per million) ──────────────────────────────
SELECT
    web_name,
    total_points,
    now_cost / 10.0 AS cost_m,
    ROUND(CAST(total_points AS REAL) / (now_cost / 10.0), 2) AS pts_per_m
FROM players
WHERE status = 'a'
ORDER BY pts_per_m DESC
LIMIT 20;

-- ── Players with injury news ─────────────────────────────────────────────
SELECT
    web_name,
    status,
    news,
    chance_of_playing_this_round AS chance_this,
    chance_of_playing_next_round AS chance_next,
    now_cost / 10.0 AS cost_m
FROM players
WHERE status != 'a'
ORDER BY now_cost DESC;

-- ── Price changes this gameweek ──────────────────────────────────────────
SELECT web_name, now_cost / 10.0 AS cost_m, cost_change_event
FROM players
WHERE cost_change_event != 0
ORDER BY cost_change_event DESC;

-- ── Fixtures for next gameweek ───────────────────────────────────────────
SELECT
    ht.name AS home_team,
    at.name AS away_team,
    f.kickoff_time,
    f.team_h_difficulty,
    f.team_a_difficulty
FROM fixtures f
JOIN teams ht ON ht.fpl_id = f.team_h_fpl_id
JOIN teams at ON at.fpl_id = f.team_a_fpl_id
WHERE f.gameweek_fpl_id = (
    SELECT fpl_id FROM gameweeks WHERE is_next = 1 LIMIT 1
)
ORDER BY f.kickoff_time;

-- ── Last scrape status ───────────────────────────────────────────────────
SELECT
    mode,
    status,
    players_scraped,
    requests_made,
    errors_encountered,
    started_at,
    finished_at,
    error_detail
FROM scrape_log
ORDER BY started_at DESC
LIMIT 5;

-- ── Has today's gameweek been scraped? ───────────────────────────────────
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM scrape_log
            WHERE mode = 'gameweek_sync'
              AND status IN ('success', 'partial')
              AND gameweek_fpl_id = (SELECT fpl_id FROM gameweeks WHERE is_current = 1)
              AND finished_at > date('now', '-1 day')
        ) THEN 'yes' ELSE 'no'
    END AS scraped_today;
```

## Database Path Configuration

By default the database is at `data/fpl.db` relative to the project root.

To use a custom path (e.g. a shared volume):
1. Set `DB_PATH=/shared/fpl.db` in `.env`
2. Or pass `--db-path /shared/fpl.db` to the CLI

OpenClaw should read from the same path configured in `.env`.

## Alerting Recommendations

Configure OpenClaw to alert when:

1. The scraper exits with code `2` (fatal error)
2. No `success` or `partial` record in `scrape_log` within 7 days
3. `players_scraped = 0` on a `gameweek_sync` run (suggests auth failure)

Example alert query:
```sql
SELECT count(*) AS recent_successes
FROM scrape_log
WHERE status IN ('success', 'partial')
  AND finished_at > datetime('now', '-7 days');
-- Alert if result = 0
```

## Manual Re-sync

If OpenClaw missed a gameweek or the scrape failed:

```bash
# Re-sync a specific gameweek
python -m src.main --gameweek 25

# Or force a full refresh
python -m src.main --full-sync
```

Both commands are idempotent and safe to run at any time.

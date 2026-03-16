# Database Schema

SQLite database at `data/fpl.db`. WAL mode is enabled so OpenClaw and the scraper can access the file simultaneously without locking conflicts.

## Entity Relationships

```
teams ─────────────────┐
                        │ (team_fpl_id)
gameweeks ─────────┐   │
                    │   ▼
                    │  players ────────────────────────────┐
                    │                                       │ (player_fpl_id)
                    │   ┌───────────────────────────────────┤
                    │   │   player_history                   │
                    │   │   UNIQUE(player_fpl_id, gw_fpl_id)│
                    │   └────────────────────────────────────┤
                    │                                        │
                    │       player_history_past              │
                    │       UNIQUE(player_fpl_id, season)    │
                    │                                        │
                    │       live_gameweek_stats              │
                    │       UNIQUE(player_fpl_id, gw_fpl_id)│
                    │                                        │
                    └──── (gameweek_fpl_id) ────────────────┘

fixtures (team_h_fpl_id, team_a_fpl_id → teams.fpl_id)
scrape_log (audit trail, no FK dependencies)
```

---

## Tables

### `teams`

One row per Premier League club. Updated on every bootstrap-static fetch.

| Column                  | Type           | Description                  |
| ----------------------- | -------------- | ---------------------------- |
| `id`                    | INTEGER PK     | Auto-increment surrogate key |
| `fpl_id`                | INTEGER UNIQUE | FPL's team ID                |
| `name`                  | TEXT           | Full name e.g. "Arsenal"     |
| `short_name`            | TEXT           | 3-letter code e.g. "ARS"     |
| `strength`              | INTEGER        | Overall strength rating      |
| `strength_overall_home` | INTEGER        | FPL internal home strength   |
| `strength_overall_away` | INTEGER        | FPL internal away strength   |
| `strength_attack_home`  | INTEGER        |                              |
| `strength_attack_away`  | INTEGER        |                              |
| `strength_defence_home` | INTEGER        |                              |
| `strength_defence_away` | INTEGER        |                              |
| `pulse_id`              | INTEGER        | FPL's secondary ID           |
| `scraped_at`            | TEXT           | ISO-8601 UTC timestamp       |

**Source:** `GET /api/bootstrap-static/` → `.teams[]`

---

### `gameweeks`

One row per gameweek (1–38). Updated on every bootstrap-static fetch.

| Column                | Type           | Description                       |
| --------------------- | -------------- | --------------------------------- |
| `fpl_id`              | INTEGER UNIQUE | Gameweek number (1–38)            |
| `name`                | TEXT           | "Gameweek 1"                      |
| `deadline_time`       | TEXT           | ISO-8601 transfer deadline        |
| `average_entry_score` | INTEGER        | Average manager score             |
| `highest_score`       | INTEGER        | Top individual score              |
| `is_current`          | INTEGER        | 1 if this is the active GW        |
| `is_next`             | INTEGER        | 1 if this is the upcoming GW      |
| `is_finished`         | INTEGER        | 1 if GW is complete               |
| `chip_plays`          | TEXT           | JSON: `[{chip_name, num_played}]` |
| `most_selected`       | INTEGER        | Most-owned player's fpl_id        |
| `most_captained`      | INTEGER        | Most-captained player's fpl_id    |
| `transfers_made`      | INTEGER        | Total transfers this GW           |
| `scraped_at`          | TEXT           | ISO-8601 UTC                      |

**Source:** `GET /api/bootstrap-static/` → `.events[]`

---

### `players`

One row per FPL player (~700). Updated on every bootstrap-static fetch.
Contains **season aggregate** stats plus current price, form, and news.

| Column                                           | Type           | Description                      |
| ------------------------------------------------ | -------------- | -------------------------------- |
| `fpl_id`                                         | INTEGER UNIQUE | FPL element ID                   |
| `first_name`, `second_name`                      | TEXT           |                                  |
| `web_name`                                       | TEXT           | Display name e.g. "Salah"        |
| `team_fpl_id`                                    | INTEGER        | FK → teams.fpl_id                |
| `element_type`                                   | INTEGER        | 1=GK, 2=DEF, 3=MID, 4=FWD        |
| `status`                                         | TEXT           | `a`/`d`/`i`/`s`/`u`              |
| `now_cost`                                       | INTEGER        | Cost in tenths (130 = £13.0m)    |
| `cost_change_start`                              | INTEGER        | Price change since season start  |
| `cost_change_event`                              | INTEGER        | Price change in current GW       |
| `chance_of_playing_this_round`                   | INTEGER        | 0–100 percentage                 |
| `chance_of_playing_next_round`                   | INTEGER        | 0–100 percentage                 |
| `total_points`                                   | INTEGER        | Season total                     |
| `event_points`                                   | INTEGER        | Points in current GW             |
| `points_per_game`                                | TEXT           | Rolling average e.g. "7.4"       |
| `form`                                           | TEXT           | 5-GW rolling form                |
| `selected_by_percent`                            | TEXT           | Ownership e.g. "45.2"            |
| `transfers_in` / `transfers_out`                 | INTEGER        | Season transfer totals           |
| `transfers_in_event` / `transfers_out_event`     | INTEGER        | This-GW transfers                |
| `minutes`                                        | INTEGER        | Season minutes played            |
| `goals_scored`, `assists`                        | INTEGER        | Season totals                    |
| `clean_sheets`, `goals_conceded`                 | INTEGER        |                                  |
| `yellow_cards`, `red_cards`                      | INTEGER        |                                  |
| `saves`                                          | INTEGER        | GK saves                         |
| `bonus`, `bps`                                   | INTEGER        | Bonus points / BPS score         |
| `influence`, `creativity`, `threat`, `ict_index` | TEXT           | ICT metrics as strings           |
| `starts`                                         | INTEGER        | Games started                    |
| `expected_goals`, `expected_assists`             | TEXT           | xG/xA as decimal strings         |
| `expected_goal_involvements`                     | TEXT           | xG + xA                          |
| `expected_goals_conceded`                        | TEXT           | xGC (useful for defenders/GKs)   |
| `news`                                           | TEXT           | Injury/suspension news text      |
| `news_added`                                     | TEXT           | ISO-8601 when news was published |
| `scraped_at`                                     | TEXT           | ISO-8601 UTC                     |

**Source:** `GET /api/bootstrap-static/` → `.elements[]`

---

### `player_history`

One row per player per completed gameweek. The main source of per-match statistics.

| Column                                           | Type    | Description                  |
| ------------------------------------------------ | ------- | ---------------------------- |
| `player_fpl_id`                                  | INTEGER | FK → players.fpl_id          |
| `gameweek_fpl_id`                                | INTEGER | FK → gameweeks.fpl_id        |
| `opponent_team`                                  | INTEGER | FK → teams.fpl_id            |
| `was_home`                                       | INTEGER | 1 if home fixture            |
| `kickoff_time`                                   | TEXT    | ISO-8601                     |
| `total_points`                                   | INTEGER | Points earned this GW        |
| `minutes`                                        | INTEGER | Minutes played               |
| `goals_scored`, `assists`                        | INTEGER |                              |
| `clean_sheets`, `goals_conceded`                 | INTEGER |                              |
| `bonus`, `bps`                                   | INTEGER |                              |
| `influence`, `creativity`, `threat`, `ict_index` | TEXT    |                              |
| `expected_goals`, `expected_assists`             | TEXT    |                              |
| `value`                                          | INTEGER | Player cost that GW (tenths) |
| `transfers_balance`                              | INTEGER | Net transfers (in – out)     |
| `selected`                                       | INTEGER | Ownership count that GW      |
| `scraped_at`                                     | TEXT    | ISO-8601 UTC                 |

**Unique constraint:** `(player_fpl_id, gameweek_fpl_id)` — prevents duplicates and enables idempotent upserts.

**Source:** `GET /api/element-summary/{id}/` → `.history[]`

---

### `player_history_past`

One row per player per prior season. Useful for multi-season analysis.

| Column                      | Type    | Description                               |
| --------------------------- | ------- | ----------------------------------------- |
| `player_fpl_id`             | INTEGER | FK → players.fpl_id                       |
| `season_name`               | TEXT    | e.g. "2023/24"                            |
| `start_cost`, `end_cost`    | INTEGER | Cost at start/end of that season (tenths) |
| `total_points`              | INTEGER | Season total                              |
| (all standard stat columns) |         | Same as player_history                    |

**Unique constraint:** `(player_fpl_id, season_name)`

**Source:** `GET /api/element-summary/{id}/` → `.history_past[]`

---

### `fixtures`

One row per fixture. Updated on every scrape.

| Column                                   | Type           | Description                              |
| ---------------------------------------- | -------------- | ---------------------------------------- |
| `fpl_id`                                 | INTEGER UNIQUE | FPL fixture ID                           |
| `gameweek_fpl_id`                        | INTEGER        | FK → gameweeks.fpl_id (NULL if TBC)      |
| `kickoff_time`                           | TEXT           | ISO-8601 or NULL                         |
| `team_h_fpl_id`, `team_a_fpl_id`         | INTEGER        | FK → teams.fpl_id                        |
| `team_h_score`, `team_a_score`           | INTEGER        | NULL until played                        |
| `finished`                               | INTEGER        | 1 if complete                            |
| `team_h_difficulty`, `team_a_difficulty` | INTEGER        | FPL difficulty 1–5                       |
| `stats`                                  | TEXT           | JSON blob: goal scorers, assisters, etc. |

**Source:** `GET /api/fixtures/`

---

### `live_gameweek_stats`

Provisional stats captured from the live endpoint. May differ from `player_history` (bonus points are adjusted post-match). Useful for real-time displays.

| Column                      | Type    | Description                         |
| --------------------------- | ------- | ----------------------------------- |
| `player_fpl_id`             | INTEGER |                                     |
| `gameweek_fpl_id`           | INTEGER |                                     |
| `total_points`              | INTEGER | Provisional points                  |
| `in_dreamteam`              | INTEGER | 1 if in the GW dream team           |
| `explain`                   | TEXT    | JSON blob: point-by-point breakdown |
| (all standard stat columns) |         |                                     |

**Unique constraint:** `(player_fpl_id, gameweek_fpl_id)`

**Source:** `GET /api/event/{gw}/live/`

---

### `scrape_log`

Audit trail of every scraper invocation. OpenClaw can query this to show "last updated" timestamps and detect failed runs.

| Column               | Type    | Description                                 |
| -------------------- | ------- | ------------------------------------------- |
| `run_id`             | TEXT    | UUID per CLI invocation                     |
| `mode`               | TEXT    | `full_sync` or `gameweek_sync`              |
| `gameweek_fpl_id`    | INTEGER | NULL for full_sync                          |
| `started_at`         | TEXT    | ISO-8601 UTC                                |
| `finished_at`        | TEXT    | ISO-8601 UTC or NULL                        |
| `status`             | TEXT    | `running` / `success` / `partial` / `error` |
| `players_scraped`    | INTEGER |                                             |
| `requests_made`      | INTEGER | Total HTTP requests                         |
| `errors_encountered` | INTEGER | Non-fatal errors                            |
| `error_detail`       | TEXT    | Last error message                          |

---

## Useful Queries

```sql
-- Top 10 season scorers
SELECT web_name, total_points, now_cost / 10.0 AS cost_m
FROM players
ORDER BY total_points DESC
LIMIT 10;

-- Current GW player points
SELECT p.web_name, ph.total_points, ph.goals_scored, ph.assists, ph.minutes
FROM player_history ph
JOIN players p ON p.fpl_id = ph.player_fpl_id
WHERE ph.gameweek_fpl_id = (SELECT fpl_id FROM gameweeks WHERE is_current = 1)
ORDER BY ph.total_points DESC;

-- Players with injury news
SELECT web_name, status, news, chance_of_playing_this_round
FROM players
WHERE status != 'a'
ORDER BY now_cost DESC;

-- Price rises this gameweek
SELECT web_name, now_cost / 10.0 AS cost_m, cost_change_event
FROM players
WHERE cost_change_event > 0
ORDER BY cost_change_event DESC, now_cost DESC;

-- A player's full season history
SELECT gw.name, ph.total_points, ph.goals_scored, ph.assists, ph.minutes,
       ph.value / 10.0 AS cost_m
FROM player_history ph
JOIN gameweeks gw ON gw.fpl_id = ph.gameweek_fpl_id
JOIN players p ON p.fpl_id = ph.player_fpl_id
WHERE p.web_name = 'Salah'
ORDER BY ph.gameweek_fpl_id;

-- Last scrape status
SELECT mode, status, players_scraped, requests_made, started_at, finished_at
FROM scrape_log
ORDER BY started_at DESC
LIMIT 5;
```

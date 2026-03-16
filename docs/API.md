# FPL API Documentation

The Fantasy Premier League API is undocumented and unofficial. This document captures what has been discovered through community research and reverse-engineering the FPL web app.

**Base URL:** `https://fantasy.premierleague.com/api`

All endpoints require a trailing slash (`/`). Without it, the API returns unexpected results.

---

## Authentication

Most player statistics endpoints are **public** and require no authentication.

Manager-specific endpoints (team picks, transfer history) require a logged-in FPL session.

### Login

```
POST https://users.premierleague.com/accounts/login/
Content-Type: application/x-www-form-urlencoded

login=your@email.com
password=yourpassword
redirect_uri=https://fantasy.premierleague.com/
app=plfpl-web
```

**Response:** Sets two cookies:

- `pl_profile` — scoped to `.premierleague.com`
- `sessionid` — scoped to `fantasy.premierleague.com`

These cookies must be included in subsequent requests to authenticated endpoints. The session is stored locally at `data/.session.json` and considered valid for 20 hours.

---

## Public Endpoints

### GET /api/bootstrap-static/

Returns the master data snapshot. This is the primary endpoint — it contains all players, teams, and gameweek metadata.

**Response keys:**

| Key             | Type    | Description                                    |
| --------------- | ------- | ---------------------------------------------- |
| `events`        | array   | All 38 gameweeks with scores, deadlines, flags |
| `teams`         | array   | All 20 Premier League clubs                    |
| `elements`      | array   | All ~700 FPL players with season stats         |
| `element_types` | array   | Position definitions (GK, DEF, MID, FWD)       |
| `element_stats` | array   | Stat metadata (label, abbreviation)            |
| `game_settings` | object  | FPL game rules and limits                      |
| `phases`        | array   | Season phases (e.g. "Overall", "Month 1")      |
| `total_players` | integer | Total FPL managers registered                  |

**Player (`elements`) fields of note:**

| Field                                            | Type   | Notes                                                                 |
| ------------------------------------------------ | ------ | --------------------------------------------------------------------- |
| `id`                                             | int    | FPL player ID                                                         |
| `first_name`, `second_name`, `web_name`          | string | Name fields                                                           |
| `team`                                           | int    | Team ID (FK to `teams[].id`)                                          |
| `element_type`                                   | int    | 1=GK, 2=DEF, 3=MID, 4=FWD                                             |
| `status`                                         | string | `a`=available, `d`=doubt, `i`=injured, `s`=suspended, `u`=unavailable |
| `now_cost`                                       | int    | Cost in tenths of millions (130 = £13.0m)                             |
| `total_points`                                   | int    | Season total                                                          |
| `form`                                           | string | Rolling 5-GW form average                                             |
| `selected_by_percent`                            | string | Ownership percentage                                                  |
| `influence`, `creativity`, `threat`, `ict_index` | string | ICT metrics                                                           |
| `expected_goals`, `expected_assists`             | string | xG / xA as strings                                                    |

---

### GET /api/element-summary/{player_id}/

Detailed history for a single player.

**Response keys:**

| Key            | Type  | Description                               |
| -------------- | ----- | ----------------------------------------- |
| `history`      | array | Per-gameweek stats for the current season |
| `history_past` | array | Season summary for each prior season      |
| `fixtures`     | array | Upcoming fixtures with difficulty ratings |

**`history[]` fields:** `round`, `total_points`, `minutes`, `goals_scored`, `assists`, `clean_sheets`, `goals_conceded`, `bonus`, `bps`, `influence`, `creativity`, `threat`, `ict_index`, `expected_goals`, `expected_assists`, `value` (cost that GW), `selected` (ownership count), `transfers_in`, `transfers_out`, `was_home`, `kickoff_time`, `opponent_team`

**`history_past[]` fields:** `season_name`, `total_points`, `minutes`, `goals_scored`, `assists`, `clean_sheets`, `start_cost`, `end_cost`, plus all standard stat fields.

---

### GET /api/event/{gameweek}/live/

Live (in-progress or just-finished) stats for all players in a gameweek.

**Response:**

```json
{
  "elements": [
    {
      "id": 318,
      "stats": {
        "minutes": 90,
        "goals_scored": 1,
        "assists": 1,
        "total_points": 12,
        "in_dreamteam": true,
        "bonus": 3,
        "bps": 42,
        ...
      },
      "explain": [
        {
          "fixture": 290,
          "stats": [
            {"identifier": "minutes", "points": 2, "value": 90},
            {"identifier": "goals_scored", "points": 5, "value": 1}
          ]
        }
      ]
    }
  ]
}
```

The `explain` array breaks down how each player's points were earned per fixture.

---

### GET /api/fixtures/

Returns all fixtures for the season.

**Query parameters:**

- `?event=N` — filter to gameweek N only
- `?future=1` — upcoming fixtures only

**Response:** Array of fixture objects with fields: `id`, `event` (GW), `team_h`, `team_a`, `team_h_score`, `team_a_score`, `kickoff_time`, `finished`, `started`, `minutes`, `team_h_difficulty`, `team_a_difficulty`, `stats` (goal scorers, assisters, etc.)

---

## Authenticated Endpoints

These require valid session cookies from the login flow.

### GET /api/my-team/{entry_id}/

Returns the logged-in user's current team.

### GET /api/entry/{entry_id}/

Returns a manager's overview: name, team name, overall rank, total points, leagues.

### GET /api/entry/{entry_id}/event/{gameweek}/picks/

Returns a manager's 15-player squad for a specific gameweek, including captain and chip selection.

### GET /api/entry/{entry_id}/transfers/

Full transfer history for a manager.

---

## Rate Limiting

The FPL API does not publish its rate limits. Based on community experience:

- **Safe zone:** 1 request every 2–3 seconds
- **Risky zone:** More than 1 request per second
- **Ban trigger:** Sustained rapid-fire requests (hundreds per minute) can result in a temporary IP block lasting several hours

The scraper enforces a random 2–3 second delay between every request. On HTTP 429 responses, it respects the `Retry-After` header (default 60 s). On 5xx errors, it uses exponential back-off (up to 120 s).

---

## Discovering New Endpoints

Run the built-in discovery command to probe all known endpoints and inspect their structure:

```bash
npm run cli -- --discover-api
```

This outputs JSON describing the top-level keys and types from each endpoint without writing to the database.

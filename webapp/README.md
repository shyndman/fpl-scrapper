# FPL Dashboard — Web UI

A local web dashboard for exploring the Fantasy Premier League statistics database collected by the FPL scraper. It reads the same `data/fpl.db` SQLite file that the scraper writes to, and presents the data as a set of interactive pages with charts, filters, and player/team comparisons.

> **Prerequisite:** The scraper must have been run at least once before the webapp has any data to show. See the [main README](../README.md) for setup instructions.

---

## Table of Contents

1. [What the webapp does](#1-what-the-webapp-does)
2. [How it works — architecture overview](#2-how-it-works--architecture-overview)
3. [Folder structure explained](#3-folder-structure-explained)
4. [Installation](#4-installation)
5. [Running the webapp](#5-running-the-webapp)
6. [Pages and features](#6-pages-and-features)
7. [The JSON API](#7-the-json-api)
8. [How data flows from the database to the browser](#8-how-data-flows-from-the-database-to-the-browser)
9. [Debugging and troubleshooting](#9-debugging-and-troubleshooting)
10. [Customising the webapp](#10-customising-the-webapp)

---

## 1. What the webapp does

The webapp gives you a visual, browser-based interface to the `data/fpl.db` database. It is entirely read-only — it never modifies the database. Everything the scraper collects becomes visible here immediately after you refresh the relevant page.

**Six pages:**

| Page | URL | What you can do |
|---|---|---|
| Dashboard | `/` | See the current gameweek's top performers, summary stats, all 20 teams at a glance, and the last scrape status |
| Players | `/players` | Browse all ~700+ players in a card grid; filter by position, team, status (available/injured/doubt), and price range; sort by any stat |
| Player detail | `/players/{id}` | Full profile for one player — photo, season stats, gameweek-by-gameweek points chart, ICT radar, price history, past-season table |
| Teams | `/teams` | All 20 clubs with badges, win/draw/loss record, and strength ratings |
| Team detail | `/teams/{id}` | Full squad sorted by position, strength radar chart, next 8 fixtures with difficulty colour coding |
| Compare | `/compare` | Type-ahead search for up to 5 players or teams, pick any combination of stats, view as line chart (per GW), bar chart (season total), or radar chart |

Player photos and team badges are downloaded from the FPL image CDN the first time the server starts, and served locally. Subsequent startups skip files that already exist.

---

## 2. How it works — architecture overview

```
Browser  ←──HTML/CSS/JS──  FastAPI (Jinja2 templates)  ←──SQL──  SQLite (data/fpl.db)
   │                                │
   └──JSON fetch (Alpine.js)──  /api/* routes  ←──SQL──  SQLite
```

**Server side (Python):**

- **FastAPI** is the web framework. It handles routing and renders HTML using Jinja2 templates.
- **Uvicorn** is the ASGI server that runs FastAPI. It listens on `127.0.0.1:8000`.
- **`webapp/db.py`** opens a thread-local, read-only SQLite connection and runs all the SQL queries. Results are returned as plain Python dicts. A simple time-based cache (`@ttl_cache`) avoids re-running expensive queries on every page load.
- **`webapp/images.py`** downloads player photos and team badges from the FPL CDN into `webapp/static/images/` at startup. It runs as a background task so it does not delay the server from accepting connections.
- **`webapp/routers/pages.py`** contains the HTML-rendering routes — one function per page.
- **`webapp/routers/api.py`** contains the JSON routes used by the compare page's charts and search typeahead.

**Client side (browser):**

- **Tailwind CSS** (loaded from a CDN) provides all styling — no build step required.
- **Alpine.js** (loaded from a CDN) provides lightweight client-side reactivity: the filter bar state on the players page, and the entire compare page's interactivity (typeahead, metric selection, chart type toggling).
- **Chart.js** (loaded from a CDN) renders all charts. `webapp/static/js/charts.js` contains helper factory functions (`createLineChart`, `createBarChart`, `createRadarChart`, `createDoughnutChart`) that configure the dark theme consistently.

The design follows a dark-navy aesthetic matching FPL's own app, using `#0a0e1a` background and `#00ff87` (FPL green) as the primary accent colour.

---

## 3. Folder structure explained

```
webapp/
│
├── README.md               ← You are here
├── requirements.txt        ← Python dependencies for the webapp only
│
├── __init__.py             ← Makes 'webapp' a Python package
├── __main__.py             ← Entry point: python -m webapp
├── app.py                  ← FastAPI app factory, lifespan, Jinja2 filters
├── db.py                   ← Database queries, thread-local connections, TTL cache
├── images.py               ← Downloads and serves player photos + team badges
│
├── routers/
│   ├── __init__.py
│   ├── pages.py            ← HTML page routes (one function per page)
│   └── api.py              ← JSON API routes (used by charts and typeahead)
│
├── templates/              ← Jinja2 HTML templates
│   ├── base.html           ← Shared layout: nav, CDN scripts, footer
│   ├── dashboard.html      ← Home page
│   ├── players.html        ← Player grid with filters
│   ├── player_detail.html  ← Individual player page with charts
│   ├── teams.html          ← Team grid
│   ├── team_detail.html    ← Individual team page with squad and fixtures
│   └── compare.html        ← Interactive comparison page (Alpine.js-driven)
│
└── static/
    ├── css/
    │   └── app.css         ← Custom properties (colours), card styles, utility classes
    ├── js/
    │   └── charts.js       ← Chart.js factory functions with shared dark-mode styling
    └── images/
        ├── players/        ← Downloaded at startup: p{code}.png
        ├── badges/         ← Downloaded at startup: t{team_fpl_id}.png
        ├── placeholder_player.png
        └── placeholder_badge.png
```

**The files you are most likely to edit:**

| File | Why you'd edit it |
|---|---|
| `webapp/db.py` | Add a new SQL query or change what data a page receives |
| `webapp/templates/*.html` | Change the layout, add a new section, or tweak the design |
| `webapp/static/css/app.css` | Change colours, spacing, or card styles |
| `webapp/static/js/charts.js` | Change how charts look or add a new chart type |
| `webapp/routers/pages.py` | Add a new page route |
| `webapp/routers/api.py` | Add a new JSON endpoint |

---

## 4. Installation

The webapp has its own set of Python dependencies that are separate from the scraper. Install them into the same virtual environment.

**Step 1: Activate your virtual environment** (if it is not already active)

```bash
cd /path/to/fpl-web-scrapper
source .venv/bin/activate      # macOS / Linux
# .venv\Scripts\activate       # Windows
```

**Step 2: Install webapp dependencies**

```bash
pip install -r webapp/requirements.txt
```

This installs:
- `fastapi` — the web framework
- `uvicorn[standard]` — the ASGI server
- `jinja2` — the HTML templating engine
- `aiofiles` — async file serving for static assets
- `requests` and `python-dotenv` — shared with the scraper, already installed

**That's it.** No build step, no npm, no webpack. All CSS and JavaScript libraries load from CDNs.

---

## 5. Running the webapp

From the project root (the `fpl-web-scrapper/` directory, not inside `webapp/`):

```bash
python -m webapp
```

You should see:

```
18:00:01  INFO      webapp.app  Configuring database: /path/to/fpl-web-scrapper/data/fpl.db
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
18:00:01  INFO      webapp.images  Player photos: 0 downloaded, 820 skipped, 0 failed
18:00:02  INFO      webapp.images  Team badges: 0 downloaded, 20 skipped, 0 failed
```

Then open **http://127.0.0.1:8000** in your browser.

**First startup:** The image download will log progress in the background. The webapp is fully functional while images are downloading — pages with missing photos show a placeholder automatically.

**Stopping the server:** Press `Ctrl+C` in the terminal.

### Using a different database file

By default the webapp looks for the database at `data/fpl.db` relative to the project root. To point it at a different file:

```bash
FPL_DB_PATH=/absolute/path/to/other.db python -m webapp
```

### Changing the port

Edit `webapp/__main__.py` and change `port=8000` to any free port:

```python
uvicorn.run("webapp.__main__:app", host="127.0.0.1", port=9000, ...)
```

---

## 6. Pages and features

### Dashboard (`/`)

Loaded on startup. Shows:
- **GW summary strip** — average score, highest score, total transfers made, and current GW status (Live / Finished / Upcoming). Data comes from the `gameweeks` table.
- **Top performers table** — the 10 highest-scoring players in the current gameweek, with their photos, team badges, and stats. Sourced from `player_history` joined to `players`.
- **Teams grid** — all 20 clubs with their badges and overall strength rating. Click any card to go to that team's detail page.
- **Last scrape status** — the most recent row from the `scrape_log` table, showing when data was last updated and whether it succeeded.

### Players (`/players`)

Shows all players in a paginated card grid (40 per page). You can:
- **Filter by position** — GK / DEF / MID / FWD (or All)
- **Filter by availability** — Available / Doubt / Injured (or All)
- **Filter by team** — dropdown of all 20 clubs
- **Filter by price range** — min/max cost in £m (stored as tenths internally, converted on display)
- **Sort by** — Total Points, Form, Price, PPG, Goals, Assists, Minutes, Bonus, or Ownership
- **Paginate** — numbered page links at the bottom

All filters are URL query parameters, so filtered views are bookmarkable and shareable.

### Player detail (`/players/{fpl_id}`)

A full profile page for one player. Includes:
- **Hero card** — large photo, full name, position pill, status indicator (green dot = available, yellow = doubt, red = injured), team badge, and quick stats
- **Stat cards row** — goals, assists, clean sheets, minutes, bonus, yellow cards, red cards, saves for the season
- **Points per GW line chart** — three overlaid lines: total points (green), goals (orange), assists (blue). X-axis is gameweek number.
- **ICT radar chart** — Influence, Creativity, Threat, and ICT Index plotted on a radar. Gives a quick sense of a player's attack style.
- **Price history chart** — value (in £m) over all gameweeks played, drawn as a line chart. Useful for spotting price rises.
- **Gameweek history table** — every row from `player_history` for this player, showing opponent, H/A, all stats including xG and xA.
- **Past seasons table** — from `player_history_past`. Career summary across prior FPL seasons.

### Teams (`/teams`)

A 5-wide grid of all 20 clubs, each showing badge, name, win/draw/loss record, and a strength progress bar. Click any card to view the team detail.

### Team detail (`/teams/{fpl_id}`)

A full profile for one club. Includes:
- **Strength bars** — six dimensions: overall home/away, attack home/away, defence home/away. The values are FPL's internal strength ratings (roughly 900–1400).
- **Strength radar chart** — all six dimensions plotted on a single radar, making it easy to see if a team is strong at home but weak away, or attack-heavy vs. defence-heavy.
- **Upcoming fixtures strip** — the next 8 fixtures with opponent name, home/away flag, and a colour-coded difficulty badge (green = easy, red = hard, based on `team_h_difficulty` / `team_a_difficulty` from the `fixtures` table).
- **Squad by position** — all players grouped as GK → DEF → MID → FWD. Each card shows the player photo, total points, and price. Click a card to go to the player detail page.

### Compare (`/compare`)

A fully interactive comparison tool powered by Alpine.js and the JSON API.

**How to use it:**
1. Choose **Players** or **Teams** with the type toggle
2. Type any player's name in the search box — a dropdown of matching results appears. Click to add them. Add up to 5 entities.
3. Click any **metric pill** to add or remove it from the comparison (defaults: Total Points, Goals, Assists)
4. Toggle between **Line** (per-GW history), **Bar** (season totals), or **Radar** (all metrics at once) chart modes
5. Scroll down to see the **Season Summary** table — a grid of all selected entities × all selected metrics

You can also link directly to a pre-populated comparison using URL parameters:
```
/compare?ids=430,328&type=player
```

Available metrics: Total Points, Goals, Assists, Clean Sheets, Minutes, Form, Price, PPG, Ownership %, Bonus, BPS, Influence, Creativity, Threat, ICT Index, xG, xA, Goals Conceded, Yellow Cards, Saves.

---

## 7. The JSON API

The webapp exposes a set of JSON endpoints under `/api/`. These are used by the compare page and the search typeahead, but you can also call them directly from a browser, curl, or any other HTTP client.

| Endpoint | What it returns |
|---|---|
| `GET /api/overview` | Dashboard summary — current GW, top 10 players, player/team counts, last scrape |
| `GET /api/gameweeks` | All 38 gameweeks with `is_current` / `is_next` / `is_finished` flags |
| `GET /api/players` | Filtered player list. Query params: `pos`, `team`, `status`, `min_cost`, `max_cost`, `sort`, `order`, `page`, `per_page` |
| `GET /api/players/{id}` | A single player with `photo_url` and `badge_url` added |
| `GET /api/players/{id}/history` | All `player_history` rows for this player, sorted by GW |
| `GET /api/teams` | All 20 teams with win/draw/loss stats and `badge_url` added |
| `GET /api/teams/{id}` | Single team with squad and next 10 fixtures |
| `GET /api/search?q=Salah&type=player` | Typeahead — up to 10 matching players or teams |
| `GET /api/compare?ids=1,2&type=player&metrics=total_points,goals_scored` | Comparison data — season totals and per-GW datasets ready for Chart.js |

**Example calls:**

```bash
# Get overview
curl http://127.0.0.1:8000/api/overview | python3 -m json.tool

# Find Haaland's fpl_id
curl "http://127.0.0.1:8000/api/search?q=Haaland&type=player"

# Get Haaland's full profile
curl http://127.0.0.1:8000/api/players/430

# Get Haaland's GW-by-GW history
curl http://127.0.0.1:8000/api/players/430/history

# Compare Haaland and Salah on goals and xG
curl "http://127.0.0.1:8000/api/compare?ids=430,308&type=player&metrics=goals_scored,expected_goals"
```

---

## 8. How data flows from the database to the browser

Understanding this makes it easy to trace any problem or add new features.

### Server-rendered pages (Dashboard, Players, Player Detail, Teams, Team Detail)

```
1. User navigates to /players?pos=3&sort=form
2. FastAPI calls pages.py → players()
3. players() calls db.get_players(pos=3, sort='form', ...) in db.py
4. db.py runs a SELECT on the open SQLite connection and returns list[dict]
5. pages.py passes the list to Jinja2: templates.TemplateResponse("players.html", {...})
6. Jinja2 renders the HTML template, inserting the player data
7. The fully-rendered HTML page is sent to the browser
8. The browser renders the HTML — no JavaScript required for the core content
9. Alpine.js and Chart.js enhance the page (filters, charts) after load
```

### Compare page (API-driven)

```
1. User navigates to /compare — an empty Alpine.js component loads
2. User types "Haaland" → Alpine calls GET /api/search?q=Haaland
3. api.py → search() queries the DB, returns [{id:430, label:"Haaland", ...}]
4. User clicks Haaland → entity added to selectedEntities array
5. Alpine calls GET /api/compare?ids=430&type=player&metrics=total_points,...
6. api.py queries player_history for all gameweeks, builds Chart.js-ready datasets
7. Alpine receives the JSON, calls createLineChart() in charts.js
8. Chart.js renders animated line charts directly on the canvas elements
```

### TTL cache behaviour

`db.py` uses a simple in-memory cache with a time-to-live. Stable data (teams, gameweeks) is cached for 5 minutes; player lists for 30 seconds. The cache is per-process and not shared across uvicorn workers.

If you've just run the scraper and the webapp is showing stale data, either:
- Wait for the cache to expire (max 5 minutes), or
- Restart the webapp: `Ctrl+C` then `python -m webapp`

---

## 9. Debugging and troubleshooting

### Server won't start

**"Address already in use"**

Port 8000 is already occupied. Either stop the other process or change the port in `webapp/__main__.py`.

**"No module named 'fastapi'"**

Dependencies aren't installed. Run:
```bash
pip install -r webapp/requirements.txt
```

**"Could not read DB for image download"**

The scraper hasn't run yet, or `data/fpl.db` is in an unexpected location. Check the path:
```bash
ls -lh data/fpl.db
```
Or override it:
```bash
FPL_DB_PATH=/absolute/path/to/fpl.db python -m webapp
```

**"RuntimeError: DB path not configured"**

`db.configure()` wasn't called before a query was attempted. This should not happen in normal use — it indicates the app factory wasn't called correctly. Make sure you're running `python -m webapp` from the project root, not from inside the `webapp/` directory.

### Page shows an error in the browser

**500 Internal Server Error**

FastAPI's default error page shows a generic message. To see the full traceback, run the webapp with Python's verbose output:
```bash
python -m webapp
```
The traceback will be printed to the terminal. Look for lines starting with `ERROR` or `Exception`.

For even more detail, enable debug mode by temporarily editing `webapp/__main__.py`:
```python
uvicorn.run("webapp.__main__:app", host="127.0.0.1", port=8000, reload=True, log_level="debug")
```
`reload=True` also makes the server automatically restart when you save any Python file — useful during development.

**404 Not Found on `/players/123`**

The player with `fpl_id = 123` doesn't exist in the database, or hasn't been scraped yet. Check with:
```bash
sqlite3 data/fpl.db "SELECT fpl_id, web_name FROM players WHERE fpl_id = 123;"
```

### Charts not rendering on the Player or Compare page

Open your browser's developer console (F12 → Console tab) and look for JavaScript errors.

Common causes:
- `Chart is not defined` — the Chart.js CDN failed to load. Check your internet connection.
- `Cannot read properties of null (reading 'getContext')` — the canvas element ID doesn't match what `charts.js` is trying to find. This usually means an Alpine.js rendering race condition; try a hard refresh (Ctrl+Shift+R).
- Blank canvas — the data for that chart is genuinely empty. Check the database:
  ```bash
  sqlite3 data/fpl.db "SELECT count(*) FROM player_history WHERE player_fpl_id = 430;"
  ```
  If `0`, run a fresh scrape.

### Images not showing

Player photos and team badges are stored in `webapp/static/images/players/` and `webapp/static/images/badges/`.

Check if they downloaded:
```bash
ls webapp/static/images/players/ | head -10
ls webapp/static/images/badges/
```

If the directories are empty, the download failed silently. Restart the server — the download runs every time and will retry any missing files. If files consistently fail to download, check the error in the terminal logs:
```
INFO webapp.images  Player photos: 0 downloaded, 0 skipped, 820 failed
```
This usually means the FPL CDN is temporarily unavailable. The webapp will use placeholder images in the meantime.

If a specific player has no photo, their `code` value in the database may be NULL or the CDN doesn't have that photo. Placeholders are shown automatically in that case.

### Database shows stale data after a fresh scrape

The webapp caches query results in memory for 30 seconds to 5 minutes. Either wait for the cache to expire, or restart the server. There is no manual cache-clear endpoint.

### Adding `print()` statements for debugging

Because the webapp is a regular Python process, you can add `print()` or `logging.debug()` calls anywhere in `app.py`, `db.py`, or the routers, and they will appear in the terminal when the relevant code path runs:

```python
# In webapp/db.py
def get_player(fpl_id: int) -> dict | None:
    print(f"[DEBUG] Querying player {fpl_id}")   # ← add this temporarily
    ...
```

Remove debug prints before committing.

### Running a manual SQL query against the live database

While the webapp is running, you can open the database in a second terminal and query it freely — WAL mode allows concurrent reads:

```bash
sqlite3 data/fpl.db
```
```sql
-- Which player has fpl_id 430?
SELECT web_name, first_name, second_name FROM players WHERE fpl_id = 430;

-- How many GW history rows does that player have?
SELECT count(*) FROM player_history WHERE player_fpl_id = 430;

-- What does the raw row look like?
SELECT * FROM player_history WHERE player_fpl_id = 430 ORDER BY gameweek_fpl_id DESC LIMIT 1;
```

The SQLite database file is at `data/fpl.db`. It is the same file the scraper writes to and the webapp reads from.

---

## 10. Customising the webapp

### Changing the colour scheme

All colour tokens are defined as CSS custom properties at the top of `webapp/static/css/app.css`:

```css
:root {
  --bg:       #0a0e1a;   /* page background */
  --surface:  #0f1729;   /* card background */
  --border:   #1e2d4a;   /* borders */
  --accent:   #00ff87;   /* FPL green — primary highlight */
  --sky:      #38bdf8;   /* sky blue — secondary highlight */
  --text:     #e2e8f0;   /* primary text */
  --muted:    #64748b;   /* secondary text */
  --danger:   #f87171;   /* red — injuries, red cards */
}
```

Change these values and refresh the page. No build step needed.

### Adding a new page

1. Add a query function in `webapp/db.py` that returns the data you need
2. Add a route in `webapp/routers/pages.py`:
   ```python
   @router.get("/my-new-page")
   async def my_page(request: Request):
       data = db.my_query()
       return _tmpl().TemplateResponse("my_page.html", {"request": request, "data": data})
   ```
3. Create `webapp/templates/my_page.html` extending `base.html`:
   ```html
   {% extends "base.html" %}
   {% block content %}
   <div class="py-8">
     <!-- your content here -->
   </div>
   {% endblock %}
   ```
4. Add a link in `webapp/templates/base.html` in the `nav_items` list

### Adding a new chart to an existing page

1. Add a `<canvas id="myChart"></canvas>` in the template
2. Call a factory function in the page's `{% block scripts %}`:
   ```html
   {% block scripts %}
   <script>
   const data = {{ my_data | tojson }};
   createBarChart('myChart',
     data.map(r => r.label),
     [{ label: 'My Metric', data: data.map(r => r.value) }]
   );
   </script>
   {% endblock %}
   ```

Available factory functions from `webapp/static/js/charts.js`:
- `createLineChart(canvasId, labels, datasets)` — animated line chart
- `createBarChart(canvasId, labels, datasets, horizontal=false)` — bar chart
- `createRadarChart(canvasId, labels, datasets)` — radar / spider chart
- `createDoughnutChart(canvasId, labels, data, colors)` — doughnut chart

### Exposing a new database field in the API

1. Add the column to the SQL query in `webapp/db.py`
2. If it needs to be in the compare metrics, add an entry to the `availableMetrics` array in `webapp/templates/compare.html`

---

## Further reading

- [../README.md](../README.md) — Root README: scraper setup, configuration, running, testing
- [../docs/SCHEMA.md](../docs/SCHEMA.md) — Complete database schema: all tables and columns
- [../docs/API.md](../docs/API.md) — FPL API endpoint reference

"""
Thread-local SQLite connection pool with in-process TTL cache.
All connections are opened read-only (PRAGMA query_only = ON).
"""
from __future__ import annotations

import functools
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable

# ---------------------------------------------------------------------------
# Configuration – set by app.py before first request
# ---------------------------------------------------------------------------

_DB_PATH: str = ""


def configure(db_path: str) -> None:
    global _DB_PATH
    _DB_PATH = db_path


# ---------------------------------------------------------------------------
# Thread-local connection pool
# ---------------------------------------------------------------------------

_local = threading.local()


def get_db() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        if not _DB_PATH:
            raise RuntimeError("DB path not configured – call db.configure(path) first")
        conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA query_only = ON;")
        _local.conn = conn
    return _local.conn


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Simple in-process TTL cache (avoids repeated identical SELECTs)
# ---------------------------------------------------------------------------

_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = threading.Lock()


def ttl_cache(seconds: int = 60) -> Callable:
    """Decorator: memoises the return value for `seconds` wall-clock seconds."""

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            key = fn.__qualname__ + repr(args) + repr(sorted(kwargs.items()))
            now = time.time()
            with _cache_lock:
                if key in _cache:
                    ts, val = _cache[key]
                    if now - ts < seconds:
                        return val
            result = fn(*args, **kwargs)
            with _cache_lock:
                _cache[key] = (now, result)
            return result

        return wrapper

    return decorator


def invalidate_cache() -> None:
    with _cache_lock:
        _cache.clear()


# ---------------------------------------------------------------------------
# Query functions
# ---------------------------------------------------------------------------


# --- Gameweeks ---

@ttl_cache(seconds=60)
def get_all_gameweeks() -> list[dict]:
    cur = get_db().execute(
        "SELECT * FROM gameweeks ORDER BY fpl_id ASC"
    )
    return rows_to_dicts(cur.fetchall())


@ttl_cache(seconds=60)
def get_current_gameweek() -> dict | None:
    cur = get_db().execute(
        "SELECT * FROM gameweeks WHERE is_current = 1 LIMIT 1"
    )
    row = cur.fetchone()
    return dict(row) if row else None


# --- Teams ---

@ttl_cache(seconds=300)
def get_all_teams() -> list[dict]:
    cur = get_db().execute(
        "SELECT * FROM teams ORDER BY name ASC"
    )
    return rows_to_dicts(cur.fetchall())


@ttl_cache(seconds=300)
def get_team(fpl_id: int) -> dict | None:
    cur = get_db().execute(
        "SELECT * FROM teams WHERE fpl_id = ? LIMIT 1", (fpl_id,)
    )
    row = cur.fetchone()
    return dict(row) if row else None


@ttl_cache(seconds=300)
def get_teams_with_stats() -> list[dict]:
    """Teams enriched with win/draw/loss counts and squad xG/xA/xGI/xGP/xAP/xGIP totals.

    The xG metrics are computed live from the players table so they automatically
    reflect any player additions, removals, or stat updates without any extra sync.
    """
    sql = """
    SELECT
        t.*,
        COUNT(CASE WHEN
            (f.team_h_fpl_id = t.fpl_id AND f.team_h_score > f.team_a_score) OR
            (f.team_a_fpl_id = t.fpl_id AND f.team_a_score > f.team_h_score)
            THEN 1 END) AS wins,
        COUNT(CASE WHEN
            f.finished = 1 AND f.team_h_score = f.team_a_score AND
            (f.team_h_fpl_id = t.fpl_id OR f.team_a_fpl_id = t.fpl_id)
            THEN 1 END) AS draws,
        COUNT(CASE WHEN
            (f.team_h_fpl_id = t.fpl_id AND f.team_h_score < f.team_a_score) OR
            (f.team_a_fpl_id = t.fpl_id AND f.team_a_score < f.team_h_score)
            THEN 1 END) AS losses,
        xg.team_xg,
        xg.team_xa,
        xg.team_xgi,
        xg.team_xgp,
        xg.team_xap,
        xg.team_xgip
    FROM teams t
    LEFT JOIN fixtures f ON f.finished = 1 AND
        (f.team_h_fpl_id = t.fpl_id OR f.team_a_fpl_id = t.fpl_id)
    LEFT JOIN (
        SELECT
            team_fpl_id,
            ROUND(COALESCE(SUM(CAST(expected_goals             AS REAL)), 0), 2) AS team_xg,
            ROUND(COALESCE(SUM(CAST(expected_assists           AS REAL)), 0), 2) AS team_xa,
            ROUND(COALESCE(SUM(CAST(expected_goal_involvements AS REAL)), 0), 2) AS team_xgi,
            ROUND(COALESCE(SUM(xgp),  0), 2)                                     AS team_xgp,
            ROUND(COALESCE(SUM(xap),  0), 2)                                     AS team_xap,
            ROUND(COALESCE(SUM(xgip), 0), 2)                                     AS team_xgip
        FROM players
        GROUP BY team_fpl_id
    ) xg ON xg.team_fpl_id = t.fpl_id
    GROUP BY t.fpl_id
    ORDER BY t.name ASC
    """
    cur = get_db().execute(sql)
    return rows_to_dicts(cur.fetchall())


# --- Players ---

def get_players(
    pos: int | None = None,
    team: int | None = None,
    status: str | None = None,
    min_cost: int | None = None,
    max_cost: int | None = None,
    gw_start: int | None = None,
    gw_end: int | None = None,
    sort: str = "total_points",
    order: str = "desc",
    page: int = 1,
    per_page: int = 40,
) -> tuple[list[dict], int]:
    """Return (players, total_count). Prices in tenths (e.g. 130 = £13.0m).

    When gw_start or gw_end is provided the stats columns (goals, assists, etc.)
    are aggregated from player_history for that GW range instead of using the
    season totals stored in the players table.
    """
    valid_sorts = {
        # Integer columns — sort as-is
        "total_points", "now_cost", "goals_scored", "assists", "minutes",
        "transfers_in", "bonus", "clean_sheets", "goals_conceded", "bps",
        # REAL columns — sort as-is (no CAST needed)
        "xgp", "xap", "xgip",
        # Text columns with numeric values — need CAST AS REAL for correct ordering
        "form", "selected_by_percent", "points_per_game",
        "influence", "creativity", "threat", "ict_index",
        "expected_goals", "expected_assists",
        "expected_goal_involvements", "expected_goals_conceded",
        # Text sort (alphabetic)
        "web_name",
    }
    # TEXT columns in `players` that store numeric values.
    _text_numeric = {
        "form", "selected_by_percent", "points_per_game",
        "influence", "creativity", "threat", "ict_index",
        "expected_goals", "expected_assists",
        "expected_goal_involvements", "expected_goals_conceded",
    }
    # Columns that are aggregated from player_history when GW range is active.
    # In the CTE these are already proper numbers so no CAST is needed for sort.
    _gw_agg_cols = {
        "total_points", "goals_scored", "assists", "clean_sheets",
        "goals_conceded", "minutes", "bonus", "bps", "transfers_in",
        "expected_goals", "expected_assists",
        "expected_goal_involvements", "expected_goals_conceded",
        "xgp", "xap", "xgip",
    }

    if sort not in valid_sorts:
        sort = "total_points"
    order_dir = "DESC" if order.lower() == "desc" else "ASC"
    use_gw_range = gw_start is not None or gw_end is not None

    conditions: list[str] = []
    params: list[Any] = []

    if pos is not None:
        conditions.append("p.element_type = ?")
        params.append(pos)
    if team is not None:
        conditions.append("p.team_fpl_id = ?")
        params.append(team)
    if status:
        if status == "available":
            conditions.append("p.status = 'a'")
        elif status == "injured":
            conditions.append("p.status = 'i'")
        elif status == "doubt":
            conditions.append("p.status = 'd'")
    if min_cost is not None:
        conditions.append("p.now_cost >= ?")
        params.append(min_cost)
    if max_cost is not None:
        conditions.append("p.now_cost <= ?")
        params.append(max_cost)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    db_conn = get_db()
    offset = (page - 1) * per_page

    if use_gw_range:
        # ── Resolve effective GW bounds ──────────────────────────────────────
        gw_start_eff = gw_start if gw_start is not None else 1
        if gw_end is not None:
            gw_end_eff = gw_end
        else:
            row = db_conn.execute("SELECT MAX(fpl_id) FROM gameweeks").fetchone()
            gw_end_eff = row[0] if row and row[0] else 38

        cte_params: list[Any] = [gw_start_eff, gw_end_eff]

        # Sort expression: aggregated cols → bare alias (already numeric);
        # text-numeric p.* cols → CAST; everything else → p. prefix.
        if sort in _gw_agg_cols:
            sort_expr = sort
        elif sort in _text_numeric:
            sort_expr = f"CAST(p.{sort} AS REAL)"
        else:
            sort_expr = f"p.{sort}"

        cte = """
        WITH gw_stats AS (
            SELECT
                player_fpl_id,
                COALESCE(SUM(total_points),                                            0) AS total_points,
                COALESCE(SUM(goals_scored),                                            0) AS goals_scored,
                COALESCE(SUM(assists),                                                 0) AS assists,
                COALESCE(SUM(clean_sheets),                                            0) AS clean_sheets,
                COALESCE(SUM(goals_conceded),                                          0) AS goals_conceded,
                COALESCE(SUM(minutes),                                                 0) AS minutes,
                COALESCE(SUM(bonus),                                                   0) AS bonus,
                COALESCE(SUM(bps),                                                     0) AS bps,
                COALESCE(SUM(transfers_in),                                            0) AS transfers_in,
                ROUND(COALESCE(SUM(CAST(expected_goals              AS REAL)), 0), 2)    AS expected_goals,
                ROUND(COALESCE(SUM(CAST(expected_assists            AS REAL)), 0), 2)    AS expected_assists,
                ROUND(COALESCE(SUM(CAST(expected_goal_involvements  AS REAL)), 0), 2)    AS expected_goal_involvements,
                ROUND(COALESCE(SUM(CAST(expected_goals_conceded     AS REAL)), 0), 2)    AS expected_goals_conceded,
                ROUND(COALESCE(SUM(xgp),                               0), 2)            AS xgp,
                ROUND(COALESCE(SUM(xap),                               0), 2)            AS xap,
                ROUND(COALESCE(SUM(xgip),                              0), 2)            AS xgip
            FROM player_history
            WHERE gameweek_fpl_id BETWEEN ? AND ?
            GROUP BY player_fpl_id
        )
        """

        count_sql = f"""
            {cte}
            SELECT COUNT(*) FROM players p
            JOIN teams t ON t.fpl_id = p.team_fpl_id
            LEFT JOIN gw_stats gs ON gs.player_fpl_id = p.fpl_id
            {where}
        """
        data_sql = f"""
            {cte}
            SELECT
                p.fpl_id, p.web_name, p.first_name, p.second_name, p.code,
                p.element_type, p.now_cost, p.status, p.news,
                p.chance_of_playing_next_round, p.chance_of_playing_this_round,
                p.team_fpl_id,
                p.form, p.selected_by_percent, p.points_per_game,
                p.influence, p.creativity, p.threat, p.ict_index,
                t.name AS team_name, t.short_name AS team_short_name,
                COALESCE(gs.total_points,               0)   AS total_points,
                COALESCE(gs.goals_scored,               0)   AS goals_scored,
                COALESCE(gs.assists,                    0)   AS assists,
                COALESCE(gs.clean_sheets,               0)   AS clean_sheets,
                COALESCE(gs.goals_conceded,             0)   AS goals_conceded,
                COALESCE(gs.minutes,                    0)   AS minutes,
                COALESCE(gs.bonus,                      0)   AS bonus,
                COALESCE(gs.bps,                        0)   AS bps,
                COALESCE(gs.transfers_in,               0)   AS transfers_in,
                COALESCE(gs.expected_goals,             0)   AS expected_goals,
                COALESCE(gs.expected_assists,           0)   AS expected_assists,
                COALESCE(gs.expected_goal_involvements, 0)   AS expected_goal_involvements,
                COALESCE(gs.expected_goals_conceded,    0)   AS expected_goals_conceded,
                COALESCE(gs.xgp,                        0)   AS xgp,
                COALESCE(gs.xap,                        0)   AS xap,
                COALESCE(gs.xgip,                       0)   AS xgip
            FROM players p
            JOIN teams t ON t.fpl_id = p.team_fpl_id
            LEFT JOIN gw_stats gs ON gs.player_fpl_id = p.fpl_id
            {where}
            ORDER BY {sort_expr} {order_dir}
            LIMIT ? OFFSET ?
        """
        total = db_conn.execute(count_sql, cte_params + params).fetchone()[0]
        cur = db_conn.execute(data_sql, cte_params + params + [per_page, offset])
        return rows_to_dicts(cur.fetchall()), total

    else:
        # ── Season-totals query (no GW range) ───────────────────────────────
        sort_expr = f"CAST(p.{sort} AS REAL)" if sort in _text_numeric else f"p.{sort}"

        count_sql = f"""
            SELECT COUNT(*) FROM players p
            JOIN teams t ON t.fpl_id = p.team_fpl_id
            {where}
        """
        total = db_conn.execute(count_sql, params).fetchone()[0]

        data_sql = f"""
            SELECT p.*, t.name AS team_name, t.short_name AS team_short_name
            FROM players p
            JOIN teams t ON t.fpl_id = p.team_fpl_id
            {where}
            ORDER BY {sort_expr} {order_dir}
            LIMIT ? OFFSET ?
        """
        cur = db_conn.execute(data_sql, params + [per_page, offset])
        return rows_to_dicts(cur.fetchall()), total


@ttl_cache(seconds=60)
def get_player(fpl_id: int) -> dict | None:
    sql = """
        SELECT p.*, t.name AS team_name, t.short_name AS team_short_name
        FROM players p
        JOIN teams t ON t.fpl_id = p.team_fpl_id
        WHERE p.fpl_id = ?
        LIMIT 1
    """
    cur = get_db().execute(sql, (fpl_id,))
    row = cur.fetchone()
    return dict(row) if row else None


def get_player_history(fpl_id: int) -> list[dict]:
    sql = """
        SELECT ph.*, t.short_name AS opponent_short_name
        FROM player_history ph
        LEFT JOIN teams t ON t.fpl_id = ph.opponent_team
        WHERE ph.player_fpl_id = ?
        ORDER BY ph.gameweek_fpl_id ASC
    """
    cur = get_db().execute(sql, (fpl_id,))
    return rows_to_dicts(cur.fetchall())


def get_player_history_past(fpl_id: int) -> list[dict]:
    sql = """
        SELECT * FROM player_history_past
        WHERE player_fpl_id = ?
        ORDER BY season_name DESC
    """
    cur = get_db().execute(sql, (fpl_id,))
    return rows_to_dicts(cur.fetchall())


# --- Team detail ---

def get_team_squad(team_fpl_id: int) -> list[dict]:
    """All players for a team, grouped by position."""
    sql = """
        SELECT * FROM players
        WHERE team_fpl_id = ?
        ORDER BY element_type ASC, total_points DESC
    """
    cur = get_db().execute(sql, (team_fpl_id,))
    return rows_to_dicts(cur.fetchall())


def get_team_fixtures(team_fpl_id: int, limit: int = 10) -> list[dict]:
    """Next N fixtures for a team (not yet finished), with opponent names."""
    sql = """
        SELECT
            f.*,
            th.name AS team_h_name, th.short_name AS team_h_short,
            ta.name AS team_a_name, ta.short_name AS team_a_short,
            CASE
                WHEN f.team_h_fpl_id = ? THEN f.team_a_difficulty
                ELSE f.team_h_difficulty
            END AS my_difficulty,
            CASE
                WHEN f.team_h_fpl_id = ? THEN ta.short_name
                ELSE th.short_name
            END AS opponent_short,
            CASE WHEN f.team_h_fpl_id = ? THEN 1 ELSE 0 END AS is_home
        FROM fixtures f
        JOIN teams th ON th.fpl_id = f.team_h_fpl_id
        JOIN teams ta ON ta.fpl_id = f.team_a_fpl_id
        WHERE (f.team_h_fpl_id = ? OR f.team_a_fpl_id = ?)
          AND f.finished = 0
        ORDER BY f.kickoff_time ASC NULLS LAST
        LIMIT ?
    """
    cur = get_db().execute(
        sql, (team_fpl_id, team_fpl_id, team_fpl_id, team_fpl_id, team_fpl_id, limit)
    )
    return rows_to_dicts(cur.fetchall())


# --- Dashboard ---

@ttl_cache(seconds=120)
def get_overview() -> dict:
    """Summary stats for the dashboard."""
    db = get_db()

    gw = get_current_gameweek()
    gw_id = gw["fpl_id"] if gw else None

    # Top performers this GW
    top_players: list[dict] = []
    if gw_id is not None:
        sql = """
            SELECT p.fpl_id, p.web_name, p.code, p.team_fpl_id, p.element_type,
                   t.short_name AS team_short,
                   ph.total_points, ph.goals_scored, ph.assists,
                   ph.minutes, ph.bonus, ph.clean_sheets
            FROM player_history ph
            JOIN players p ON p.fpl_id = ph.player_fpl_id
            JOIN teams t ON t.fpl_id = p.team_fpl_id
            WHERE ph.gameweek_fpl_id = ?
            ORDER BY ph.total_points DESC
            LIMIT 10
        """
        cur = db.execute(sql, (gw_id,))
        top_players = rows_to_dicts(cur.fetchall())

    # Last scrape info
    scrape_sql = """
        SELECT * FROM scrape_log
        ORDER BY started_at DESC LIMIT 1
    """
    scrape_row = db.execute(scrape_sql).fetchone()
    last_scrape = dict(scrape_row) if scrape_row else None

    # Player/team counts
    player_count = db.execute("SELECT COUNT(*) FROM players").fetchone()[0]
    team_count = db.execute("SELECT COUNT(*) FROM teams").fetchone()[0]

    return {
        "current_gameweek": gw,
        "top_players": top_players,
        "last_scrape": last_scrape,
        "player_count": player_count,
        "team_count": team_count,
    }


# --- Search (typeahead) ---

def search_players(q: str, limit: int = 10) -> list[dict]:
    like = f"%{q}%"
    sql = """
        SELECT p.fpl_id, p.web_name, p.first_name, p.second_name,
               p.code, p.element_type, p.now_cost, p.total_points,
               t.short_name AS team_short
        FROM players p
        JOIN teams t ON t.fpl_id = p.team_fpl_id
        WHERE p.web_name LIKE ? OR p.first_name LIKE ? OR p.second_name LIKE ?
        ORDER BY p.total_points DESC
        LIMIT ?
    """
    cur = get_db().execute(sql, (like, like, like, limit))
    return rows_to_dicts(cur.fetchall())


def search_teams(q: str, limit: int = 10) -> list[dict]:
    like = f"%{q}%"
    sql = """
        SELECT fpl_id, name, short_name, strength
        FROM teams
        WHERE name LIKE ? OR short_name LIKE ?
        ORDER BY name ASC
        LIMIT ?
    """
    cur = get_db().execute(sql, (like, like, limit))
    return rows_to_dicts(cur.fetchall())


# --- Compare ---

def get_compare_players(fpl_ids: list[int]) -> list[dict]:
    if not fpl_ids:
        return []
    placeholders = ",".join("?" * len(fpl_ids))
    sql = f"""
        SELECT p.*, t.name AS team_name, t.short_name AS team_short_name
        FROM players p
        JOIN teams t ON t.fpl_id = p.team_fpl_id
        WHERE p.fpl_id IN ({placeholders})
    """
    cur = get_db().execute(sql, fpl_ids)
    return rows_to_dicts(cur.fetchall())


def get_compare_teams(fpl_ids: list[int]) -> list[dict]:
    if not fpl_ids:
        return []
    placeholders = ",".join("?" * len(fpl_ids))
    sql = f"SELECT * FROM teams WHERE fpl_id IN ({placeholders})"
    cur = get_db().execute(sql, fpl_ids)
    return rows_to_dicts(cur.fetchall())


def get_compare_player_histories(fpl_ids: list[int]) -> dict[int, list[dict]]:
    """Map of player_fpl_id → sorted list of per-GW dicts."""
    if not fpl_ids:
        return {}
    placeholders = ",".join("?" * len(fpl_ids))
    sql = f"""
        SELECT * FROM player_history
        WHERE player_fpl_id IN ({placeholders})
        ORDER BY player_fpl_id ASC, gameweek_fpl_id ASC
    """
    cur = get_db().execute(sql, fpl_ids)
    result: dict[int, list[dict]] = {pid: [] for pid in fpl_ids}
    for row in cur.fetchall():
        d = dict(row)
        result[d["player_fpl_id"]].append(d)
    return result

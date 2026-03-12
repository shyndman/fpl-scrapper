"""
SQLite database management: schema creation, connection, and all upsert/query operations.
WAL mode is enabled so OpenClaw can read the DB while a scrape is in progress.
"""
from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from typing import Any

from src.models import (
    Fixture,
    Gameweek,
    LiveGameweekStats,
    Player,
    PlayerHistory,
    PlayerHistoryPast,
    Team,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Schema SQL
# ---------------------------------------------------------------------------

_SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teams (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    fpl_id                  INTEGER NOT NULL UNIQUE,
    name                    TEXT NOT NULL,
    short_name              TEXT NOT NULL,
    code                    INTEGER,
    strength                INTEGER,
    strength_overall_home   INTEGER,
    strength_overall_away   INTEGER,
    strength_attack_home    INTEGER,
    strength_attack_away    INTEGER,
    strength_defence_home   INTEGER,
    strength_defence_away   INTEGER,
    pulse_id                INTEGER,
    scraped_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_teams_fpl_id ON teams(fpl_id);

CREATE TABLE IF NOT EXISTS gameweeks (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    fpl_id                  INTEGER NOT NULL UNIQUE,
    name                    TEXT NOT NULL,
    deadline_time           TEXT NOT NULL,
    average_entry_score     INTEGER,
    highest_score           INTEGER,
    highest_scoring_entry   INTEGER,
    is_current              INTEGER NOT NULL DEFAULT 0,
    is_next                 INTEGER NOT NULL DEFAULT 0,
    is_finished             INTEGER NOT NULL DEFAULT 0,
    chip_plays              TEXT,
    most_selected           INTEGER,
    most_transferred_in     INTEGER,
    most_captained          INTEGER,
    most_vice_captained     INTEGER,
    transfers_made          INTEGER,
    scraped_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gameweeks_fpl_id    ON gameweeks(fpl_id);
CREATE INDEX IF NOT EXISTS idx_gameweeks_is_current ON gameweeks(is_current);

CREATE TABLE IF NOT EXISTS players (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    fpl_id                          INTEGER NOT NULL UNIQUE,
    first_name                      TEXT NOT NULL,
    second_name                     TEXT NOT NULL,
    web_name                        TEXT NOT NULL,
    team_fpl_id                     INTEGER NOT NULL,
    element_type                    INTEGER NOT NULL,
    status                          TEXT,
    code                            INTEGER,
    now_cost                        INTEGER,
    cost_change_start               INTEGER,
    cost_change_event               INTEGER,
    chance_of_playing_this_round    INTEGER,
    chance_of_playing_next_round    INTEGER,
    total_points                    INTEGER DEFAULT 0,
    event_points                    INTEGER DEFAULT 0,
    points_per_game                 TEXT,
    form                            TEXT,
    selected_by_percent             TEXT,
    transfers_in                    INTEGER DEFAULT 0,
    transfers_out                   INTEGER DEFAULT 0,
    transfers_in_event              INTEGER DEFAULT 0,
    transfers_out_event             INTEGER DEFAULT 0,
    minutes                         INTEGER DEFAULT 0,
    goals_scored                    INTEGER DEFAULT 0,
    assists                         INTEGER DEFAULT 0,
    clean_sheets                    INTEGER DEFAULT 0,
    goals_conceded                  INTEGER DEFAULT 0,
    own_goals                       INTEGER DEFAULT 0,
    penalties_saved                 INTEGER DEFAULT 0,
    penalties_missed                INTEGER DEFAULT 0,
    yellow_cards                    INTEGER DEFAULT 0,
    red_cards                       INTEGER DEFAULT 0,
    saves                           INTEGER DEFAULT 0,
    bonus                           INTEGER DEFAULT 0,
    bps                             INTEGER DEFAULT 0,
    influence                       TEXT,
    creativity                      TEXT,
    threat                          TEXT,
    ict_index                       TEXT,
    starts                          INTEGER DEFAULT 0,
    expected_goals                  REAL,
    expected_assists                REAL,
    expected_goal_involvements      REAL,
    expected_goals_conceded         TEXT,
    xgp                             REAL,
    xap                             REAL,
    xgip                            REAL,
    news                            TEXT,
    news_added                      TEXT,
    squad_number                    INTEGER,
    photo                           TEXT,
    scraped_at                      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_players_fpl_id      ON players(fpl_id);
CREATE INDEX IF NOT EXISTS idx_players_team        ON players(team_fpl_id);
CREATE INDEX IF NOT EXISTS idx_players_element_type ON players(element_type);
CREATE INDEX IF NOT EXISTS idx_players_status      ON players(status);

CREATE TABLE IF NOT EXISTS player_history (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    player_fpl_id                   INTEGER NOT NULL,
    gameweek_fpl_id                 INTEGER NOT NULL,
    opponent_team                   INTEGER,
    was_home                        INTEGER,
    kickoff_time                    TEXT,
    total_points                    INTEGER DEFAULT 0,
    minutes                         INTEGER DEFAULT 0,
    goals_scored                    INTEGER DEFAULT 0,
    assists                         INTEGER DEFAULT 0,
    clean_sheets                    INTEGER DEFAULT 0,
    goals_conceded                  INTEGER DEFAULT 0,
    own_goals                       INTEGER DEFAULT 0,
    penalties_saved                 INTEGER DEFAULT 0,
    penalties_missed                INTEGER DEFAULT 0,
    yellow_cards                    INTEGER DEFAULT 0,
    red_cards                       INTEGER DEFAULT 0,
    saves                           INTEGER DEFAULT 0,
    bonus                           INTEGER DEFAULT 0,
    bps                             INTEGER DEFAULT 0,
    influence                       TEXT,
    creativity                      TEXT,
    threat                          TEXT,
    ict_index                       TEXT,
    starts                          INTEGER DEFAULT 0,
    expected_goals                  REAL,
    expected_assists                REAL,
    expected_goal_involvements      REAL,
    expected_goals_conceded         TEXT,
    xgp                             REAL,
    xap                             REAL,
    xgip                            REAL,
    value                           INTEGER,
    transfers_balance               INTEGER,
    selected                        INTEGER,
    transfers_in                    INTEGER DEFAULT 0,
    transfers_out                   INTEGER DEFAULT 0,
    round                           INTEGER,
    scraped_at                      TEXT NOT NULL,
    UNIQUE(player_fpl_id, gameweek_fpl_id)
);

CREATE INDEX IF NOT EXISTS idx_ph_player    ON player_history(player_fpl_id);
CREATE INDEX IF NOT EXISTS idx_ph_gameweek  ON player_history(gameweek_fpl_id);
CREATE INDEX IF NOT EXISTS idx_ph_player_gw ON player_history(player_fpl_id, gameweek_fpl_id);

CREATE TABLE IF NOT EXISTS player_history_past (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    player_fpl_id                   INTEGER NOT NULL,
    season_name                     TEXT NOT NULL,
    element_code                    INTEGER,
    start_cost                      INTEGER,
    end_cost                        INTEGER,
    total_points                    INTEGER DEFAULT 0,
    minutes                         INTEGER DEFAULT 0,
    goals_scored                    INTEGER DEFAULT 0,
    assists                         INTEGER DEFAULT 0,
    clean_sheets                    INTEGER DEFAULT 0,
    goals_conceded                  INTEGER DEFAULT 0,
    own_goals                       INTEGER DEFAULT 0,
    penalties_saved                 INTEGER DEFAULT 0,
    penalties_missed                INTEGER DEFAULT 0,
    yellow_cards                    INTEGER DEFAULT 0,
    red_cards                       INTEGER DEFAULT 0,
    saves                           INTEGER DEFAULT 0,
    bonus                           INTEGER DEFAULT 0,
    bps                             INTEGER DEFAULT 0,
    influence                       TEXT,
    creativity                      TEXT,
    threat                          TEXT,
    ict_index                       TEXT,
    starts                          INTEGER DEFAULT 0,
    expected_goals                  REAL,
    expected_assists                REAL,
    expected_goal_involvements      REAL,
    expected_goals_conceded         TEXT,
    scraped_at                      TEXT NOT NULL,
    UNIQUE(player_fpl_id, season_name)
);

CREATE INDEX IF NOT EXISTS idx_php_player ON player_history_past(player_fpl_id);

CREATE TABLE IF NOT EXISTS fixtures (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    fpl_id                  INTEGER NOT NULL UNIQUE,
    gameweek_fpl_id         INTEGER,
    kickoff_time            TEXT,
    team_h_fpl_id           INTEGER NOT NULL,
    team_a_fpl_id           INTEGER NOT NULL,
    team_h_score            INTEGER,
    team_a_score            INTEGER,
    finished                INTEGER NOT NULL DEFAULT 0,
    finished_provisional    INTEGER DEFAULT 0,
    started                 INTEGER DEFAULT 0,
    minutes                 INTEGER DEFAULT 0,
    team_h_difficulty       INTEGER,
    team_a_difficulty       INTEGER,
    code                    INTEGER,
    pulse_id                INTEGER,
    stats                   TEXT,
    scraped_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fixtures_fpl_id ON fixtures(fpl_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_gw     ON fixtures(gameweek_fpl_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_team_h ON fixtures(team_h_fpl_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_team_a ON fixtures(team_a_fpl_id);

CREATE TABLE IF NOT EXISTS live_gameweek_stats (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    player_fpl_id                   INTEGER NOT NULL,
    gameweek_fpl_id                 INTEGER NOT NULL,
    minutes                         INTEGER DEFAULT 0,
    goals_scored                    INTEGER DEFAULT 0,
    assists                         INTEGER DEFAULT 0,
    clean_sheets                    INTEGER DEFAULT 0,
    goals_conceded                  INTEGER DEFAULT 0,
    own_goals                       INTEGER DEFAULT 0,
    penalties_saved                 INTEGER DEFAULT 0,
    penalties_missed                INTEGER DEFAULT 0,
    yellow_cards                    INTEGER DEFAULT 0,
    red_cards                       INTEGER DEFAULT 0,
    saves                           INTEGER DEFAULT 0,
    bonus                           INTEGER DEFAULT 0,
    bps                             INTEGER DEFAULT 0,
    influence                       TEXT,
    creativity                      TEXT,
    threat                          TEXT,
    ict_index                       TEXT,
    starts                          INTEGER DEFAULT 0,
    expected_goals                  REAL,
    expected_assists                REAL,
    expected_goal_involvements      REAL,
    expected_goals_conceded         TEXT,
    total_points                    INTEGER DEFAULT 0,
    in_dreamteam                    INTEGER DEFAULT 0,
    explain                         TEXT,
    scraped_at                      TEXT NOT NULL,
    UNIQUE(player_fpl_id, gameweek_fpl_id)
);

CREATE INDEX IF NOT EXISTS idx_lgs_player ON live_gameweek_stats(player_fpl_id);
CREATE INDEX IF NOT EXISTS idx_lgs_gw     ON live_gameweek_stats(gameweek_fpl_id);

CREATE TABLE IF NOT EXISTS scrape_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id              TEXT NOT NULL,
    mode                TEXT NOT NULL,
    gameweek_fpl_id     INTEGER,
    started_at          TEXT NOT NULL,
    finished_at         TEXT,
    status              TEXT NOT NULL DEFAULT 'running',
    players_scraped     INTEGER DEFAULT 0,
    requests_made       INTEGER DEFAULT 0,
    errors_encountered  INTEGER DEFAULT 0,
    error_detail        TEXT
);
"""


# ---------------------------------------------------------------------------
# Database class
# ---------------------------------------------------------------------------

class FPLDatabase:
    """
    Manages the SQLite connection and provides typed upsert + query methods.
    """

    def __init__(self, db_path: str) -> None:
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._conn: sqlite3.Connection = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL;")
        self._conn.execute("PRAGMA foreign_keys = ON;")
        logger.debug("Opened database: %s", db_path)

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    def initialize_schema(self) -> None:
        """Create all tables and indexes if they don't already exist."""
        self._conn.executescript(_SCHEMA_SQL)
        self._conn.commit()
        self.migrate_schema()
        logger.info("Database schema initialised at %s", self._db_path)

    def migrate_schema(self) -> None:
        """Idempotently add columns introduced after the initial schema."""
        new_columns = [
            ("players",        "xgp  REAL"),
            ("players",        "xap  REAL"),
            ("players",        "xgip REAL"),
            ("player_history", "xgp  REAL"),
            ("player_history", "xap  REAL"),
            ("player_history", "xgip REAL"),
        ]
        for table, col_def in new_columns:
            col_name = col_def.split()[0]
            try:
                self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {col_def}")
                self._conn.commit()
                logger.info("Migration: added %s.%s", table, col_name)
            except Exception:
                pass  # column already exists — safe to ignore

        # Change expected_goals/assists/goal_involvements from TEXT to REAL affinity.
        # SQLite has no ALTER COLUMN TYPE; the only way to change column affinity is
        # to rebuild the table (RENAME old → CREATE new → INSERT data → DROP old).
        self._rebuild_xg_column_types()

    def _rebuild_xg_column_types(self) -> None:
        """
        Rebuild the four stat tables so that expected_goals, expected_assists,
        and expected_goal_involvements have REAL affinity.

        SQLite does not support ALTER COLUMN TYPE; the standard workaround is:
          1. Rename the old table to <table>_old
          2. Create the new table from the current schema (already REAL)
          3. Copy all rows from the old table
          4. Drop the old table

        The check against PRAGMA table_info makes this idempotent — it only
        runs for tables where the column is still declared TEXT.
        """
        import re

        tables = [
            "players",
            "player_history",
            "player_history_past",
            "live_gameweek_stats",
        ]
        # Indexes to (re-)create after the rebuild
        index_pattern = re.compile(
            r"CREATE INDEX IF NOT EXISTS \w+ ON "
            r"(?:players|player_history|player_history_past|live_gameweek_stats)"
            r"\(\w+(?:,\s*\w+)*\);",
        )
        indexes_sql = "\n".join(index_pattern.findall(_SCHEMA_SQL))

        for table in tables:
            pragma = self._conn.execute(
                f"PRAGMA table_info({table})"
            ).fetchall()
            col_types = {row[1]: row[2].upper() for row in pragma}
            if col_types.get("expected_goals", "REAL") != "TEXT":
                continue  # already REAL — nothing to do

            # Extract the CREATE TABLE block from the current schema definition.
            match = re.search(
                rf"(CREATE TABLE IF NOT EXISTS {table}\s*\([^;]+;)",
                _SCHEMA_SQL,
                re.DOTALL,
            )
            if not match:
                logger.warning("Schema block for %s not found; skipping rebuild", table)
                continue

            # Build CREATE TABLE for the temporary name, then rename back.
            create_new = match.group(1).replace(
                f"CREATE TABLE IF NOT EXISTS {table}",
                f"CREATE TABLE {table}_rebuilt",
            )

            logger.info("Rebuilding %s to change expected_goals/assists/xgi to REAL...", table)
            self._conn.executescript(f"""
                ALTER TABLE {table} RENAME TO {table}_old;
                {create_new}
                INSERT INTO {table}_rebuilt SELECT * FROM {table}_old;
                DROP TABLE {table}_old;
                ALTER TABLE {table}_rebuilt RENAME TO {table};
                {indexes_sql}
            """)
            logger.info("Rebuilt %s — column types updated to REAL", table)

        self._conn.commit()

    def backfill_xg_performance(self) -> None:
        """
        Compute xgp/xap/xgip for every row in players and player_history
        that has expected_goals / expected_assists but no xgp yet.
        Safe to run multiple times (only touches NULL rows).
        """
        self._conn.executescript("""
        UPDATE players
        SET
            xgp  = ROUND(goals_scored - expected_goals,  2),
            xap  = ROUND(assists      - expected_assists, 2),
            xgip = ROUND((goals_scored - expected_goals) + (assists - expected_assists), 2)
        WHERE expected_goals IS NOT NULL
          AND expected_assists IS NOT NULL
          AND xgp IS NULL;

        UPDATE player_history
        SET
            xgp  = ROUND(goals_scored - expected_goals,  2),
            xap  = ROUND(assists      - expected_assists, 2),
            xgip = ROUND((goals_scored - expected_goals) + (assists - expected_assists), 2)
        WHERE expected_goals IS NOT NULL
          AND expected_assists IS NOT NULL
          AND xgp IS NULL;
        """)
        self._conn.commit()
        logger.info("Backfilled xgp/xap/xgip for players and player_history")

    # ------------------------------------------------------------------
    # Upsert helpers
    # ------------------------------------------------------------------

    def upsert_teams(self, teams: list[Team]) -> int:
        sql = """
        INSERT OR REPLACE INTO teams
            (fpl_id, name, short_name, code, strength,
             strength_overall_home, strength_overall_away,
             strength_attack_home, strength_attack_away,
             strength_defence_home, strength_defence_away,
             pulse_id, scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """
        with self._conn:
            self._conn.executemany(sql, [t.to_db_tuple() for t in teams])
        logger.debug("Upserted %d teams", len(teams))
        return len(teams)

    def upsert_gameweeks(self, gameweeks: list[Gameweek]) -> int:
        sql = """
        INSERT OR REPLACE INTO gameweeks
            (fpl_id, name, deadline_time, average_entry_score, highest_score,
             highest_scoring_entry, is_current, is_next, is_finished,
             chip_plays, most_selected, most_transferred_in,
             most_captained, most_vice_captained, transfers_made, scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """
        with self._conn:
            self._conn.executemany(sql, [gw.to_db_tuple() for gw in gameweeks])
        logger.debug("Upserted %d gameweeks", len(gameweeks))
        return len(gameweeks)

    def upsert_players(self, players: list[Player]) -> int:
        sql = """
        INSERT OR REPLACE INTO players
            (fpl_id, first_name, second_name, web_name, team_fpl_id, element_type,
             status, code, now_cost, cost_change_start, cost_change_event,
             chance_of_playing_this_round, chance_of_playing_next_round,
             total_points, event_points, points_per_game, form, selected_by_percent,
             transfers_in, transfers_out, transfers_in_event, transfers_out_event,
             minutes, goals_scored, assists, clean_sheets, goals_conceded, own_goals,
             penalties_saved, penalties_missed, yellow_cards, red_cards, saves,
             bonus, bps, influence, creativity, threat, ict_index, starts,
             expected_goals, expected_assists, expected_goal_involvements,
             expected_goals_conceded, xgp, xap, xgip,
             news, news_added, squad_number, photo, scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """
        with self._conn:
            self._conn.executemany(sql, [p.to_db_tuple() for p in players])
        logger.debug("Upserted %d players", len(players))
        return len(players)

    def upsert_player_history(self, rows: list[PlayerHistory]) -> int:
        sql = """
        INSERT OR REPLACE INTO player_history
            (player_fpl_id, gameweek_fpl_id, opponent_team, was_home, kickoff_time,
             total_points, minutes, goals_scored, assists, clean_sheets,
             goals_conceded, own_goals, penalties_saved, penalties_missed,
             yellow_cards, red_cards, saves, bonus, bps,
             influence, creativity, threat, ict_index, starts,
             expected_goals, expected_assists, expected_goal_involvements,
             expected_goals_conceded, xgp, xap, xgip,
             value, transfers_balance, selected,
             transfers_in, transfers_out, round, scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """
        with self._conn:
            self._conn.executemany(sql, [r.to_db_tuple() for r in rows])
        logger.debug("Upserted %d player_history rows", len(rows))
        return len(rows)

    def upsert_player_history_past(self, rows: list[PlayerHistoryPast]) -> int:
        sql = """
        INSERT OR REPLACE INTO player_history_past
            (player_fpl_id, season_name, element_code, start_cost, end_cost,
             total_points, minutes, goals_scored, assists, clean_sheets,
             goals_conceded, own_goals, penalties_saved, penalties_missed,
             yellow_cards, red_cards, saves, bonus, bps,
             influence, creativity, threat, ict_index, starts,
             expected_goals, expected_assists, expected_goal_involvements,
             expected_goals_conceded, scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """
        with self._conn:
            self._conn.executemany(sql, [r.to_db_tuple() for r in rows])
        logger.debug("Upserted %d player_history_past rows", len(rows))
        return len(rows)

    def upsert_fixtures(self, fixtures: list[Fixture]) -> int:
        sql = """
        INSERT OR REPLACE INTO fixtures
            (fpl_id, gameweek_fpl_id, kickoff_time,
             team_h_fpl_id, team_a_fpl_id, team_h_score, team_a_score,
             finished, finished_provisional, started, minutes,
             team_h_difficulty, team_a_difficulty, code, pulse_id, stats,
             scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """
        with self._conn:
            self._conn.executemany(sql, [f.to_db_tuple() for f in fixtures])
        logger.debug("Upserted %d fixtures", len(fixtures))
        return len(fixtures)

    def upsert_live_stats(self, rows: list[LiveGameweekStats]) -> int:
        sql = """
        INSERT OR REPLACE INTO live_gameweek_stats
            (player_fpl_id, gameweek_fpl_id, minutes, goals_scored, assists,
             clean_sheets, goals_conceded, own_goals, penalties_saved, penalties_missed,
             yellow_cards, red_cards, saves, bonus, bps,
             influence, creativity, threat, ict_index, starts,
             expected_goals, expected_assists, expected_goal_involvements,
             expected_goals_conceded, total_points, in_dreamteam, explain,
             scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """
        with self._conn:
            self._conn.executemany(sql, [r.to_db_tuple() for r in rows])
        logger.debug("Upserted %d live_gameweek_stats rows", len(rows))
        return len(rows)

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def get_all_player_fpl_ids(self) -> list[int]:
        cur = self._conn.execute("SELECT fpl_id FROM players ORDER BY fpl_id")
        return [row[0] for row in cur.fetchall()]

    def get_current_gameweek(self) -> sqlite3.Row | None:
        cur = self._conn.execute(
            "SELECT * FROM gameweeks WHERE is_current = 1 LIMIT 1"
        )
        return cur.fetchone()

    def get_next_gameweek(self) -> sqlite3.Row | None:
        cur = self._conn.execute(
            "SELECT * FROM gameweeks WHERE is_next = 1 LIMIT 1"
        )
        return cur.fetchone()

    def get_gameweek_by_id(self, gw_id: int) -> sqlite3.Row | None:
        cur = self._conn.execute(
            "SELECT * FROM gameweeks WHERE fpl_id = ? LIMIT 1", (gw_id,)
        )
        return cur.fetchone()

    def get_active_player_ids_in_gw(self, gameweek_fpl_id: int) -> list[int]:
        """Return player_fpl_ids where the player had minutes > 0 in the live stats."""
        cur = self._conn.execute(
            "SELECT DISTINCT player_fpl_id FROM live_gameweek_stats "
            "WHERE gameweek_fpl_id = ? AND minutes > 0",
            (gameweek_fpl_id,),
        )
        return [row[0] for row in cur.fetchall()]

    def get_last_successful_scrape(self, mode: str) -> sqlite3.Row | None:
        cur = self._conn.execute(
            "SELECT * FROM scrape_log WHERE mode = ? AND status = 'success' "
            "ORDER BY finished_at DESC LIMIT 1",
            (mode,),
        )
        return cur.fetchone()

    # ------------------------------------------------------------------
    # Scrape log
    # ------------------------------------------------------------------

    def start_scrape_log(
        self, run_id: str, mode: str, gw_id: int | None, started_at: str
    ) -> None:
        sql = """
        INSERT INTO scrape_log (run_id, mode, gameweek_fpl_id, started_at, status)
        VALUES (?, ?, ?, ?, 'running')
        """
        with self._conn:
            self._conn.execute(sql, (run_id, mode, gw_id, started_at))

    def finish_scrape_log(
        self,
        run_id: str,
        status: str,
        players: int,
        requests: int,
        errors: int,
        finished_at: str,
        error_detail: str | None = None,
    ) -> None:
        sql = """
        UPDATE scrape_log
        SET status = ?, players_scraped = ?, requests_made = ?,
            errors_encountered = ?, finished_at = ?, error_detail = ?
        WHERE run_id = ?
        """
        with self._conn:
            self._conn.execute(
                sql, (status, players, requests, errors, finished_at, error_detail, run_id)
            )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        self._conn.close()
        logger.debug("Database connection closed")

    def __enter__(self) -> "FPLDatabase":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

"""Tests for src/database.py"""
import json
import sqlite3
import tempfile
from pathlib import Path

import pytest

from src.database import FPLDatabase
from src.models import (
    Fixture,
    Gameweek,
    LiveGameweekStats,
    Player,
    PlayerHistory,
    PlayerHistoryPast,
    Team,
)
from src.transform import (
    transform_bootstrap,
    transform_element_summary,
    transform_event_live,
    transform_fixtures,
)

FIXTURES = Path(__file__).parent / "fixtures"


def load(filename: str) -> dict | list:
    return json.loads((FIXTURES / filename).read_text())


@pytest.fixture
def db(tmp_path):
    """Provide a fresh in-memory-style database for each test."""
    db_file = str(tmp_path / "test.db")
    database = FPLDatabase(db_file)
    database.initialize_schema()
    yield database
    database.close()


class TestSchemaInit:
    def test_tables_created(self, db):
        cur = db._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        tables = {row[0] for row in cur.fetchall()}
        expected = {
            "teams", "gameweeks", "players", "player_history",
            "player_history_past", "fixtures", "live_gameweek_stats", "scrape_log",
        }
        assert expected.issubset(tables)

    def test_idempotent(self, db):
        """Calling initialize_schema twice should not raise."""
        db.initialize_schema()


class TestUpsertTeams:
    def test_insert(self, db):
        data = load("bootstrap_static.json")
        teams, _, _ = transform_bootstrap(data)
        count = db.upsert_teams(teams)
        assert count == 1
        cur = db._conn.execute("SELECT fpl_id, name FROM teams WHERE fpl_id = 1")
        row = cur.fetchone()
        assert row["name"] == "Arsenal"

    def test_upsert_updates_existing(self, db):
        data = load("bootstrap_static.json")
        teams, _, _ = transform_bootstrap(data)
        db.upsert_teams(teams)
        # Modify and upsert again
        teams[0] = Team(
            fpl_id=1, name="Arsenal FC", short_name="ARS",
            strength=5, strength_overall_home=None, strength_overall_away=None,
            strength_attack_home=None, strength_attack_away=None,
            strength_defence_home=None, strength_defence_away=None, pulse_id=1,
        )
        db.upsert_teams(teams)
        cur = db._conn.execute("SELECT name FROM teams WHERE fpl_id = 1")
        assert cur.fetchone()["name"] == "Arsenal FC"


class TestUpsertPlayers:
    def test_insert_and_query(self, db):
        data = load("bootstrap_static.json")
        _, _, players = transform_bootstrap(data)
        db.upsert_players(players)
        ids = db.get_all_player_fpl_ids()
        assert 318 in ids

    def test_upsert_updates_cost(self, db):
        data = load("bootstrap_static.json")
        _, _, players = transform_bootstrap(data)
        db.upsert_players(players)
        # Simulate a price change
        p = players[0]
        updated = Player(
            fpl_id=p.fpl_id, first_name=p.first_name, second_name=p.second_name,
            web_name=p.web_name, team_fpl_id=p.team_fpl_id,
            element_type=p.element_type, status=p.status, code=p.code,
            now_cost=135,  # price rise
            cost_change_start=p.cost_change_start, cost_change_event=5,
            chance_of_playing_this_round=p.chance_of_playing_this_round,
            chance_of_playing_next_round=p.chance_of_playing_next_round,
            total_points=p.total_points, event_points=p.event_points,
            points_per_game=p.points_per_game, form=p.form,
            selected_by_percent=p.selected_by_percent,
            transfers_in=p.transfers_in, transfers_out=p.transfers_out,
            transfers_in_event=p.transfers_in_event,
            transfers_out_event=p.transfers_out_event,
            minutes=p.minutes, goals_scored=p.goals_scored, assists=p.assists,
            clean_sheets=p.clean_sheets, goals_conceded=p.goals_conceded,
            own_goals=p.own_goals, penalties_saved=p.penalties_saved,
            penalties_missed=p.penalties_missed, yellow_cards=p.yellow_cards,
            red_cards=p.red_cards, saves=p.saves, bonus=p.bonus, bps=p.bps,
            influence=p.influence, creativity=p.creativity,
            threat=p.threat, ict_index=p.ict_index, starts=p.starts,
            expected_goals=p.expected_goals, expected_assists=p.expected_assists,
            expected_goal_involvements=p.expected_goal_involvements,
            expected_goals_conceded=p.expected_goals_conceded,
            xgp=p.xgp, xap=p.xap, xgip=p.xgip,
            news=p.news, news_added=p.news_added, squad_number=p.squad_number,
            photo=p.photo,
        )
        db.upsert_players([updated])
        cur = db._conn.execute("SELECT now_cost FROM players WHERE fpl_id = 318")
        assert cur.fetchone()["now_cost"] == 135


class TestUpsertPlayerHistory:
    def test_insert(self, db):
        data = load("bootstrap_static.json")
        _, _, players = transform_bootstrap(data)
        db.upsert_players(players)

        summary_data = load("element_summary_318.json")
        history, history_past = transform_element_summary(318, summary_data)
        db.upsert_player_history(history)
        db.upsert_player_history_past(history_past)

        cur = db._conn.execute(
            "SELECT total_points FROM player_history WHERE player_fpl_id = 318 AND gameweek_fpl_id = 24"
        )
        assert cur.fetchone()["total_points"] == 14

        cur = db._conn.execute(
            "SELECT season_name FROM player_history_past WHERE player_fpl_id = 318"
        )
        assert cur.fetchone()["season_name"] == "2023/24"

    def test_upsert_is_idempotent(self, db):
        summary_data = load("element_summary_318.json")
        history, _ = transform_element_summary(318, summary_data)
        db.upsert_player_history(history)
        db.upsert_player_history(history)  # second time should not raise
        cur = db._conn.execute("SELECT count(*) as n FROM player_history WHERE player_fpl_id = 318")
        assert cur.fetchone()["n"] == 1


class TestUpsertFixtures:
    def test_insert(self, db):
        fixtures_data = load("fixtures.json")
        fixtures = transform_fixtures(fixtures_data)
        db.upsert_fixtures(fixtures)
        cur = db._conn.execute("SELECT fpl_id FROM fixtures WHERE fpl_id = 1")
        assert cur.fetchone() is not None


class TestUpsertLiveStats:
    def test_insert(self, db):
        live_data = load("event_25_live.json")
        rows = transform_event_live(25, live_data)
        db.upsert_live_stats(rows)
        cur = db._conn.execute(
            "SELECT total_points FROM live_gameweek_stats "
            "WHERE player_fpl_id = 318 AND gameweek_fpl_id = 25"
        )
        assert cur.fetchone()["total_points"] == 12


class TestGameweekQueries:
    def test_get_current_gameweek(self, db):
        data = load("bootstrap_static.json")
        _, gameweeks, _ = transform_bootstrap(data)
        db.upsert_gameweeks(gameweeks)
        gw = db.get_current_gameweek()
        assert gw is not None
        assert gw["fpl_id"] == 25

    def test_get_current_gameweek_returns_none_when_empty(self, db):
        assert db.get_current_gameweek() is None


class TestScrapeLog:
    def test_start_and_finish(self, db):
        db.start_scrape_log("run-abc", "full_sync", None, "2025-01-01T00:00:00Z")
        db.finish_scrape_log(
            "run-abc", "success", 700, 750, 0, "2025-01-01T01:30:00Z"
        )
        cur = db._conn.execute(
            "SELECT status, players_scraped FROM scrape_log WHERE run_id = 'run-abc'"
        )
        row = cur.fetchone()
        assert row["status"] == "success"
        assert row["players_scraped"] == 700

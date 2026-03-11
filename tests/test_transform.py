"""Tests for src/transform.py"""
import json
from pathlib import Path

import pytest

from src.transform import (
    transform_bootstrap,
    transform_element_summary,
    transform_event_live,
    transform_fixtures,
)

FIXTURES = Path(__file__).parent / "fixtures"


def load(filename: str) -> dict | list:
    return json.loads((FIXTURES / filename).read_text())


class TestTransformBootstrap:
    def test_returns_correct_counts(self):
        data = load("bootstrap_static.json")
        teams, gameweeks, players = transform_bootstrap(data)
        assert len(teams) == 1
        assert len(gameweeks) == 2
        assert len(players) == 1

    def test_team_fields(self):
        data = load("bootstrap_static.json")
        teams, _, _ = transform_bootstrap(data)
        t = teams[0]
        assert t.fpl_id == 1
        assert t.name == "Arsenal"
        assert t.short_name == "ARS"
        assert t.strength == 4

    def test_gameweek_flags(self):
        data = load("bootstrap_static.json")
        _, gameweeks, _ = transform_bootstrap(data)
        current = next(gw for gw in gameweeks if gw.is_current)
        assert current.fpl_id == 25
        finished = next(gw for gw in gameweeks if gw.is_finished)
        assert finished.fpl_id == 1

    def test_player_fields(self):
        data = load("bootstrap_static.json")
        _, _, players = transform_bootstrap(data)
        p = players[0]
        assert p.fpl_id == 318
        assert p.web_name == "Salah"
        assert p.now_cost == 130
        assert p.total_points == 185
        assert p.element_type == 3

    def test_player_numeric_string_fields(self):
        data = load("bootstrap_static.json")
        _, _, players = transform_bootstrap(data)
        p = players[0]
        # These stay as strings (FPL returns them as strings)
        assert p.form == "12.8"
        assert p.selected_by_percent == "45.2"
        assert p.expected_goals == "15.34"

    def test_missing_optional_fields(self):
        """Bootstrap with minimal required fields should not raise."""
        data = {
            "teams": [{"id": 1, "name": "Test FC", "short_name": "TST"}],
            "events": [],
            "elements": [],
        }
        teams, gameweeks, players = transform_bootstrap(data)
        assert len(teams) == 1
        assert teams[0].strength is None

    def test_malformed_player_is_skipped(self):
        """A player missing required 'id' field should be skipped, not raise."""
        data = {
            "teams": [],
            "events": [],
            "elements": [
                {"web_name": "NoId", "team": 1, "element_type": 3}  # missing id
            ],
        }
        _, _, players = transform_bootstrap(data)
        assert len(players) == 0


class TestTransformElementSummary:
    def test_history_row_count(self):
        data = load("element_summary_318.json")
        history, history_past = transform_element_summary(318, data)
        assert len(history) == 1
        assert len(history_past) == 1

    def test_history_fields(self):
        data = load("element_summary_318.json")
        history, _ = transform_element_summary(318, data)
        h = history[0]
        assert h.player_fpl_id == 318
        assert h.gameweek_fpl_id == 24
        assert h.total_points == 14
        assert h.goals_scored == 2
        assert h.was_home == 1

    def test_history_past_fields(self):
        data = load("element_summary_318.json")
        _, history_past = transform_element_summary(318, data)
        hp = history_past[0]
        assert hp.player_fpl_id == 318
        assert hp.season_name == "2023/24"
        assert hp.total_points == 229


class TestTransformFixtures:
    def test_fixture_count(self):
        data = load("fixtures.json")
        fixtures = transform_fixtures(data)
        assert len(fixtures) == 1

    def test_fixture_fields(self):
        data = load("fixtures.json")
        fixtures = transform_fixtures(data)
        f = fixtures[0]
        assert f.fpl_id == 1
        assert f.gameweek_fpl_id == 1
        assert f.team_h_fpl_id == 14
        assert f.team_a_fpl_id == 3
        assert f.finished == 1
        assert f.team_h_score == 1

    def test_fixture_stats_serialised_as_json(self):
        data = load("fixtures.json")
        fixtures = transform_fixtures(data)
        import json
        stats = json.loads(fixtures[0].stats)
        assert stats[0]["identifier"] == "goals_scored"


class TestTransformEventLive:
    def test_live_row_count(self):
        data = load("event_25_live.json")
        rows = transform_event_live(25, data)
        assert len(rows) == 1

    def test_live_fields(self):
        data = load("event_25_live.json")
        rows = transform_event_live(25, data)
        r = rows[0]
        assert r.player_fpl_id == 318
        assert r.gameweek_fpl_id == 25
        assert r.total_points == 12
        assert r.in_dreamteam == 1
        assert r.minutes == 90

    def test_explain_serialised_as_json(self):
        data = load("event_25_live.json")
        rows = transform_event_live(25, data)
        import json
        explain = json.loads(rows[0].explain)
        assert explain[0]["fixture"] == 290

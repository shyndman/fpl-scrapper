from __future__ import annotations

import json
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any

from src.database import FPLDatabase
from src.scraper import FPLNotFoundError
from src.sync import FPLSyncer
from src.transform import (
    transform_bootstrap,
    transform_element_summary,
    transform_event_live,
    transform_fixtures,
)

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


def pick(record: dict[str, Any], *keys: str) -> dict[str, Any]:
    return {key: record.get(key) for key in keys}


def normalize_model(model: Any) -> dict[str, Any]:
    data = asdict(model)
    data.pop("scraped_at", None)
    return data


class FixtureBackedApi:
    def __init__(self, *, missing_player_ids: set[int] | None = None) -> None:
        self._missing_player_ids = missing_player_ids or set()
        self._request_count = 0
        self._bootstrap = load_fixture("bootstrap_static.json")
        self._fixtures = load_fixture("fixtures.json")
        self._event_live = load_fixture("event_25_live.json")
        self._element_summary = load_fixture("element_summary_318.json")
        self._scraper = type("Scraper", (), {"request_count": 0})()

    def _tick(self) -> None:
        self._request_count += 1
        self._scraper.request_count = self._request_count

    def get_bootstrap_static(self) -> dict[str, Any]:
        self._tick()
        return json.loads(json.dumps(self._bootstrap))

    def get_fixtures(self, gameweek: int | None = None) -> list[dict[str, Any]]:
        self._tick()
        fixtures = json.loads(json.dumps(self._fixtures))
        if gameweek is None:
            return fixtures
        return [fixture for fixture in fixtures if fixture.get("event") == gameweek]

    def get_event_live(self, gameweek: int) -> dict[str, Any]:
        self._tick()
        if gameweek != 25:
            return {"elements": []}
        return json.loads(json.dumps(self._event_live))

    def get_element_summary(self, player_id: int) -> dict[str, Any]:
        self._tick()
        if player_id in self._missing_player_ids:
            raise FPLNotFoundError("404")
        if player_id != 318:
            raise FPLNotFoundError(f"404 Not Found: player {player_id}")
        return json.loads(json.dumps(self._element_summary))


def transform_payload() -> dict[str, Any]:
    teams, gameweeks, players = transform_bootstrap(load_fixture("bootstrap_static.json"))
    history, history_past = transform_element_summary(
        318, load_fixture("element_summary_318.json")
    )
    fixtures = transform_fixtures(load_fixture("fixtures.json"))
    live_rows = transform_event_live(25, load_fixture("event_25_live.json"))

    current_gameweek = next(gameweek for gameweek in gameweeks if gameweek.is_current)

    return {
        "bootstrap": {
            "counts": {
                "teams": len(teams),
                "gameweeks": len(gameweeks),
                "players": len(players),
            },
            "team": pick(
                normalize_model(teams[0]),
                "fpl_id",
                "name",
                "short_name",
                "strength",
            ),
            "current_gameweek": pick(
                normalize_model(current_gameweek),
                "fpl_id",
                "name",
                "deadline_time",
                "is_current",
                "is_finished",
                "chip_plays",
            ),
            "player": pick(
                normalize_model(players[0]),
                "fpl_id",
                "web_name",
                "team_fpl_id",
                "element_type",
                "now_cost",
                "total_points",
                "form",
                "selected_by_percent",
                "expected_goals",
                "expected_assists",
                "expected_goal_involvements",
                "expected_goals_conceded",
                "xgp",
                "xap",
                "xgip",
                "defensive_contribution",
                "defensive_contribution_per_90",
            ),
        },
        "element_summary": {
            "history": pick(
                normalize_model(history[0]),
                "player_fpl_id",
                "gameweek_fpl_id",
                "total_points",
                "goals_scored",
                "assists",
                "expected_goals",
                "expected_assists",
                "expected_goal_involvements",
                "expected_goals_conceded",
                "xgp",
                "xap",
                "xgip",
                "value",
                "selected",
            ),
            "history_past": pick(
                normalize_model(history_past[0]),
                "player_fpl_id",
                "season_name",
                "total_points",
                "expected_goals",
                "expected_assists",
                "expected_goal_involvements",
                "expected_goals_conceded",
            ),
        },
        "fixtures": {
            "fixture": {
                **pick(
                    normalize_model(fixtures[0]),
                    "fpl_id",
                    "gameweek_fpl_id",
                    "team_h_fpl_id",
                    "team_a_fpl_id",
                    "finished",
                    "team_h_score",
                    "team_a_score",
                ),
                "stats": json.loads(fixtures[0].stats),
            }
        },
        "event_live": {
            "row": {
                **pick(
                    normalize_model(live_rows[0]),
                    "player_fpl_id",
                    "gameweek_fpl_id",
                    "total_points",
                    "in_dreamteam",
                    "minutes",
                    "influence",
                    "expected_goals_conceded",
                ),
                "explain": json.loads(live_rows[0].explain),
            }
        },
    }


def query_one(conn: Any, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    row = conn.execute(sql, params).fetchone()
    if row is None:
        return None
    return dict(row)


def sync_payload(mode: str) -> dict[str, Any]:
    if mode not in {"success", "partial"}:
        raise ValueError(f"Unsupported sync mode: {mode}")

    with tempfile.TemporaryDirectory(prefix="fpl-python-oracle-") as temp_dir:
        db = FPLDatabase(str(Path(temp_dir) / "oracle.db"))
        db.initialize_schema()
        api = FixtureBackedApi(
            missing_player_ids={318} if mode == "partial" else set()
        )
        try:
            result = FPLSyncer(api=api, db=db, dry_run=False).full_sync()
            payload = {
                "result": {
                    "mode": result.mode,
                    "players_synced": result.players_synced,
                    "requests_made": result.requests_made,
                    "errors": result.errors,
                    "warnings": result.warnings,
                    "summary": result.summary(),
                },
                "db": {
                    "player_ids": db.get_all_player_fpl_ids(),
                    "player_history": query_one(
                        db._conn,
                        "SELECT player_fpl_id, gameweek_fpl_id, total_points, xgp, xap, xgip FROM player_history ORDER BY player_fpl_id, gameweek_fpl_id LIMIT 1",
                    ),
                    "player_history_past": query_one(
                        db._conn,
                        "SELECT player_fpl_id, season_name, total_points FROM player_history_past ORDER BY player_fpl_id, season_name LIMIT 1",
                    ),
                    "fixture": query_one(
                        db._conn,
                        "SELECT fpl_id, gameweek_fpl_id, team_h_fpl_id, team_a_fpl_id, finished, team_h_score, team_a_score, stats FROM fixtures ORDER BY fpl_id LIMIT 1",
                    ),
                    "live": query_one(
                        db._conn,
                        "SELECT player_fpl_id, gameweek_fpl_id, total_points, in_dreamteam, minutes, influence, expected_goals_conceded, explain FROM live_gameweek_stats ORDER BY player_fpl_id, gameweek_fpl_id LIMIT 1",
                    ),
                    "scrape_log": query_one(
                        db._conn,
                        "SELECT mode, gameweek_fpl_id, status, players_scraped, requests_made, errors_encountered, error_detail FROM scrape_log ORDER BY id DESC LIMIT 1",
                    ),
                    "counts": {
                        "teams": db._conn.execute("SELECT COUNT(*) FROM teams").fetchone()[0],
                        "gameweeks": db._conn.execute("SELECT COUNT(*) FROM gameweeks").fetchone()[0],
                        "players": db._conn.execute("SELECT COUNT(*) FROM players").fetchone()[0],
                        "player_history": db._conn.execute("SELECT COUNT(*) FROM player_history").fetchone()[0],
                        "player_history_past": db._conn.execute("SELECT COUNT(*) FROM player_history_past").fetchone()[0],
                        "fixtures": db._conn.execute("SELECT COUNT(*) FROM fixtures").fetchone()[0],
                        "live_gameweek_stats": db._conn.execute("SELECT COUNT(*) FROM live_gameweek_stats").fetchone()[0],
                    },
                },
            }
        finally:
            db.close()

    fixture = payload["db"]["fixture"]
    if fixture is not None and fixture["stats"] is not None:
        fixture["stats"] = json.loads(fixture["stats"])

    live = payload["db"]["live"]
    if live is not None and live["explain"] is not None:
        live["explain"] = json.loads(live["explain"])

    return payload


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python tests/python_oracle.py <transform|sync-success|sync-partial>")

    command = sys.argv[1]
    if command == "transform":
        payload = transform_payload()
    elif command == "sync-success":
        payload = sync_payload("success")
    elif command == "sync-partial":
        payload = sync_payload("partial")
    else:
        raise SystemExit(f"Unknown oracle command: {command}")

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

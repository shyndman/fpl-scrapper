"""Tests for src/sync.py — orchestration logic."""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.api import FPLAPI
from src.database import FPLDatabase
from src.scraper import FPLAPIError, FPLNotFoundError
from src.sync import FPLSyncer, _find_current_gw
from src.transform import transform_bootstrap

FIXTURES = Path(__file__).parent / "fixtures"


def load(filename: str) -> dict | list:
    return json.loads((FIXTURES / filename).read_text())


@pytest.fixture
def db(tmp_path):
    db_file = str(tmp_path / "test_sync.db")
    database = FPLDatabase(db_file)
    database.initialize_schema()
    yield database
    database.close()


@pytest.fixture
def mock_api():
    api = MagicMock(spec=FPLAPI)
    api._scraper = MagicMock()
    api._scraper.request_count = 10

    api.get_bootstrap_static.return_value = load("bootstrap_static.json")
    api.get_fixtures.return_value = load("fixtures.json")
    api.get_event_live.return_value = load("event_25_live.json")
    api.get_element_summary.return_value = load("element_summary_318.json")
    return api


class TestFindCurrentGw:
    def test_finds_current_gameweek(self):
        data = load("bootstrap_static.json")
        _, gameweeks, _ = transform_bootstrap(data)
        gw_id = _find_current_gw(gameweeks)
        assert gw_id == 25

    def test_falls_back_to_most_recent_finished(self):
        data = load("bootstrap_static.json")
        _, gameweeks, _ = transform_bootstrap(data)
        # Remove is_current flag
        for gw in gameweeks:
            gw.is_current = 0
        gw_id = _find_current_gw(gameweeks)
        assert gw_id == 1  # only GW1 is finished in fixture data


class TestFullSync:
    def test_full_sync_dry_run(self, db, mock_api):
        syncer = FPLSyncer(api=mock_api, db=db, dry_run=True)
        result = syncer.full_sync()
        assert result.mode == "full_sync"
        assert result.players_synced == 1
        assert result.errors == 0
        # In dry_run, no rows should be written
        assert db.get_all_player_fpl_ids() == []

    def test_full_sync_writes_to_db(self, db, mock_api):
        syncer = FPLSyncer(api=mock_api, db=db, dry_run=False)
        result = syncer.full_sync()
        assert result.players_synced == 1
        assert 318 in db.get_all_player_fpl_ids()

    def test_full_sync_tolerates_player_not_found(self, db, mock_api):
        """A 404 on element-summary should not abort the sync."""
        mock_api.get_element_summary.side_effect = FPLNotFoundError("404")
        syncer = FPLSyncer(api=mock_api, db=db, dry_run=True)
        result = syncer.full_sync()
        assert result.errors == 1
        assert result.players_synced == 0

    def test_full_sync_records_scrape_log(self, db, mock_api):
        syncer = FPLSyncer(api=mock_api, db=db, dry_run=False)
        syncer.full_sync()
        log = db.get_last_successful_scrape("full_sync")
        assert log is not None
        assert log["status"] == "success"


class TestGameweekSync:
    def test_gameweek_sync_explicit_gw(self, db, mock_api):
        # First populate DB with players so get_active_player_ids_in_gw works
        from src.transform import transform_bootstrap, transform_event_live
        teams, gameweeks, players = transform_bootstrap(load("bootstrap_static.json"))
        db.upsert_teams(teams)
        db.upsert_gameweeks(gameweeks)
        db.upsert_players(players)
        live_rows = transform_event_live(25, load("event_25_live.json"))
        db.upsert_live_stats(live_rows)

        syncer = FPLSyncer(api=mock_api, db=db, dry_run=False)
        result = syncer.gameweek_sync(gameweek_id=25)
        assert result.gameweek_id == 25
        assert result.errors == 0

    def test_gameweek_sync_auto_detects_current(self, db, mock_api):
        from src.transform import transform_bootstrap
        _, gameweeks, _ = transform_bootstrap(load("bootstrap_static.json"))
        db.upsert_gameweeks(gameweeks)

        syncer = FPLSyncer(api=mock_api, db=db, dry_run=True)
        result = syncer.gameweek_sync(gameweek_id=None)
        assert result.gameweek_id == 25

    def test_gameweek_sync_raises_when_no_db_gw(self, db, mock_api):
        """If DB has no gameweeks and no gameweek_id supplied, should raise."""
        syncer = FPLSyncer(api=mock_api, db=db, dry_run=True)
        with pytest.raises(ValueError, match="No current gameweek"):
            syncer.gameweek_sync(gameweek_id=None)

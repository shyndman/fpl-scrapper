"""
Typed wrappers for every FPL API endpoint.
Returns raw dicts/lists — no transformation or modelling here.
"""
from __future__ import annotations

import logging
from typing import Any

from src.scraper import FPLScraper

logger = logging.getLogger(__name__)


class FPLAPI:
    """
    Thin wrappers over FPLScraper.get() for each known endpoint.
    Endpoints are documented in docs/API.md.
    """

    def __init__(self, scraper: FPLScraper) -> None:
        self._scraper = scraper

    # ------------------------------------------------------------------
    # Public endpoints (no authentication required)
    # ------------------------------------------------------------------

    def get_bootstrap_static(self) -> dict[str, Any]:
        """
        GET /api/bootstrap-static/

        Returns the master data snapshot: all players (elements), teams,
        gameweeks (events), element types (positions), and game settings.

        Key keys: events, teams, elements, element_types, element_stats,
                  game_settings, phases, total_players
        """
        logger.debug("Fetching bootstrap-static")
        return self._scraper.get("bootstrap-static")

    def get_element_summary(self, player_id: int) -> dict[str, Any]:
        """
        GET /api/element-summary/{player_id}/

        Returns per-player data:
          history      – current season, one dict per gameweek played
          history_past – one dict per prior season
          fixtures     – upcoming fixtures with difficulty ratings
        """
        logger.debug("Fetching element-summary for player %d", player_id)
        return self._scraper.get(f"element-summary/{player_id}")

    def get_event_live(self, gameweek: int) -> dict[str, Any]:
        """
        GET /api/event/{gameweek}/live/

        Returns live/provisional stats for every player in the given gameweek.
        Key: elements — list of {id, stats, explain}
        """
        logger.debug("Fetching live stats for GW%d", gameweek)
        return self._scraper.get(f"event/{gameweek}/live")

    def get_fixtures(self, gameweek: int | None = None) -> list[dict[str, Any]]:
        """
        GET /api/fixtures/
        GET /api/fixtures/?event={gameweek}

        Returns all fixtures, or just those for a specific gameweek.
        """
        params = {"event": gameweek} if gameweek is not None else None
        logger.debug(
            "Fetching fixtures%s", f" for GW{gameweek}" if gameweek else ""
        )
        result = self._scraper.get("fixtures", params=params)
        return result if isinstance(result, list) else []

    # ------------------------------------------------------------------
    # Authenticated endpoints (require FPL login cookies)
    # ------------------------------------------------------------------

    def get_my_team(self, entry_id: int) -> dict[str, Any]:
        """
        GET /api/my-team/{entry_id}/   (requires auth)

        Returns the user's current team picks and chip state.
        """
        logger.debug("Fetching my-team for entry %d", entry_id)
        return self._scraper.get(f"my-team/{entry_id}", requires_auth=True)

    def get_entry(self, entry_id: int) -> dict[str, Any]:
        """
        GET /api/entry/{entry_id}/   (requires auth)

        Returns manager info: name, overall rank, points, leagues.
        """
        logger.debug("Fetching entry %d", entry_id)
        return self._scraper.get(f"entry/{entry_id}", requires_auth=True)

    def get_entry_event_picks(self, entry_id: int, gameweek: int) -> dict[str, Any]:
        """
        GET /api/entry/{entry_id}/event/{gameweek}/picks/   (requires auth)

        Returns the manager's 15-player squad for a specific gameweek.
        """
        logger.debug("Fetching picks for entry %d GW%d", entry_id, gameweek)
        return self._scraper.get(
            f"entry/{entry_id}/event/{gameweek}/picks", requires_auth=True
        )

    # ------------------------------------------------------------------
    # Discovery helper
    # ------------------------------------------------------------------

    def discover(self) -> dict[str, Any]:
        """
        Probe all public endpoints and return their top-level keys.
        Used by --discover-api CLI flag; does NOT write to the database.
        """
        import json

        results: dict[str, Any] = {}

        def _probe(name: str, fn, *args) -> None:  # type: ignore[no-untyped-def]
            try:
                data = fn(*args)
                if isinstance(data, dict):
                    results[name] = {
                        "type": "dict",
                        "keys": list(data.keys()),
                    }
                elif isinstance(data, list):
                    results[name] = {
                        "type": "list",
                        "length": len(data),
                        "sample_keys": list(data[0].keys()) if data else [],
                    }
            except Exception as exc:
                results[name] = {"error": str(exc)}

        _probe("bootstrap-static", self.get_bootstrap_static)
        _probe("fixtures", self.get_fixtures)

        # Probe element-summary for player ID 1 (usually a real player)
        _probe("element-summary/1", self.get_element_summary, 1)

        # Determine current gameweek from bootstrap for event/live probe
        try:
            bootstrap = self.get_bootstrap_static()
            current_gw = next(
                (e["id"] for e in bootstrap.get("events", []) if e.get("is_current")),
                1,
            )
            _probe(f"event/{current_gw}/live", self.get_event_live, current_gw)
        except Exception as exc:
            results["event/live"] = {"error": str(exc)}

        return results

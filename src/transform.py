"""
Converts raw FPL API dicts into typed model instances.
All data cleaning and normalisation lives here, keeping models.py and
database.py free of business logic.
"""
from __future__ import annotations

import logging
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


def transform_bootstrap(
    data: dict[str, Any],
) -> tuple[list[Team], list[Gameweek], list[Player]]:
    """
    Parse the bootstrap-static response into Teams, Gameweeks, and Players.

    Args:
        data: Raw dict from FPLAPI.get_bootstrap_static()

    Returns:
        (teams, gameweeks, players)
    """
    teams: list[Team] = []
    for raw in data.get("teams", []):
        try:
            teams.append(Team.from_dict(raw))
        except Exception as exc:
            logger.warning("Skipping malformed team %s: %s", raw.get("id"), exc)

    gameweeks: list[Gameweek] = []
    for raw in data.get("events", []):
        try:
            gameweeks.append(Gameweek.from_dict(raw))
        except Exception as exc:
            logger.warning("Skipping malformed gameweek %s: %s", raw.get("id"), exc)

    players: list[Player] = []
    for raw in data.get("elements", []):
        try:
            players.append(Player.from_dict(raw))
        except Exception as exc:
            logger.warning("Skipping malformed player %s: %s", raw.get("id"), exc)

    logger.debug(
        "Transformed bootstrap: %d teams, %d gameweeks, %d players",
        len(teams), len(gameweeks), len(players),
    )
    return teams, gameweeks, players


def transform_element_summary(
    player_fpl_id: int,
    data: dict[str, Any],
) -> tuple[list[PlayerHistory], list[PlayerHistoryPast]]:
    """
    Parse an element-summary response for a single player.

    Args:
        player_fpl_id: The FPL ID of the player this summary belongs to.
        data: Raw dict from FPLAPI.get_element_summary(player_id)

    Returns:
        (history, history_past)
    """
    history: list[PlayerHistory] = []
    for raw in data.get("history", []):
        try:
            history.append(PlayerHistory.from_dict(player_fpl_id, raw))
        except Exception as exc:
            logger.warning(
                "Skipping malformed history row for player %d (GW %s): %s",
                player_fpl_id, raw.get("round"), exc,
            )

    history_past: list[PlayerHistoryPast] = []
    for raw in data.get("history_past", []):
        try:
            history_past.append(PlayerHistoryPast.from_dict(player_fpl_id, raw))
        except Exception as exc:
            logger.warning(
                "Skipping malformed history_past row for player %d (%s): %s",
                player_fpl_id, raw.get("season_name"), exc,
            )

    return history, history_past


def transform_fixtures(data: list[dict[str, Any]]) -> list[Fixture]:
    """
    Parse the fixtures list response.

    Args:
        data: Raw list from FPLAPI.get_fixtures()
    """
    fixtures: list[Fixture] = []
    for raw in data:
        try:
            fixtures.append(Fixture.from_dict(raw))
        except Exception as exc:
            logger.warning("Skipping malformed fixture %s: %s", raw.get("id"), exc)
    logger.debug("Transformed %d fixtures", len(fixtures))
    return fixtures


def transform_event_live(
    gameweek_fpl_id: int,
    data: dict[str, Any],
) -> list[LiveGameweekStats]:
    """
    Parse the event/{gw}/live response.

    Args:
        gameweek_fpl_id: The gameweek number (used to populate the foreign key).
        data: Raw dict from FPLAPI.get_event_live(gameweek)
    """
    rows: list[LiveGameweekStats] = []
    for element in data.get("elements", []):
        try:
            player_fpl_id = int(element["id"])
            rows.append(
                LiveGameweekStats.from_dict(player_fpl_id, gameweek_fpl_id, element)
            )
        except Exception as exc:
            logger.warning(
                "Skipping malformed live stats for element %s: %s",
                element.get("id"), exc,
            )
    logger.debug("Transformed %d live stats rows for GW%d", len(rows), gameweek_fpl_id)
    return rows

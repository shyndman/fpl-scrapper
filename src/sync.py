"""
Orchestration layer.
Sequences API calls, transformations, and DB upserts for each sync mode.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from src.api import FPLAPI
from src.database import FPLDatabase
from src.scraper import FPLAPIError, FPLNotFoundError
from src.transform import (
    transform_bootstrap,
    transform_element_summary,
    transform_event_live,
    transform_fixtures,
)

logger = logging.getLogger(__name__)


@dataclass
class SyncResult:
    mode: str
    players_synced: int = 0
    requests_made: int = 0
    errors: int = 0
    gameweek_id: int | None = None
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> str:
        parts = [
            f"mode={self.mode}",
            f"players={self.players_synced}",
            f"requests={self.requests_made}",
            f"errors={self.errors}",
        ]
        if self.gameweek_id:
            parts.insert(1, f"gw={self.gameweek_id}")
        return " ".join(parts)


class FPLSyncer:
    """
    Coordinates the full-sync and gameweek-sync pipelines.
    All public methods are idempotent — safe to re-run on failure.
    """

    def __init__(self, api: FPLAPI, db: FPLDatabase, dry_run: bool = False) -> None:
        self._api = api
        self._db = db
        self._dry_run = dry_run

    # ------------------------------------------------------------------
    # Full sync (~700+ requests, ~30-40 min with rate limiting)
    # ------------------------------------------------------------------

    def full_sync(self) -> SyncResult:
        """
        Scrapes everything: teams, gameweeks, all players, all player history,
        fixtures, and live stats for the most recent gameweek.
        """
        result = SyncResult(mode="full_sync")
        run_id = str(uuid.uuid4())
        started_at = _utcnow()

        logger.info("Starting full sync (run_id=%s)", run_id)
        if not self._dry_run:
            self._db.start_scrape_log(run_id, "full_sync", None, started_at)

        try:
            # 1. Bootstrap: teams, gameweeks, players
            logger.info("[1/5] Fetching bootstrap-static…")
            bootstrap = self._api.get_bootstrap_static()
            teams, gameweeks, players = transform_bootstrap(bootstrap)

            if not self._dry_run:
                self._db.upsert_teams(teams)
                self._db.upsert_gameweeks(gameweeks)
                self._db.upsert_players(players)

            logger.info(
                "Bootstrap: %d teams, %d gameweeks, %d players",
                len(teams), len(gameweeks), len(players),
            )

            # 2. Fixtures
            logger.info("[2/5] Fetching all fixtures…")
            raw_fixtures = self._api.get_fixtures()
            fixtures = transform_fixtures(raw_fixtures)
            if not self._dry_run:
                self._db.upsert_fixtures(fixtures)
            logger.info("Fixtures: %d records", len(fixtures))

            # 3. Live stats for current/latest finished gameweek
            current_gw = _find_current_gw(gameweeks)
            if current_gw is not None:
                logger.info("[3/5] Fetching live stats for GW%d…", current_gw)
                raw_live = self._api.get_event_live(current_gw)
                live_rows = transform_event_live(current_gw, raw_live)
                if not self._dry_run:
                    self._db.upsert_live_stats(live_rows)
                logger.info("Live stats: %d rows for GW%d", len(live_rows), current_gw)
            else:
                logger.warning("[3/5] No current gameweek found — skipping live stats")

            # 4. Per-player element-summary (history + history_past)
            player_ids = [p.fpl_id for p in players]
            total = len(player_ids)
            logger.info("[4/5] Fetching element-summary for %d players…", total)

            for i, pid in enumerate(player_ids, start=1):
                try:
                    raw_summary = self._api.get_element_summary(pid)
                    history, history_past = transform_element_summary(pid, raw_summary)
                    if not self._dry_run:
                        self._db.upsert_player_history(history)
                        self._db.upsert_player_history_past(history_past)
                    result.players_synced += 1
                except FPLNotFoundError:
                    logger.warning("Player %d not found — skipping", pid)
                    result.errors += 1
                    result.warnings.append(f"Player {pid}: 404 Not Found")
                except FPLAPIError as exc:
                    logger.error("API error for player %d: %s", pid, exc)
                    result.errors += 1
                    result.warnings.append(f"Player {pid}: {exc}")

                if i % 50 == 0 or i == total:
                    logger.info("  Progress: %d/%d players scraped", i, total)

            logger.info("[5/5] Sync complete.")

        except Exception as exc:
            logger.exception("Fatal error during full sync: %s", exc)
            result.errors += 1
            if not self._dry_run:
                result.requests_made = self._api._scraper.request_count
                self._db.finish_scrape_log(
                    run_id, "error", result.players_synced,
                    result.requests_made, result.errors, _utcnow(), str(exc),
                )
            raise

        result.requests_made = self._api._scraper.request_count
        if not self._dry_run:
            status = "success" if result.errors == 0 else "partial"
            self._db.finish_scrape_log(
                run_id, status, result.players_synced,
                result.requests_made, result.errors, _utcnow(),
            )

        logger.info("Full sync finished: %s", result.summary())
        return result

    # ------------------------------------------------------------------
    # Gameweek sync (~50-150 requests, ~5-15 min)
    # ------------------------------------------------------------------

    def gameweek_sync(self, gameweek_id: int | None = None) -> SyncResult:
        """
        Incremental update for a single gameweek.
        If gameweek_id is None, auto-detects the current gameweek from the DB.
        """
        result = SyncResult(mode="gameweek_sync")
        run_id = str(uuid.uuid4())
        started_at = _utcnow()

        # Resolve gameweek
        if gameweek_id is None:
            gw_row = self._db.get_current_gameweek()
            if gw_row is None:
                raise ValueError(
                    "No current gameweek in the database. "
                    "Run --full-sync first, or specify --gameweek N."
                )
            gameweek_id = gw_row["fpl_id"]
            logger.info("Auto-detected current gameweek: GW%d", gameweek_id)

        result.gameweek_id = gameweek_id
        logger.info("Starting gameweek sync for GW%d (run_id=%s)", gameweek_id, run_id)
        if not self._dry_run:
            self._db.start_scrape_log(run_id, "gameweek_sync", gameweek_id, started_at)

        try:
            # 1. Bootstrap: update player prices, ownership, form, status
            logger.info("[1/4] Fetching bootstrap-static…")
            bootstrap = self._api.get_bootstrap_static()
            teams, gameweeks, players = transform_bootstrap(bootstrap)
            if not self._dry_run:
                self._db.upsert_teams(teams)
                self._db.upsert_gameweeks(gameweeks)
                self._db.upsert_players(players)
            logger.info("Bootstrap: %d players updated", len(players))

            # 2. Fixtures for this gameweek
            logger.info("[2/4] Fetching fixtures for GW%d…", gameweek_id)
            raw_fixtures = self._api.get_fixtures(gameweek=gameweek_id)
            fixtures = transform_fixtures(raw_fixtures)
            if not self._dry_run:
                self._db.upsert_fixtures(fixtures)
            logger.info("Fixtures: %d for GW%d", len(fixtures), gameweek_id)

            # 3. Live stats for this gameweek
            logger.info("[3/4] Fetching live stats for GW%d…", gameweek_id)
            raw_live = self._api.get_event_live(gameweek_id)
            live_rows = transform_event_live(gameweek_id, raw_live)
            if not self._dry_run:
                self._db.upsert_live_stats(live_rows)
            logger.info("Live stats: %d rows", len(live_rows))

            # 4. Per-player history for active players only (minutes > 0)
            active_ids: list[int]
            if self._dry_run:
                # In dry run, use player IDs from live rows
                active_ids = [row.player_fpl_id for row in live_rows if row.minutes > 0]
            else:
                active_ids = self._db.get_active_player_ids_in_gw(gameweek_id)

            total = len(active_ids)
            logger.info(
                "[4/4] Fetching element-summary for %d active players in GW%d…",
                total, gameweek_id,
            )

            for i, pid in enumerate(active_ids, start=1):
                try:
                    raw_summary = self._api.get_element_summary(pid)
                    history, _ = transform_element_summary(pid, raw_summary)
                    # Only upsert the row for this specific gameweek
                    gw_history = [h for h in history if h.gameweek_fpl_id == gameweek_id]
                    if not self._dry_run:
                        self._db.upsert_player_history(gw_history)
                    result.players_synced += 1
                except FPLNotFoundError:
                    logger.warning("Player %d not found — skipping", pid)
                    result.errors += 1
                except FPLAPIError as exc:
                    logger.error("API error for player %d: %s", pid, exc)
                    result.errors += 1

                if i % 25 == 0 or i == total:
                    logger.info("  Progress: %d/%d active players scraped", i, total)

        except Exception as exc:
            logger.exception("Fatal error during gameweek sync: %s", exc)
            result.errors += 1
            if not self._dry_run:
                result.requests_made = self._api._scraper.request_count
                self._db.finish_scrape_log(
                    run_id, "error", result.players_synced,
                    result.requests_made, result.errors, _utcnow(), str(exc),
                )
            raise

        result.requests_made = self._api._scraper.request_count
        if not self._dry_run:
            status = "success" if result.errors == 0 else "partial"
            self._db.finish_scrape_log(
                run_id, status, result.players_synced,
                result.requests_made, result.errors, _utcnow(),
            )

        logger.info("Gameweek sync finished: %s", result.summary())
        return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _find_current_gw(gameweeks) -> int | None:  # type: ignore[no-untyped-def]
    """Find is_current gameweek; fall back to most recent finished."""
    for gw in gameweeks:
        if gw.is_current:
            return gw.fpl_id
    # Fallback: highest finished GW
    finished = [gw for gw in gameweeks if gw.is_finished]
    if finished:
        return max(gw.fpl_id for gw in finished)
    return None

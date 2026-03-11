"""
CLI entrypoint for the FPL web scraper.
Wire up all dependencies and dispatch to the appropriate sync mode.

Usage:
    python -m src.main --full-sync
    python -m src.main --current-gameweek
    python -m src.main --gameweek 25
    python -m src.main --discover-api
    python -m src.main --full-sync --dry-run --log-level DEBUG
"""
from __future__ import annotations

import argparse
import json
import sys

import config.settings as settings
from src.api import FPLAPI
from src.auth import FPLAuth, FPLAuthError
from src.database import FPLDatabase
from src.logger import setup_logging
from src.scraper import FPLScraper
from src.sync import FPLSyncer

# Exit codes
EXIT_SUCCESS = 0
EXIT_PARTIAL = 1    # Some requests failed; DB was partially updated (re-run safe)
EXIT_FATAL = 2      # Auth, DB, or network failure; DB may be in an inconsistent state


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fpl-scraper",
        description="Fantasy Premier League player statistics scraper",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # First-time full scrape (~700 players, 30-40 min):
  python -m src.main --full-sync

  # Cron: update after each gameweek (auto-detects current GW):
  python -m src.main --current-gameweek

  # Re-run a specific gameweek:
  python -m src.main --gameweek 25

  # Explore API structure without writing to DB:
  python -m src.main --discover-api

  # Debug a gameweek sync without touching the database:
  python -m src.main --gameweek 25 --dry-run --log-level DEBUG

Exit codes:
  0  All data synced successfully
  1  Partial success (some players failed, DB partially updated — re-run is safe)
  2  Fatal error (auth failure, DB unreachable, network down)
        """,
    )

    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument(
        "--full-sync",
        action="store_true",
        help="Full scrape: all players, all history, teams, fixtures (~700 requests)",
    )
    mode_group.add_argument(
        "--current-gameweek",
        action="store_true",
        help="Incremental update for the current gameweek (auto-detected from DB)",
    )
    mode_group.add_argument(
        "--gameweek",
        type=int,
        metavar="N",
        help="Incremental update for gameweek N",
    )
    mode_group.add_argument(
        "--discover-api",
        action="store_true",
        help="Probe all public FPL API endpoints and print their structure (no DB writes)",
    )

    parser.add_argument(
        "--db-path",
        default=None,
        metavar="PATH",
        help=f"Override database path (default: {settings.DB_PATH})",
    )
    parser.add_argument(
        "--log-level",
        default=settings.LOG_LEVEL,
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help=f"Logging verbosity (default: {settings.LOG_LEVEL})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch data but do NOT write to the database",
    )
    parser.add_argument(
        "--version",
        action="version",
        version="fpl-scraper 0.1.0",
    )

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    # ------------------------------------------------------------------
    # Logging
    # ------------------------------------------------------------------
    setup_logging(log_level=args.log_level, log_file=settings.LOG_FILE)

    import logging
    logger = logging.getLogger(__name__)

    if args.dry_run:
        logger.info("DRY RUN mode — no database writes will occur")

    # ------------------------------------------------------------------
    # Dependency wiring
    # ------------------------------------------------------------------
    db_path = args.db_path or settings.DB_PATH

    try:
        db = FPLDatabase(db_path)
        db.initialize_schema()
    except Exception as exc:
        logger.error("Failed to open database at %s: %s", db_path, exc)
        return EXIT_FATAL

    auth = FPLAuth(
        session_file=settings.SESSION_FILE,
        login=settings.FPL_LOGIN,
        password=settings.FPL_PASSWORD,
    )

    scraper = FPLScraper(
        auth=auth,
        base_url=settings.FPL_BASE_URL,
        min_delay=settings.REQUEST_DELAY_MIN,
        max_delay=settings.REQUEST_DELAY_MAX,
        backoff_factor=settings.BACKOFF_FACTOR,
        max_retries=settings.MAX_RETRIES,
        max_backoff=settings.MAX_BACKOFF,
        timeout=settings.REQUEST_TIMEOUT,
    )

    api = FPLAPI(scraper)
    syncer = FPLSyncer(api=api, db=db, dry_run=args.dry_run)

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------
    try:
        if args.full_sync:
            result = syncer.full_sync()

        elif args.current_gameweek:
            result = syncer.gameweek_sync(gameweek_id=None)

        elif args.gameweek is not None:
            result = syncer.gameweek_sync(gameweek_id=args.gameweek)

        elif args.discover_api:
            logger.info("Probing FPL API endpoints…")
            discovery = api.discover()
            print(json.dumps(discovery, indent=2))
            db.close()
            return EXIT_SUCCESS

    except FPLAuthError as exc:
        logger.error("Authentication failed: %s", exc)
        db.close()
        return EXIT_FATAL

    except ValueError as exc:
        logger.error("Configuration error: %s", exc)
        db.close()
        return EXIT_FATAL

    except Exception as exc:
        logger.exception("Unexpected fatal error: %s", exc)
        db.close()
        return EXIT_FATAL

    db.close()

    if result.errors > 0 and result.players_synced == 0:
        logger.error("Sync failed with no players scraped")
        return EXIT_FATAL

    if result.errors > 0:
        logger.warning(
            "Sync completed with %d errors (%d players synced). "
            "Re-running is safe.",
            result.errors, result.players_synced,
        )
        return EXIT_PARTIAL

    logger.info("Sync completed successfully: %s", result.summary())
    return EXIT_SUCCESS


if __name__ == "__main__":
    sys.exit(main())

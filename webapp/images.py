"""
Download player photos and team badges from the FPL CDN at startup.
Files are stored in webapp/static/images/players/ and badges/.
Already-downloaded files are skipped (idempotent).
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

# New season CDN (2025/26): no "p" prefix, premierleague25 path
PLAYER_PHOTO_URL = (
    "https://resources.premierleague.com/premierleague25/photos/players/110x140/{code}.png"
)
# Legacy CDN (pre-2025 players still served from here with "p" prefix)
PLAYER_PHOTO_URL_LEGACY = (
    "https://resources.premierleague.com/premierleague/photos/players/110x140/p{code}.png"
)
TEAM_BADGE_URL = (
    "https://resources.premierleague.com/premierleague/badges/70/t{team_id}.png"
)
SLEEP_BETWEEN = 0.05  # 50ms – polite crawl rate

_STATIC_DIR = Path(__file__).parent / "static" / "images"


def _ensure_dirs() -> None:
    (_STATIC_DIR / "players").mkdir(parents=True, exist_ok=True)
    (_STATIC_DIR / "badges").mkdir(parents=True, exist_ok=True)


def _download(url: str, dest: Path, session: requests.Session) -> bool:
    """Download url → dest. Returns True on success, False on any error."""
    try:
        resp = session.get(url, timeout=15)
        if resp.status_code == 200:
            dest.write_bytes(resp.content)
            return True
        logger.debug("HTTP %s for %s", resp.status_code, url)
        return False
    except Exception as exc:
        logger.debug("Download error for %s: %s", url, exc)
        return False


def download_images(db_path: str) -> None:
    """
    Called once at app startup. Reads player codes and team IDs from the DB
    and downloads missing images to webapp/static/images/.
    """
    import sqlite3

    _ensure_dirs()

    try:
        conn = sqlite3.connect(db_path)
        player_rows = conn.execute("SELECT DISTINCT code FROM players WHERE code IS NOT NULL").fetchall()
        team_rows = conn.execute("SELECT DISTINCT fpl_id FROM teams").fetchall()
        conn.close()
    except Exception as exc:
        logger.warning("Could not read DB for image download: %s", exc)
        return

    session = requests.Session()
    session.headers["User-Agent"] = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
    )

    # --- Player photos ---
    # Try new season CDN first (premierleague25, no "p" prefix),
    # then fall back to legacy CDN (premierleague, "p" prefix).
    player_dir = _STATIC_DIR / "players"
    downloaded = skipped = failed = 0
    for (code,) in player_rows:
        dest = player_dir / f"p{code}.png"
        if dest.exists():
            skipped += 1
            continue
        ok = _download(PLAYER_PHOTO_URL.format(code=code), dest, session)
        if not ok:
            ok = _download(PLAYER_PHOTO_URL_LEGACY.format(code=code), dest, session)
        if ok:
            downloaded += 1
        else:
            failed += 1
        time.sleep(SLEEP_BETWEEN)

    logger.info(
        "Player photos: %d downloaded, %d skipped, %d failed",
        downloaded, skipped, failed,
    )

    # --- Team badges ---
    badge_dir = _STATIC_DIR / "badges"
    downloaded = skipped = failed = 0
    for (team_id,) in team_rows:
        dest = badge_dir / f"t{team_id}.png"
        if dest.exists():
            skipped += 1
            continue
        url = TEAM_BADGE_URL.format(team_id=team_id)
        ok = _download(url, dest, session)
        if ok:
            downloaded += 1
        else:
            failed += 1
        time.sleep(SLEEP_BETWEEN)

    logger.info(
        "Team badges: %d downloaded, %d skipped, %d failed",
        downloaded, skipped, failed,
    )


def player_photo_url(code: int | None) -> str:
    """Return the static URL for a player photo, fallback to placeholder."""
    if code is None:
        return "/static/images/placeholder_player.png"
    dest = _STATIC_DIR / "players" / f"p{code}.png"
    if dest.exists():
        return f"/static/images/players/p{code}.png"
    return "/static/images/placeholder_player.png"


def team_badge_url(team_fpl_id: int | None) -> str:
    """Return the static URL for a team badge, fallback to placeholder."""
    if team_fpl_id is None:
        return "/static/images/placeholder_badge.png"
    dest = _STATIC_DIR / "badges" / f"t{team_fpl_id}.png"
    if dest.exists():
        return f"/static/images/badges/t{team_fpl_id}.png"
    return "/static/images/placeholder_badge.png"

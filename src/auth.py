"""
FPL session management.
Handles login, cookie persistence, and session validity checks.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

# FPL login endpoint
_LOGIN_URL = "https://users.premierleague.com/accounts/login/"
# Cookie names set by the FPL login flow
_COOKIE_NAMES = ("pl_profile", "sessionid")
# Consider a session stale after this many hours (FPL sessions last ~24h)
_SESSION_TTL_HOURS = 20


class FPLAuthError(Exception):
    pass


class FPLAuth:
    """
    Manages cookie-based authentication with the FPL website.

    Usage:
        auth = FPLAuth(session_file, login_email, password)
        cookies = auth.get_cookies()   # returns dict for requests
    """

    def __init__(self, session_file: str, login: str, password: str) -> None:
        self._session_file = Path(session_file)
        self._login = login
        self._password = password

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def get_cookies(self) -> dict[str, str]:
        """Return valid session cookies, logging in if needed."""
        cached = self._load_session()
        if cached and self._is_valid(cached):
            logger.debug("Using cached FPL session cookies")
            return cached["cookies"]

        logger.info("Authenticating with FPL…")
        return self._login_and_save()

    def invalidate(self) -> None:
        """Delete the cached session (forces re-login on next get_cookies call)."""
        if self._session_file.exists():
            self._session_file.unlink()
            logger.debug("Invalidated cached session")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _login_and_save(self) -> dict[str, str]:
        if not self._login or not self._password:
            raise FPLAuthError(
                "FPL credentials not configured. "
                "Set FPL_LOGIN and FPL_PASSWORD in your .env file."
            )

        payload = {
            "login": self._login,
            "password": self._password,
            "redirect_uri": "https://fantasy.premierleague.com/",
            "app": "plfpl-web",
        }
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        }

        try:
            resp = requests.post(_LOGIN_URL, data=payload, headers=headers, timeout=30)
        except requests.RequestException as exc:
            raise FPLAuthError(f"Login request failed: {exc}") from exc

        if resp.status_code not in (200, 302):
            raise FPLAuthError(
                f"Login returned HTTP {resp.status_code}. "
                "Check your FPL_LOGIN and FPL_PASSWORD."
            )

        cookies: dict[str, str] = {
            name: value
            for name, value in resp.cookies.items()
            if name in _COOKIE_NAMES
        }

        if not cookies:
            raise FPLAuthError(
                "Login succeeded but no session cookies were returned. "
                "FPL may have changed their auth flow."
            )

        self._save_session(cookies)
        logger.info("FPL login successful")
        return cookies

    def _save_session(self, cookies: dict[str, str]) -> None:
        self._session_file.parent.mkdir(parents=True, exist_ok=True)
        expires_at = (
            datetime.now(timezone.utc) + timedelta(hours=_SESSION_TTL_HOURS)
        ).isoformat()
        data = {"cookies": cookies, "expires_at": expires_at}
        self._session_file.write_text(json.dumps(data), encoding="utf-8")
        # Restrict permissions on the session file (owner read/write only)
        os.chmod(self._session_file, 0o600)
        logger.debug("Session saved to %s (expires %s)", self._session_file, expires_at)

    def _load_session(self) -> dict | None:
        if not self._session_file.exists():
            return None
        try:
            return json.loads(self._session_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            logger.warning("Could not read session file; will re-authenticate")
            return None

    @staticmethod
    def _is_valid(session: dict) -> bool:
        try:
            expires_at = datetime.fromisoformat(session["expires_at"])
            return datetime.now(timezone.utc) < expires_at
        except (KeyError, ValueError):
            return False

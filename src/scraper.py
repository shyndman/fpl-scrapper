"""
HTTP client with integrated rate limiting and retry logic.
All FPL API requests flow through FPLScraper.get().
"""
from __future__ import annotations

import logging
import random
import time
from typing import Any

import requests

from src.auth import FPLAuth

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------

class FPLAPIError(Exception):
    """Base exception for FPL API errors."""


class FPLRateLimitError(FPLAPIError):
    """Raised when the API returns HTTP 429 and retries are exhausted."""


class FPLAuthError(FPLAPIError):
    """Raised when authentication fails and cannot be recovered."""


class FPLNotFoundError(FPLAPIError):
    """Raised on HTTP 404 — no point retrying."""


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

class RateLimiter:
    """
    Ensures a minimum random delay between consecutive requests.
    Thread-safe for single-threaded use; this scraper is sequential by design.
    """

    def __init__(self, min_delay: float, max_delay: float) -> None:
        self._min = min_delay
        self._max = max_delay
        self._last_call: float = 0.0

    def wait(self) -> None:
        delay = random.uniform(self._min, self._max)
        elapsed = time.monotonic() - self._last_call
        remaining = delay - elapsed
        if remaining > 0:
            logger.debug("Rate limit: sleeping %.2fs", remaining)
            time.sleep(remaining)
        self._last_call = time.monotonic()


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------

class FPLScraper:
    """
    Wraps requests.Session with:
      - Cookie injection from FPLAuth
      - Rate limiting (min/max delay between requests)
      - Exponential backoff on 5xx errors
      - Retry-After handling on 429
      - Re-authentication on 403
    """

    _HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": "https://fantasy.premierleague.com/",
    }

    def __init__(
        self,
        auth: FPLAuth,
        base_url: str,
        min_delay: float = 2.0,
        max_delay: float = 3.0,
        backoff_factor: float = 2.0,
        max_retries: int = 5,
        max_backoff: float = 120.0,
        timeout: int = 30,
    ) -> None:
        self._auth = auth
        self._base_url = base_url.rstrip("/")
        self._backoff_factor = backoff_factor
        self._max_retries = max_retries
        self._max_backoff = max_backoff
        self._timeout = timeout
        self._rate_limiter = RateLimiter(min_delay, max_delay)
        self._request_count = 0

        self._session = requests.Session()
        self._session.headers.update(self._HEADERS)

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    @property
    def request_count(self) -> int:
        return self._request_count

    def get(self, path: str, requires_auth: bool = False, params: dict | None = None) -> Any:
        """
        Perform a GET request to `base_url/path`.

        Raises:
            FPLNotFoundError: HTTP 404 (no retry)
            FPLAuthError: HTTP 403 after re-auth attempt
            FPLRateLimitError: HTTP 429 after retries exhausted
            FPLAPIError: Any other unrecoverable error
        """
        url = f"{self._base_url}/{path.lstrip('/')}"
        if not url.endswith("/"):
            url += "/"

        if requires_auth:
            self._inject_cookies()

        last_exc: Exception | None = None
        for attempt in range(self._max_retries):
            self._rate_limiter.wait()

            try:
                resp = self._session.get(url, params=params, timeout=self._timeout)
                self._request_count += 1
            except requests.ConnectionError as exc:
                last_exc = exc
                backoff = self._backoff(attempt)
                logger.warning("Connection error (attempt %d/%d): %s — sleeping %.1fs",
                               attempt + 1, self._max_retries, exc, backoff)
                time.sleep(backoff)
                continue
            except requests.Timeout as exc:
                last_exc = exc
                backoff = self._backoff(attempt)
                logger.warning("Timeout (attempt %d/%d) — sleeping %.1fs",
                               attempt + 1, self._max_retries, backoff)
                time.sleep(backoff)
                continue

            if resp.status_code == 200:
                logger.debug("GET %s -> 200 (attempt %d)", url, attempt + 1)
                return resp.json()

            if resp.status_code == 404:
                raise FPLNotFoundError(f"404 Not Found: {url}")

            if resp.status_code == 403:
                if attempt == 0:
                    logger.info("403 Forbidden — refreshing session cookies and retrying")
                    self._auth.invalidate()
                    self._inject_cookies()
                    continue
                raise FPLAuthError(
                    f"403 Forbidden after re-auth attempt: {url}. "
                    "Check your FPL credentials."
                )

            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "60"))
                logger.warning("429 Rate limited — sleeping %ds (Retry-After)", retry_after)
                time.sleep(retry_after)
                last_exc = FPLRateLimitError(f"Rate limited on {url}")
                continue

            if resp.status_code >= 500:
                backoff = self._backoff(attempt)
                logger.warning(
                    "HTTP %d on %s (attempt %d/%d) — sleeping %.1fs",
                    resp.status_code, url, attempt + 1, self._max_retries, backoff,
                )
                last_exc = FPLAPIError(f"HTTP {resp.status_code}: {url}")
                time.sleep(backoff)
                continue

            # Unexpected status code
            raise FPLAPIError(f"Unexpected HTTP {resp.status_code}: {url}")

        raise FPLAPIError(
            f"Max retries ({self._max_retries}) exceeded for {url}"
        ) from last_exc

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _inject_cookies(self) -> None:
        cookies = self._auth.get_cookies()
        self._session.cookies.update(cookies)

    def _backoff(self, attempt: int) -> float:
        return min(self._max_backoff, self._backoff_factor ** attempt * 2.0)

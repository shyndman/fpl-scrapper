"""Tests for src/scraper.py — rate limiter and HTTP retry logic."""
import time
from unittest.mock import MagicMock, patch

import pytest
import responses as responses_lib

from src.auth import FPLAuth
from src.scraper import (
    FPLAPIError,
    FPLAuthError,
    FPLNotFoundError,
    FPLRateLimitError,
    FPLScraper,
    RateLimiter,
)


# ---------------------------------------------------------------------------
# RateLimiter
# ---------------------------------------------------------------------------

class TestRateLimiter:
    def test_waits_at_least_min_delay(self):
        limiter = RateLimiter(min_delay=0.05, max_delay=0.05)
        limiter.wait()  # prime
        start = time.monotonic()
        limiter.wait()
        elapsed = time.monotonic() - start
        assert elapsed >= 0.04  # allow 10ms tolerance

    def test_no_wait_on_first_call(self):
        """First call should not block (last_call=0 means a very long time ago)."""
        limiter = RateLimiter(min_delay=5.0, max_delay=5.0)
        start = time.monotonic()
        limiter.wait()
        elapsed = time.monotonic() - start
        assert elapsed < 0.1  # should be nearly instant


# ---------------------------------------------------------------------------
# FPLScraper (using responses mock library)
# ---------------------------------------------------------------------------

def make_scraper(min_delay=0.0, max_delay=0.0, max_retries=3):
    mock_auth = MagicMock(spec=FPLAuth)
    mock_auth.get_cookies.return_value = {}
    return FPLScraper(
        auth=mock_auth,
        base_url="https://fantasy.premierleague.com/api",
        min_delay=min_delay,
        max_delay=max_delay,
        max_retries=max_retries,
        backoff_factor=0.01,  # tiny backoff so tests run fast
        max_backoff=0.05,
        timeout=5,
    )


@responses_lib.activate
def test_get_200_returns_json():
    responses_lib.add(
        responses_lib.GET,
        "https://fantasy.premierleague.com/api/bootstrap-static/",
        json={"elements": []},
        status=200,
    )
    scraper = make_scraper()
    result = scraper.get("bootstrap-static")
    assert result == {"elements": []}
    assert scraper.request_count == 1


@responses_lib.activate
def test_get_404_raises_not_found():
    responses_lib.add(
        responses_lib.GET,
        "https://fantasy.premierleague.com/api/element-summary/9999/",
        status=404,
    )
    scraper = make_scraper()
    with pytest.raises(FPLNotFoundError):
        scraper.get("element-summary/9999")


@responses_lib.activate
def test_get_retries_on_500():
    # Fail twice, succeed on third
    responses_lib.add(
        responses_lib.GET,
        "https://fantasy.premierleague.com/api/bootstrap-static/",
        status=500,
    )
    responses_lib.add(
        responses_lib.GET,
        "https://fantasy.premierleague.com/api/bootstrap-static/",
        status=500,
    )
    responses_lib.add(
        responses_lib.GET,
        "https://fantasy.premierleague.com/api/bootstrap-static/",
        json={"events": []},
        status=200,
    )
    scraper = make_scraper(max_retries=5)
    result = scraper.get("bootstrap-static")
    assert result == {"events": []}
    assert scraper.request_count == 3


@responses_lib.activate
def test_get_raises_after_max_retries():
    for _ in range(5):
        responses_lib.add(
            responses_lib.GET,
            "https://fantasy.premierleague.com/api/bootstrap-static/",
            status=503,
        )
    scraper = make_scraper(max_retries=5)
    with pytest.raises(FPLAPIError):
        scraper.get("bootstrap-static")


@responses_lib.activate
def test_get_403_triggers_reauth_and_retries():
    mock_auth = MagicMock(spec=FPLAuth)
    mock_auth.get_cookies.return_value = {}

    responses_lib.add(
        responses_lib.GET,
        "https://fantasy.premierleague.com/api/my-team/1/",
        status=403,
    )
    responses_lib.add(
        responses_lib.GET,
        "https://fantasy.premierleague.com/api/my-team/1/",
        json={"picks": []},
        status=200,
    )

    scraper = FPLScraper(
        auth=mock_auth,
        base_url="https://fantasy.premierleague.com/api",
        min_delay=0.0, max_delay=0.0, max_retries=3,
        backoff_factor=0.01, max_backoff=0.05, timeout=5,
    )
    result = scraper.get("my-team/1", requires_auth=True)
    assert result == {"picks": []}
    mock_auth.invalidate.assert_called_once()


@responses_lib.activate
def test_url_always_has_trailing_slash():
    """Verify the scraper adds a trailing slash (FPL API requires it)."""
    responses_lib.add(
        responses_lib.GET,
        "https://fantasy.premierleague.com/api/bootstrap-static/",
        json={},
        status=200,
    )
    scraper = make_scraper()
    # Call without slash
    scraper.get("bootstrap-static")
    assert responses_lib.calls[0].request.url == (
        "https://fantasy.premierleague.com/api/bootstrap-static/"
    )


@responses_lib.activate
def test_request_count_increments():
    for _ in range(3):
        responses_lib.add(
            responses_lib.GET,
            "https://fantasy.premierleague.com/api/fixtures/",
            json=[],
            status=200,
        )
    scraper = make_scraper()
    scraper.get("fixtures")
    scraper.get("fixtures")
    scraper.get("fixtures")
    assert scraper.request_count == 3

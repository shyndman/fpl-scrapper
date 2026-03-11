"""
FastAPI application factory.
Configures Jinja2 templates, static files, and lifespan (image download at startup).
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from webapp import db as webapp_db
from webapp.images import download_images, player_photo_url, team_badge_url

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_HERE = Path(__file__).parent
_STATIC_DIR = _HERE / "static"
_TEMPLATES_DIR = _HERE / "templates"

# Default DB path — resolved relative to project root (parent of webapp/)
_DEFAULT_DB = str(Path(__file__).parent.parent / "data" / "fpl.db")


# ---------------------------------------------------------------------------
# Jinja2 custom filters
# ---------------------------------------------------------------------------

def _format_cost(tenths: int | None) -> str:
    """Convert integer tenths to £-formatted string: 130 → '£13.0m'"""
    if tenths is None:
        return "£?.?m"
    return f"£{tenths / 10:.1f}m"


def _position_name(element_type: int | None) -> str:
    return {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}.get(element_type or 0, "?")


def _position_color(element_type: int | None) -> str:
    return {
        1: "text-yellow-400 bg-yellow-400/10",
        2: "text-green-400 bg-green-400/10",
        3: "text-sky-400 bg-sky-400/10",
        4: "text-red-400 bg-red-400/10",
    }.get(element_type or 0, "text-gray-400 bg-gray-400/10")


def _status_class(status: str | None) -> str:
    return {
        "a": "text-emerald-400",
        "d": "text-yellow-400",
        "i": "text-red-400",
        "s": "text-gray-400",
        "u": "text-gray-500",
    }.get(status or "", "text-gray-400")


def _status_label(status: str | None) -> str:
    return {
        "a": "Available",
        "d": "Doubt",
        "i": "Injured",
        "s": "Suspended",
        "u": "Unavailable",
    }.get(status or "", "Unknown")


def _difficulty_class(diff: int | None) -> str:
    return {
        1: "bg-emerald-500 text-white",
        2: "bg-green-400 text-black",
        3: "bg-gray-400 text-black",
        4: "bg-red-400 text-white",
        5: "bg-red-700 text-white",
    }.get(diff or 0, "bg-gray-600 text-white")


templates: Jinja2Templates | None = None


def get_templates() -> Jinja2Templates:
    global templates
    if templates is None:
        raise RuntimeError("Templates not initialised")
    return templates


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup
    db_path = app.state.db_path
    logger.info("Configuring database: %s", db_path)
    webapp_db.configure(db_path)

    # Start image download as a background task so it doesn't block server startup
    async def _bg_download():
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, download_images, db_path)
            logger.info("Image download complete.")
        except Exception as exc:
            logger.warning("Image download failed: %s", exc)

    asyncio.create_task(_bg_download())

    yield
    # Shutdown (nothing to tear down)


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app(db_path: str | None = None) -> FastAPI:
    global templates

    resolved_db = db_path or os.environ.get("FPL_DB_PATH", _DEFAULT_DB)

    app = FastAPI(
        title="FPL Dashboard",
        description="Fantasy Premier League statistics explorer",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.db_path = resolved_db

    # Static files
    app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

    # Templates
    templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))
    templates.env.filters["format_cost"] = _format_cost
    templates.env.filters["position_name"] = _position_name
    templates.env.filters["position_color"] = _position_color
    templates.env.filters["status_class"] = _status_class
    templates.env.filters["status_label"] = _status_label
    templates.env.filters["difficulty_class"] = _difficulty_class
    templates.env.globals["player_photo_url"] = player_photo_url
    templates.env.globals["team_badge_url"] = team_badge_url

    # Routers (imported here to avoid circular imports)
    from webapp.routers import api as api_router
    from webapp.routers import pages as pages_router

    app.include_router(pages_router.router)
    app.include_router(api_router.router, prefix="/api")

    return app

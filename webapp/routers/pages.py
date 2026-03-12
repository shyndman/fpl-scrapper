"""HTML page routes — server-rendered Jinja2 templates."""
from __future__ import annotations

import math

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from webapp import db
from webapp.app import get_templates

router = APIRouter(default_response_class=HTMLResponse)


def _tmpl():
    return get_templates()


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@router.get("/")
async def dashboard(request: Request):
    overview = db.get_overview()
    teams = db.get_all_teams()
    gameweeks = db.get_all_gameweeks()
    return _tmpl().TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "overview": overview,
            "teams": teams,
            "gameweeks": gameweeks,
            "page_title": "Dashboard",
        },
    )


# ---------------------------------------------------------------------------
# Players
# ---------------------------------------------------------------------------

@router.get("/players")
async def players(
    request: Request,
    pos: int | None = None,
    team: int | None = None,
    status: str | None = None,
    min_cost: int | None = None,
    max_cost: int | None = None,
    gw_start: int | None = None,
    gw_end: int | None = None,
    sort: str = "total_points",
    order: str = "desc",
    page: int = 1,
):
    per_page = 40
    players_list, total = db.get_players(
        pos=pos,
        team=team,
        status=status,
        min_cost=min_cost,
        max_cost=max_cost,
        gw_start=gw_start,
        gw_end=gw_end,
        sort=sort,
        order=order,
        page=page,
        per_page=per_page,
    )
    teams = db.get_all_teams()
    gameweeks = db.get_all_gameweeks()
    total_pages = max(1, math.ceil(total / per_page))

    return _tmpl().TemplateResponse(
        "players.html",
        {
            "request": request,
            "players": players_list,
            "teams": teams,
            "gameweeks": gameweeks,
            "total": total,
            "page": page,
            "total_pages": total_pages,
            "per_page": per_page,
            # preserve filter state
            "filter_pos": pos,
            "filter_team": team,
            "filter_status": status,
            "filter_min_cost": min_cost,
            "filter_max_cost": max_cost,
            "filter_gw_start": gw_start,
            "filter_gw_end": gw_end,
            "filter_sort": sort,
            "filter_order": order,
            "page_title": "Players",
        },
    )


@router.get("/players/{fpl_id}")
async def player_detail(request: Request, fpl_id: int):
    player = db.get_player(fpl_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    history = db.get_player_history(fpl_id)
    history_past = db.get_player_history_past(fpl_id)
    team = db.get_team(player["team_fpl_id"])
    return _tmpl().TemplateResponse(
        "player_detail.html",
        {
            "request": request,
            "player": player,
            "history": history,
            "history_past": history_past,
            "team": team,
            "page_title": player["web_name"],
        },
    )


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------

@router.get("/teams")
async def teams_page(request: Request):
    teams = db.get_teams_with_stats()
    return _tmpl().TemplateResponse(
        "teams.html",
        {
            "request": request,
            "teams": teams,
            "page_title": "Teams",
        },
    )


@router.get("/teams/{fpl_id}")
async def team_detail(request: Request, fpl_id: int):
    team = db.get_team(fpl_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    squad = db.get_team_squad(fpl_id)
    fixtures = db.get_team_fixtures(fpl_id, limit=8)
    return _tmpl().TemplateResponse(
        "team_detail.html",
        {
            "request": request,
            "team": team,
            "squad": squad,
            "fixtures": fixtures,
            "page_title": team["name"],
        },
    )


# ---------------------------------------------------------------------------
# Compare
# ---------------------------------------------------------------------------

@router.get("/compare")
async def compare_page(request: Request):
    return _tmpl().TemplateResponse(
        "compare.html",
        {
            "request": request,
            "page_title": "Compare",
        },
    )

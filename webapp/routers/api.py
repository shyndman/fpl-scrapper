"""JSON API routes — consumed by Alpine.js / Chart.js on the front end."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from webapp import db
from webapp.images import player_photo_url, team_badge_url

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _enrich_player(p: dict) -> dict:
    """Add photo/badge URLs to a player dict."""
    p["photo_url"] = player_photo_url(p.get("code"))
    p["badge_url"] = team_badge_url(p.get("team_fpl_id"))
    return p


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

@router.get("/overview")
async def overview():
    data = db.get_overview()
    # Enrich top players
    data["top_players"] = [_enrich_player(p) for p in data.get("top_players", [])]
    return JSONResponse(data)


# ---------------------------------------------------------------------------
# Gameweeks
# ---------------------------------------------------------------------------

@router.get("/gameweeks")
async def gameweeks():
    return JSONResponse(db.get_all_gameweeks())


# ---------------------------------------------------------------------------
# Players
# ---------------------------------------------------------------------------

@router.get("/players")
async def players_api(
    pos: Optional[int] = None,
    team: Optional[int] = None,
    status: Optional[str] = None,
    min_cost: Optional[int] = None,
    max_cost: Optional[int] = None,
    sort: str = "total_points",
    order: str = "desc",
    page: int = 1,
    per_page: int = 40,
):
    players_list, total = db.get_players(
        pos=pos,
        team=team,
        status=status,
        min_cost=min_cost,
        max_cost=max_cost,
        sort=sort,
        order=order,
        page=page,
        per_page=per_page,
    )
    enriched = [_enrich_player(p) for p in players_list]
    return JSONResponse({"players": enriched, "total": total, "page": page})


@router.get("/players/{fpl_id}")
async def player_detail_api(fpl_id: int):
    player = db.get_player(fpl_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return JSONResponse(_enrich_player(player))


@router.get("/players/{fpl_id}/history")
async def player_history_api(fpl_id: int):
    history = db.get_player_history(fpl_id)
    return JSONResponse(history)


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------

@router.get("/teams")
async def teams_api():
    teams = db.get_teams_with_stats()
    enriched = [{**t, "badge_url": team_badge_url(t.get("fpl_id"))} for t in teams]
    return JSONResponse(enriched)


@router.get("/teams/{fpl_id}")
async def team_detail_api(fpl_id: int):
    team = db.get_team(fpl_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    squad = db.get_team_squad(fpl_id)
    fixtures = db.get_team_fixtures(fpl_id)
    squad_enriched = [_enrich_player(p) for p in squad]
    return JSONResponse({
        "team": {**team, "badge_url": team_badge_url(team.get("fpl_id"))},
        "squad": squad_enriched,
        "fixtures": fixtures,
    })


# ---------------------------------------------------------------------------
# Search (typeahead)
# ---------------------------------------------------------------------------

@router.get("/search")
async def search(
    q: str = Query(default="", min_length=1),
    type: str = Query(default="player"),
):
    if not q.strip():
        return JSONResponse([])

    if type == "team":
        results = db.search_teams(q.strip())
        return JSONResponse([
            {
                "id": r["fpl_id"],
                "label": r["name"],
                "sub": r["short_name"],
                "badge_url": team_badge_url(r["fpl_id"]),
                "type": "team",
            }
            for r in results
        ])
    else:
        results = db.search_players(q.strip())
        return JSONResponse([
            {
                "id": r["fpl_id"],
                "label": r["web_name"],
                "sub": r.get("team_short", ""),
                "photo_url": player_photo_url(r.get("code")),
                "type": "player",
            }
            for r in results
        ])


# ---------------------------------------------------------------------------
# Compare
# ---------------------------------------------------------------------------

@router.get("/compare")
async def compare(
    ids: str = Query(default=""),
    type: str = Query(default="player"),
    metrics: str = Query(default="total_points,goals_scored,assists"),
):
    """
    ids: comma-separated fpl_ids
    type: 'player' | 'team'
    metrics: comma-separated metric names
    """
    if not ids.strip():
        return JSONResponse({"entities": [], "metrics": [], "datasets": []})

    try:
        id_list = [int(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ids")

    metric_list = [m.strip() for m in metrics.split(",") if m.strip()]

    if type == "team":
        entities = db.get_compare_teams(id_list)
        entities_enriched = [
            {**e, "badge_url": team_badge_url(e.get("fpl_id"))} for e in entities
        ]
        # Build comparison table
        rows = []
        for metric in metric_list:
            row = {"metric": metric}
            for e in entities:
                row[str(e["fpl_id"])] = e.get(metric)
            rows.append(row)
        return JSONResponse({
            "entities": entities_enriched,
            "metrics": metric_list,
            "table": rows,
            "histories": {},
        })

    else:
        entities = db.get_compare_players(id_list)
        entities_enriched = [_enrich_player(dict(e)) for e in entities]
        histories = db.get_compare_player_histories(id_list)

        # Collect all GW IDs seen across all players
        all_gws: list[int] = sorted(
            {r["gameweek_fpl_id"] for plist in histories.values() for r in plist}
        )

        # Build per-metric GW datasets for Chart.js
        datasets: dict[str, list[dict]] = {}
        CHART_COLORS = [
            "#00ff87", "#38bdf8", "#f97316", "#a78bfa", "#fb7185",
        ]
        for metric in metric_list:
            metric_datasets = []
            for idx, entity in enumerate(entities_enriched):
                pid = entity["fpl_id"]
                gw_map = {r["gameweek_fpl_id"]: r.get(metric) for r in histories.get(pid, [])}
                metric_datasets.append({
                    "label": entity["web_name"],
                    "data": [gw_map.get(gw) for gw in all_gws],
                    "borderColor": CHART_COLORS[idx % len(CHART_COLORS)],
                    "backgroundColor": CHART_COLORS[idx % len(CHART_COLORS)] + "33",
                })
            datasets[metric] = metric_datasets

        # Season-total comparison table
        rows = []
        for metric in metric_list:
            row = {"metric": metric}
            for e in entities:
                row[str(e["fpl_id"])] = e.get(metric)
            rows.append(row)

        return JSONResponse({
            "entities": entities_enriched,
            "metrics": metric_list,
            "gameweeks": all_gws,
            "datasets": datasets,
            "table": rows,
        })

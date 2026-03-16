import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import * as webappDb from "../db.ts";

type QueryValue = string | string[] | undefined;
type PageContext = Record<string, unknown> & { request: FastifyRequest };
type PageRenderer = (
  reply: FastifyReply,
  template: string,
  context: PageContext,
) => unknown;

export interface PageRoutePluginOptions {
  renderPage?: PageRenderer;
}

function firstQueryValue(value: unknown): QueryValue {
  if (typeof value === "string" || Array.isArray(value)) {
    return value;
  }
  return undefined;
}

function queryString(value: unknown): string | undefined {
  const queryValue = firstQueryValue(value);
  if (typeof queryValue === "string") {
    return queryValue;
  }
  if (Array.isArray(queryValue)) {
    return typeof queryValue[0] === "string" ? queryValue[0] : undefined;
  }
  return undefined;
}

function queryInteger(value: unknown): number | undefined {
  const raw = queryString(value);
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function routeInteger(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    throw new Error("Invalid integer route parameter");
  }
  return parsed;
}

function totalPages(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}

function defaultRenderPage(
  reply: FastifyReply,
  template: string,
  context: PageContext,
): unknown {
  return (
    reply as FastifyReply & {
      view: (viewTemplate: string, viewContext: PageContext) => unknown;
    }
  ).view(template, context);
}

/** Register the server-rendered page routes so the app factory can mount the existing Nunjucks views unchanged. */
export const pageRoutes: FastifyPluginAsync<PageRoutePluginOptions> = async (
  app,
  options,
) => {
  const renderPage = options.renderPage ?? defaultRenderPage;

  app.get("/", async (request, reply) => {
    return renderPage(reply, "dashboard.html", {
      request,
      overview: webappDb.getOverview(),
      teams: webappDb.getAllTeams(),
      gameweeks: webappDb.getAllGameweeks(),
      page_title: "Dashboard",
    });
  });

  app.get("/players", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const pos = queryInteger(query.pos);
    const team = queryInteger(query.team);
    const status = queryString(query.status);
    const minCost = queryInteger(query.min_cost);
    const maxCost = queryInteger(query.max_cost);
    const gwStart = queryInteger(query.gw_start);
    const gwEnd = queryInteger(query.gw_end);
    const sort = queryString(query.sort) ?? "total_points";
    const order = queryString(query.order) ?? "desc";
    const page = queryInteger(query.page) ?? 1;
    const perPage = 40;
    const [players, total] = webappDb.getPlayers({
      pos,
      team,
      status,
      minCost,
      maxCost,
      gwStart,
      gwEnd,
      sort,
      order,
      page,
      perPage,
    });

    return renderPage(reply, "players.html", {
      request,
      players,
      teams: webappDb.getAllTeams(),
      gameweeks: webappDb.getAllGameweeks(),
      total,
      page,
      total_pages: totalPages(total, perPage),
      per_page: perPage,
      filter_pos: pos,
      filter_team: team,
      filter_status: status,
      filter_min_cost: minCost,
      filter_max_cost: maxCost,
      filter_gw_start: gwStart,
      filter_gw_end: gwEnd,
      filter_sort: sort,
      filter_order: order,
      page_title: "Players",
    });
  });

  app.get("/players/:fplId", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const fplId = routeInteger(params.fplId);
    const player = webappDb.getPlayer(fplId);
    if (player === null) {
      return reply.code(404).send({ detail: "Player not found" });
    }

    return renderPage(reply, "player_detail.html", {
      request,
      player,
      history: webappDb.getPlayerHistory(fplId),
      history_past: webappDb.getPlayerHistoryPast(fplId),
      team: webappDb.getTeam(Number(player.team_fpl_id)),
      page_title: String(player.web_name),
    });
  });

  app.get("/teams", async (request, reply) => {
    return renderPage(reply, "teams.html", {
      request,
      teams: webappDb.getTeamsWithStats(),
      page_title: "Teams",
    });
  });

  app.get("/teams/:fplId", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const fplId = routeInteger(params.fplId);
    const team = webappDb.getTeam(fplId);
    if (team === null) {
      return reply.code(404).send({ detail: "Team not found" });
    }

    return renderPage(reply, "team_detail.html", {
      request,
      team,
      squad: webappDb.getTeamSquad(fplId),
      fixtures: webappDb.getTeamFixtures(fplId, 8),
      page_title: String(team.name),
    });
  });

  app.get("/compare", async (request, reply) => {
    return renderPage(reply, "compare.html", {
      request,
      page_title: "Compare",
    });
  });
};

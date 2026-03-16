import type { FastifyPluginAsync } from "fastify";

import * as webappDb from "../db.ts";
import { playerPhotoUrl, teamBadgeUrl } from "../images.ts";

const CHART_COLORS = [
  "#00ff87",
  "#38bdf8",
  "#f97316",
  "#a78bfa",
  "#fb7185",
] as const;

type JsonRecord = Record<string, unknown>;
type JsonArray = JsonRecord[];

type CompareHistoryRow = JsonRecord & {
  gameweek_fpl_id?: unknown;
};

function toRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object"
    ? { ...(value as JsonRecord) }
    : {};
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseInteger(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    throw new Error("Invalid integer");
  }
  return parsed;
}

function enrichPlayer(player: unknown): JsonRecord {
  const enriched = toRecord(player);
  enriched.photo_url = playerPhotoUrl(
    typeof enriched.code === "number" ? enriched.code : null,
  );
  enriched.badge_url = teamBadgeUrl(
    typeof enriched.team_fpl_id === "number" ? enriched.team_fpl_id : null,
  );
  return enriched;
}

function teamWithBadge(team: unknown): JsonRecord {
  const enriched = toRecord(team);
  enriched.badge_url = teamBadgeUrl(
    typeof enriched.fpl_id === "number" ? enriched.fpl_id : null,
  );
  return enriched;
}

function compareTableRows(
  metrics: readonly string[],
  entities: readonly JsonRecord[],
): JsonArray {
  return metrics.map((metric) => {
    const row: JsonRecord = { metric };
    for (const entity of entities) {
      if (typeof entity.fpl_id === "number") {
        row[String(entity.fpl_id)] = entity[metric];
      }
    }
    return row;
  });
}

function sortedGameweeks(
  histories: Record<number, CompareHistoryRow[]>,
): number[] {
  return Array.from(
    new Set(
      Object.values(histories)
        .flat()
        .map((row) => row.gameweek_fpl_id)
        .filter((value): value is number => typeof value === "number"),
    ),
  ).sort((left, right) => left - right);
}

/** Register the JSON dashboard API routes so the app factory can mount them under /api unchanged. */
export const apiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/overview", async () => {
    const overview = { ...webappDb.getOverview() };
    const topPlayers = Array.isArray(overview.top_players)
      ? overview.top_players.map((player) => enrichPlayer(player))
      : [];

    return {
      ...overview,
      top_players: topPlayers,
    };
  });

  app.get("/gameweeks", async () => webappDb.getAllGameweeks());

  app.get("/players", async (request) => {
    const query = request.query as Record<string, unknown>;
    const page = parseOptionalInteger(query.page) ?? 1;
    const perPage = parseOptionalInteger(query.per_page) ?? 40;
    const [players, total] = webappDb.getPlayers({
      pos: parseOptionalInteger(query.pos),
      team: parseOptionalInteger(query.team),
      status: typeof query.status === "string" ? query.status : undefined,
      minCost: parseOptionalInteger(query.min_cost),
      maxCost: parseOptionalInteger(query.max_cost),
      sort:
        typeof query.sort === "string" && query.sort !== ""
          ? query.sort
          : "total_points",
      order:
        typeof query.order === "string" && query.order !== ""
          ? query.order
          : "desc",
      page,
      perPage,
    });

    return {
      players: players.map((player) => enrichPlayer(player)),
      total,
      page,
    };
  });

  app.get("/players/:fplId", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const player = webappDb.getPlayer(parseInteger(params.fplId));
    if (player === null) {
      return reply.code(404).send({ detail: "Player not found" });
    }
    return enrichPlayer(player);
  });

  app.get("/players/:fplId/history", async (request) => {
    const params = request.params as Record<string, unknown>;
    return webappDb.getPlayerHistory(parseInteger(params.fplId));
  });

  app.get("/teams", async () =>
    webappDb.getTeamsWithStats().map((team) => teamWithBadge(team)),
  );

  app.get("/teams/:fplId", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const teamId = parseInteger(params.fplId);
    const team = webappDb.getTeam(teamId);
    if (team === null) {
      return reply.code(404).send({ detail: "Team not found" });
    }

    return {
      team: teamWithBadge(team),
      squad: webappDb
        .getTeamSquad(teamId)
        .map((player) => enrichPlayer(player)),
      fixtures: webappDb.getTeamFixtures(teamId),
    };
  });

  app.get("/search", async (request) => {
    const query = request.query as Record<string, unknown>;
    const raw = typeof query.q === "string" ? query.q : "";
    const trimmed = raw.trim();
    if (trimmed === "") {
      return [];
    }

    if (query.type === "team") {
      return webappDb.searchTeams(trimmed).map((team) => ({
        id: team.fpl_id,
        label: team.name,
        sub: team.short_name,
        badge_url: teamBadgeUrl(
          typeof team.fpl_id === "number" ? team.fpl_id : null,
        ),
        type: "team",
      }));
    }

    return webappDb.searchPlayers(trimmed).map((player) => ({
      id: player.fpl_id,
      label: player.web_name,
      sub: player.team_short ?? "",
      photo_url: playerPhotoUrl(
        typeof player.code === "number" ? player.code : null,
      ),
      type: "player",
    }));
  });

  app.get("/compare", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const ids = typeof query.ids === "string" ? query.ids : "";
    const metrics =
      typeof query.metrics === "string"
        ? query.metrics
        : "total_points,goals_scored,assists";
    const compareType = query.type === "team" ? "team" : "player";

    if (ids.trim() === "") {
      return {
        entities: [],
        metrics: [],
        datasets: [],
      };
    }

    let idList: number[];
    try {
      idList = ids
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== "")
        .map((value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isNaN(parsed)) {
            throw new Error("Invalid ids");
          }
          return parsed;
        });
    } catch {
      return reply.code(400).send({ detail: "Invalid ids" });
    }

    const metricList = metrics
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "");

    if (compareType === "team") {
      const entities = webappDb
        .getCompareTeams(idList)
        .map((team) => teamWithBadge(team));
      return {
        entities,
        metrics: metricList,
        table: compareTableRows(metricList, entities),
        histories: {},
      };
    }

    const entities = webappDb
      .getComparePlayers(idList)
      .map((player) => enrichPlayer(player));
    const histories = webappDb.getComparePlayerHistories(idList) as Record<
      number,
      CompareHistoryRow[]
    >;
    const gameweeks = sortedGameweeks(histories);
    const datasets = Object.fromEntries(
      metricList.map((metric) => [
        metric,
        entities.map((entity, index) => {
          const playerId =
            typeof entity.fpl_id === "number" ? entity.fpl_id : -1;
          const gameweekMap = new Map<number, unknown>(
            (histories[playerId] ?? [])
              .filter(
                (row): row is CompareHistoryRow & { gameweek_fpl_id: number } =>
                  typeof row.gameweek_fpl_id === "number",
              )
              .map((row) => [row.gameweek_fpl_id, row[metric]]),
          );

          const color = CHART_COLORS[index % CHART_COLORS.length];
          return {
            label: entity.web_name,
            data: gameweeks.map(
              (gameweek) => gameweekMap.get(gameweek) ?? null,
            ),
            borderColor: color,
            backgroundColor: `${color}33`,
          };
        }),
      ]),
    );

    return {
      entities,
      metrics: metricList,
      gameweeks,
      datasets,
      table: compareTableRows(metricList, entities),
    };
  });
};

export default apiRoutes;

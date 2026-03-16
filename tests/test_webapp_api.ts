import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  getOverview: vi.fn<() => Record<string, unknown>>(),
  getAllGameweeks: vi.fn<() => Array<Record<string, unknown>>>(),
  getPlayers:
    vi.fn<
      (
        options: Record<string, unknown>,
      ) => [Array<Record<string, unknown>>, number]
    >(),
  getPlayer: vi.fn<(fplId: number) => Record<string, unknown> | null>(),
  getPlayerHistory: vi.fn<(fplId: number) => Array<Record<string, unknown>>>(),
  getTeamsWithStats: vi.fn<() => Array<Record<string, unknown>>>(),
  getTeam: vi.fn<(fplId: number) => Record<string, unknown> | null>(),
  getTeamSquad: vi.fn<(fplId: number) => Array<Record<string, unknown>>>(),
  getTeamFixtures: vi.fn<(fplId: number) => Array<Record<string, unknown>>>(),
  searchTeams: vi.fn<(query: string) => Array<Record<string, unknown>>>(),
  searchPlayers: vi.fn<(query: string) => Array<Record<string, unknown>>>(),
  getCompareTeams:
    vi.fn<(ids: readonly number[]) => Array<Record<string, unknown>>>(),
  getComparePlayers:
    vi.fn<(ids: readonly number[]) => Array<Record<string, unknown>>>(),
  getComparePlayerHistories:
    vi.fn<
      (ids: readonly number[]) => Record<number, Array<Record<string, unknown>>>
    >(),
  playerPhotoUrl: vi.fn<(code: number | null | undefined) => string>(),
  teamBadgeUrl: vi.fn<(teamId: number | null | undefined) => string>(),
}));

vi.mock("../webapp/db.ts", () => ({
  getOverview: runtime.getOverview,
  getAllGameweeks: runtime.getAllGameweeks,
  getPlayers: runtime.getPlayers,
  getPlayer: runtime.getPlayer,
  getPlayerHistory: runtime.getPlayerHistory,
  getTeamsWithStats: runtime.getTeamsWithStats,
  getTeam: runtime.getTeam,
  getTeamSquad: runtime.getTeamSquad,
  getTeamFixtures: runtime.getTeamFixtures,
  searchTeams: runtime.searchTeams,
  searchPlayers: runtime.searchPlayers,
  getCompareTeams: runtime.getCompareTeams,
  getComparePlayers: runtime.getComparePlayers,
  getComparePlayerHistories: runtime.getComparePlayerHistories,
}));

vi.mock("../webapp/images.ts", () => ({
  playerPhotoUrl: runtime.playerPhotoUrl,
  teamBadgeUrl: runtime.teamBadgeUrl,
}));

const APPS: FastifyInstance[] = [];

async function createApiApp(): Promise<FastifyInstance> {
  vi.resetModules();
  const { apiRoutes } = await import("../webapp/routers/api.ts");
  const app = Fastify({ disableRequestLogging: true });
  await app.register(apiRoutes, { prefix: "/api" });
  await app.ready();
  APPS.push(app);
  return app;
}

beforeEach(() => {
  runtime.getOverview.mockReset();
  runtime.getAllGameweeks.mockReset();
  runtime.getPlayers.mockReset();
  runtime.getPlayer.mockReset();
  runtime.getPlayerHistory.mockReset();
  runtime.getTeamsWithStats.mockReset();
  runtime.getTeam.mockReset();
  runtime.getTeamSquad.mockReset();
  runtime.getTeamFixtures.mockReset();
  runtime.searchTeams.mockReset();
  runtime.searchPlayers.mockReset();
  runtime.getCompareTeams.mockReset();
  runtime.getComparePlayers.mockReset();
  runtime.getComparePlayerHistories.mockReset();
  runtime.playerPhotoUrl.mockReset();
  runtime.teamBadgeUrl.mockReset();

  runtime.getOverview.mockReturnValue({ top_players: [] });
  runtime.getAllGameweeks.mockReturnValue([]);
  runtime.getPlayers.mockReturnValue([[], 0]);
  runtime.getPlayer.mockReturnValue(null);
  runtime.getPlayerHistory.mockReturnValue([]);
  runtime.getTeamsWithStats.mockReturnValue([]);
  runtime.getTeam.mockReturnValue(null);
  runtime.getTeamSquad.mockReturnValue([]);
  runtime.getTeamFixtures.mockReturnValue([]);
  runtime.searchTeams.mockReturnValue([]);
  runtime.searchPlayers.mockReturnValue([]);
  runtime.getCompareTeams.mockReturnValue([]);
  runtime.getComparePlayers.mockReturnValue([]);
  runtime.getComparePlayerHistories.mockReturnValue({});
  runtime.playerPhotoUrl.mockImplementation(
    (code: number | null | undefined) => `/players/${code ?? "missing"}.png`,
  );
  runtime.teamBadgeUrl.mockImplementation(
    (teamId: number | null | undefined) => `/teams/${teamId ?? "missing"}.png`,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  while (APPS.length > 0) {
    await APPS.pop()?.close();
  }
});

describe("webapp/routers/api.ts", () => {
  it("enriches overview top players and proxies gameweeks", async () => {
    runtime.getOverview.mockReturnValue({
      totals: { players: 1 },
      top_players: [
        { fpl_id: 101, web_name: "Saka", code: 77, team_fpl_id: 3 },
      ],
    });
    runtime.getAllGameweeks.mockReturnValue([{ fpl_id: 1 }, { fpl_id: 2 }]);

    const app = await createApiApp();
    const overview = await app.inject({ method: "GET", url: "/api/overview" });
    const gameweeks = await app.inject({
      method: "GET",
      url: "/api/gameweeks",
    });

    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toEqual({
      totals: { players: 1 },
      top_players: [
        {
          fpl_id: 101,
          web_name: "Saka",
          code: 77,
          team_fpl_id: 3,
          photo_url: "/players/77.png",
          badge_url: "/teams/3.png",
        },
      ],
    });
    expect(gameweeks.statusCode).toBe(200);
    expect(gameweeks.json()).toEqual([{ fpl_id: 1 }, { fpl_id: 2 }]);
  });

  it("passes player filters through, enriches results, and returns detail/history responses", async () => {
    runtime.getPlayers.mockImplementation((options) => {
      expect(options).toEqual({
        pos: 3,
        team: 14,
        status: "a",
        minCost: 65,
        maxCost: 110,
        sort: "form",
        order: "asc",
        page: 2,
        perPage: 15,
      });
      return [
        [{ fpl_id: 7, web_name: "Bruno", code: 19, team_fpl_id: 14 }],
        83,
      ];
    });
    runtime.getPlayer.mockImplementation((fplId: number) =>
      fplId === 7
        ? { fpl_id: 7, web_name: "Bruno", code: 19, team_fpl_id: 14 }
        : null,
    );
    runtime.getPlayerHistory.mockReturnValue([
      { gameweek_fpl_id: 1, total_points: 9 },
      { gameweek_fpl_id: 2, total_points: 3 },
    ]);

    const app = await createApiApp();
    const listResponse = await app.inject({
      method: "GET",
      url: "/api/players?pos=3&team=14&status=a&min_cost=65&max_cost=110&sort=form&order=asc&page=2&per_page=15",
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: "/api/players/7",
    });
    const historyResponse = await app.inject({
      method: "GET",
      url: "/api/players/7/history",
    });
    const missingResponse = await app.inject({
      method: "GET",
      url: "/api/players/999",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      players: [
        {
          fpl_id: 7,
          web_name: "Bruno",
          code: 19,
          team_fpl_id: 14,
          photo_url: "/players/19.png",
          badge_url: "/teams/14.png",
        },
      ],
      total: 83,
      page: 2,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toEqual({
      fpl_id: 7,
      web_name: "Bruno",
      code: 19,
      team_fpl_id: 14,
      photo_url: "/players/19.png",
      badge_url: "/teams/14.png",
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json()).toEqual([
      { gameweek_fpl_id: 1, total_points: 9 },
      { gameweek_fpl_id: 2, total_points: 3 },
    ]);
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toEqual({ detail: "Player not found" });
  });

  it("enriches teams, squad, and missing-team errors", async () => {
    runtime.getTeamsWithStats.mockReturnValue([
      { fpl_id: 8, name: "Chelsea", points: 60 },
    ]);
    runtime.getTeam.mockImplementation((fplId: number) =>
      fplId === 8 ? { fpl_id: 8, name: "Chelsea" } : null,
    );
    runtime.getTeamSquad.mockReturnValue([
      { fpl_id: 12, web_name: "Palmer", code: 55, team_fpl_id: 8 },
    ]);
    runtime.getTeamFixtures.mockReturnValue([{ id: 1, opponent: "ARS" }]);

    const app = await createApiApp();
    const teamsResponse = await app.inject({
      method: "GET",
      url: "/api/teams",
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: "/api/teams/8",
    });
    const missingResponse = await app.inject({
      method: "GET",
      url: "/api/teams/404",
    });

    expect(teamsResponse.statusCode).toBe(200);
    expect(teamsResponse.json()).toEqual([
      { fpl_id: 8, name: "Chelsea", points: 60, badge_url: "/teams/8.png" },
    ]);
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toEqual({
      team: { fpl_id: 8, name: "Chelsea", badge_url: "/teams/8.png" },
      squad: [
        {
          fpl_id: 12,
          web_name: "Palmer",
          code: 55,
          team_fpl_id: 8,
          photo_url: "/players/55.png",
          badge_url: "/teams/8.png",
        },
      ],
      fixtures: [{ id: 1, opponent: "ARS" }],
    });
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toEqual({ detail: "Team not found" });
  });

  it("trims search queries, returns empty results for blank input, and maps player/team results", async () => {
    runtime.searchTeams.mockImplementation((query: string) => {
      expect(query).toBe("villa");
      return [{ fpl_id: 2, name: "Aston Villa", short_name: "AVL" }];
    });
    runtime.searchPlayers.mockImplementation((query: string) => {
      expect(query).toBe("wat");
      return [{ fpl_id: 1, web_name: "Watkins", team_short: "AVL", code: 101 }];
    });

    const app = await createApiApp();
    const teamResponse = await app.inject({
      method: "GET",
      url: "/api/search?q=%20%20villa%20%20&type=team",
    });
    const playerResponse = await app.inject({
      method: "GET",
      url: "/api/search?q=%20%20wat%20%20",
    });
    const blankResponse = await app.inject({
      method: "GET",
      url: "/api/search?q=%20%20%20",
    });

    expect(teamResponse.statusCode).toBe(200);
    expect(teamResponse.json()).toEqual([
      {
        id: 2,
        label: "Aston Villa",
        sub: "AVL",
        badge_url: "/teams/2.png",
        type: "team",
      },
    ]);
    expect(playerResponse.statusCode).toBe(200);
    expect(playerResponse.json()).toEqual([
      {
        id: 1,
        label: "Watkins",
        sub: "AVL",
        photo_url: "/players/101.png",
        type: "player",
      },
    ]);
    expect(blankResponse.statusCode).toBe(200);
    expect(blankResponse.json()).toEqual([]);
    expect(runtime.searchTeams).toHaveBeenCalledTimes(1);
    expect(runtime.searchPlayers).toHaveBeenCalledTimes(1);
  });

  it("builds compare payloads for player and team modes and rejects invalid ids", async () => {
    runtime.getComparePlayers.mockReturnValue([
      {
        fpl_id: 1,
        web_name: "Salah",
        code: 11,
        team_fpl_id: 10,
        total_points: 200,
        assists: 12,
      },
      {
        fpl_id: 2,
        web_name: "Saka",
        code: 22,
        team_fpl_id: 3,
        total_points: 180,
        assists: 10,
      },
    ]);
    runtime.getComparePlayerHistories.mockReturnValue({
      1: [
        { gameweek_fpl_id: 2, total_points: 6, assists: 1 },
        { gameweek_fpl_id: 1, total_points: 10, assists: 0 },
      ],
      2: [{ gameweek_fpl_id: 2, total_points: 7, assists: 2 }],
    });
    runtime.getCompareTeams.mockReturnValue([
      { fpl_id: 3, name: "Arsenal", points: 70, wins: 22 },
      { fpl_id: 7, name: "Liverpool", points: 68, wins: 21 },
    ]);

    const app = await createApiApp();
    const emptyResponse = await app.inject({
      method: "GET",
      url: "/api/compare",
    });
    const playerResponse = await app.inject({
      method: "GET",
      url: "/api/compare?ids=1,2&metrics=total_points,assists",
    });
    const teamResponse = await app.inject({
      method: "GET",
      url: "/api/compare?ids=%203%20,%207%20&type=team&metrics=points,wins",
    });
    const badResponse = await app.inject({
      method: "GET",
      url: "/api/compare?ids=3,nope",
    });

    expect(emptyResponse.statusCode).toBe(200);
    expect(emptyResponse.json()).toEqual({
      entities: [],
      metrics: [],
      datasets: [],
    });

    expect(playerResponse.statusCode).toBe(200);
    expect(playerResponse.json()).toEqual({
      entities: [
        {
          fpl_id: 1,
          web_name: "Salah",
          code: 11,
          team_fpl_id: 10,
          total_points: 200,
          assists: 12,
          photo_url: "/players/11.png",
          badge_url: "/teams/10.png",
        },
        {
          fpl_id: 2,
          web_name: "Saka",
          code: 22,
          team_fpl_id: 3,
          total_points: 180,
          assists: 10,
          photo_url: "/players/22.png",
          badge_url: "/teams/3.png",
        },
      ],
      metrics: ["total_points", "assists"],
      gameweeks: [1, 2],
      datasets: {
        total_points: [
          {
            label: "Salah",
            data: [10, 6],
            borderColor: "#00ff87",
            backgroundColor: "#00ff8733",
          },
          {
            label: "Saka",
            data: [null, 7],
            borderColor: "#38bdf8",
            backgroundColor: "#38bdf833",
          },
        ],
        assists: [
          {
            label: "Salah",
            data: [0, 1],
            borderColor: "#00ff87",
            backgroundColor: "#00ff8733",
          },
          {
            label: "Saka",
            data: [null, 2],
            borderColor: "#38bdf8",
            backgroundColor: "#38bdf833",
          },
        ],
      },
      table: [
        { metric: "total_points", "1": 200, "2": 180 },
        { metric: "assists", "1": 12, "2": 10 },
      ],
    });

    expect(teamResponse.statusCode).toBe(200);
    expect(teamResponse.json()).toEqual({
      entities: [
        {
          fpl_id: 3,
          name: "Arsenal",
          points: 70,
          wins: 22,
          badge_url: "/teams/3.png",
        },
        {
          fpl_id: 7,
          name: "Liverpool",
          points: 68,
          wins: 21,
          badge_url: "/teams/7.png",
        },
      ],
      metrics: ["points", "wins"],
      table: [
        { metric: "points", "3": 70, "7": 68 },
        { metric: "wins", "3": 22, "7": 21 },
      ],
      histories: {},
    });
    expect(runtime.getCompareTeams).toHaveBeenCalledWith([3, 7]);

    expect(badResponse.statusCode).toBe(400);
    expect(badResponse.json()).toEqual({ detail: "Invalid ids" });
  });
});

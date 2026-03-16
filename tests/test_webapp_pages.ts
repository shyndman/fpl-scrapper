import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  getOverview: vi.fn<() => Record<string, unknown>>(),
  getAllTeams: vi.fn<() => Array<Record<string, unknown>>>(),
  getAllGameweeks: vi.fn<() => Array<Record<string, unknown>>>(),
  getPlayers:
    vi.fn<
      (
        options: Record<string, unknown>,
      ) => [Array<Record<string, unknown>>, number]
    >(),
  getPlayer: vi.fn<(fplId: number) => Record<string, unknown> | null>(),
  getPlayerHistory: vi.fn<(fplId: number) => Array<Record<string, unknown>>>(),
  getPlayerHistoryPast:
    vi.fn<(fplId: number) => Array<Record<string, unknown>>>(),
  getTeamsWithStats: vi.fn<() => Array<Record<string, unknown>>>(),
  getTeam: vi.fn<(fplId: number) => Record<string, unknown> | null>(),
  getTeamSquad: vi.fn<(fplId: number) => Array<Record<string, unknown>>>(),
  getTeamFixtures:
    vi.fn<(fplId: number, limit: number) => Array<Record<string, unknown>>>(),
}));

vi.mock("../webapp/db.ts", () => ({
  getOverview: runtime.getOverview,
  getAllTeams: runtime.getAllTeams,
  getAllGameweeks: runtime.getAllGameweeks,
  getPlayers: runtime.getPlayers,
  getPlayer: runtime.getPlayer,
  getPlayerHistory: runtime.getPlayerHistory,
  getPlayerHistoryPast: runtime.getPlayerHistoryPast,
  getTeamsWithStats: runtime.getTeamsWithStats,
  getTeam: runtime.getTeam,
  getTeamSquad: runtime.getTeamSquad,
  getTeamFixtures: runtime.getTeamFixtures,
}));

const APPS: FastifyInstance[] = [];

function normalizeContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const request = context.request as
    | { method?: unknown; url?: unknown }
    | undefined;
  return {
    ...context,
    request:
      request === undefined
        ? undefined
        : {
            method: request.method,
            url: request.url,
          },
  };
}

async function createPagesApp(): Promise<FastifyInstance> {
  vi.resetModules();
  const { pageRoutes } = await import("../webapp/routers/pages.ts");
  const app = Fastify({ disableRequestLogging: true });
  await app.register(pageRoutes, {
    renderPage: (_reply, template, context) => ({
      template,
      context: normalizeContext(context),
    }),
  });
  await app.ready();
  APPS.push(app);
  return app;
}

beforeEach(() => {
  runtime.getOverview.mockReset();
  runtime.getAllTeams.mockReset();
  runtime.getAllGameweeks.mockReset();
  runtime.getPlayers.mockReset();
  runtime.getPlayer.mockReset();
  runtime.getPlayerHistory.mockReset();
  runtime.getPlayerHistoryPast.mockReset();
  runtime.getTeamsWithStats.mockReset();
  runtime.getTeam.mockReset();
  runtime.getTeamSquad.mockReset();
  runtime.getTeamFixtures.mockReset();

  runtime.getOverview.mockReturnValue({});
  runtime.getAllTeams.mockReturnValue([]);
  runtime.getAllGameweeks.mockReturnValue([]);
  runtime.getPlayers.mockReturnValue([[], 0]);
  runtime.getPlayer.mockReturnValue(null);
  runtime.getPlayerHistory.mockReturnValue([]);
  runtime.getPlayerHistoryPast.mockReturnValue([]);
  runtime.getTeamsWithStats.mockReturnValue([]);
  runtime.getTeam.mockReturnValue(null);
  runtime.getTeamSquad.mockReturnValue([]);
  runtime.getTeamFixtures.mockReturnValue([]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  while (APPS.length > 0) {
    await APPS.pop()?.close();
  }
});

describe("webapp/routers/pages.ts", () => {
  it("renders the dashboard template with overview context", async () => {
    runtime.getOverview.mockReturnValue({ total_players: 700 });
    runtime.getAllTeams.mockReturnValue([{ fpl_id: 1, name: "Arsenal" }]);
    runtime.getAllGameweeks.mockReturnValue([{ fpl_id: 25, is_current: true }]);

    const app = await createPagesApp();
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      template: "dashboard.html",
      context: {
        request: { method: "GET", url: "/" },
        overview: { total_players: 700 },
        teams: [{ fpl_id: 1, name: "Arsenal" }],
        gameweeks: [{ fpl_id: 25, is_current: true }],
        page_title: "Dashboard",
      },
    });
  });

  it("preserves player filters and computes pagination", async () => {
    runtime.getPlayers.mockImplementation((options) => {
      expect(options).toEqual({
        pos: 4,
        team: 2,
        status: "a",
        minCost: 70,
        maxCost: 150,
        gwStart: 5,
        gwEnd: 7,
        sort: "minutes",
        order: "asc",
        page: 3,
        perPage: 40,
      });
      return [[{ fpl_id: 9, web_name: "Haaland" }], 81];
    });
    runtime.getAllTeams.mockReturnValue([{ fpl_id: 2, name: "Man City" }]);
    runtime.getAllGameweeks.mockReturnValue([{ fpl_id: 1 }, { fpl_id: 2 }]);

    const app = await createPagesApp();
    const response = await app.inject({
      method: "GET",
      url: "/players?pos=4&team=2&status=a&min_cost=70&max_cost=150&gw_start=5&gw_end=7&sort=minutes&order=asc&page=3",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      template: "players.html",
      context: {
        request: {
          method: "GET",
          url: "/players?pos=4&team=2&status=a&min_cost=70&max_cost=150&gw_start=5&gw_end=7&sort=minutes&order=asc&page=3",
        },
        players: [{ fpl_id: 9, web_name: "Haaland" }],
        teams: [{ fpl_id: 2, name: "Man City" }],
        gameweeks: [{ fpl_id: 1 }, { fpl_id: 2 }],
        total: 81,
        page: 3,
        total_pages: 3,
        per_page: 40,
        filter_pos: 4,
        filter_team: 2,
        filter_status: "a",
        filter_min_cost: 70,
        filter_max_cost: 150,
        filter_gw_start: 5,
        filter_gw_end: 7,
        filter_sort: "minutes",
        filter_order: "asc",
        page_title: "Players",
      },
    });
  });

  it("renders player detail context", async () => {
    runtime.getPlayer.mockImplementation((fplId: number) =>
      fplId === 11 ? { fpl_id: 11, web_name: "Salah", team_fpl_id: 7 } : null,
    );
    runtime.getPlayerHistory.mockReturnValue([
      { gameweek_fpl_id: 1, total_points: 10 },
    ]);
    runtime.getPlayerHistoryPast.mockReturnValue([
      { season_name: "2023/24", total_points: 211 },
    ]);
    runtime.getTeam.mockImplementation((fplId: number) =>
      fplId === 7 ? { fpl_id: 7, name: "Liverpool" } : null,
    );

    const app = await createPagesApp();
    const response = await app.inject({ method: "GET", url: "/players/11" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      template: "player_detail.html",
      context: {
        request: { method: "GET", url: "/players/11" },
        player: { fpl_id: 11, web_name: "Salah", team_fpl_id: 7 },
        history: [{ gameweek_fpl_id: 1, total_points: 10 }],
        history_past: [{ season_name: "2023/24", total_points: 211 }],
        team: { fpl_id: 7, name: "Liverpool" },
        page_title: "Salah",
      },
    });
  });

  it("returns the Python-matching 404 when a player is missing", async () => {
    const app = await createPagesApp();
    const response = await app.inject({ method: "GET", url: "/players/404" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ detail: "Player not found" });
  });

  it("renders the teams page context", async () => {
    runtime.getTeamsWithStats.mockReturnValue([{ fpl_id: 4, name: "Chelsea" }]);

    const app = await createPagesApp();
    const response = await app.inject({ method: "GET", url: "/teams" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      template: "teams.html",
      context: {
        request: { method: "GET", url: "/teams" },
        teams: [{ fpl_id: 4, name: "Chelsea" }],
        page_title: "Teams",
      },
    });
  });

  it("renders team detail context and keeps the fixture limit at eight", async () => {
    runtime.getTeam.mockImplementation((fplId: number) =>
      fplId === 6 ? { fpl_id: 6, name: "Spurs" } : null,
    );
    runtime.getTeamSquad.mockReturnValue([{ fpl_id: 21, web_name: "Son" }]);
    runtime.getTeamFixtures.mockImplementation(
      (fplId: number, limit: number) => {
        expect([fplId, limit]).toEqual([6, 8]);
        return [{ id: 1, opponent: "ARS" }];
      },
    );

    const app = await createPagesApp();
    const response = await app.inject({ method: "GET", url: "/teams/6" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      template: "team_detail.html",
      context: {
        request: { method: "GET", url: "/teams/6" },
        team: { fpl_id: 6, name: "Spurs" },
        squad: [{ fpl_id: 21, web_name: "Son" }],
        fixtures: [{ id: 1, opponent: "ARS" }],
        page_title: "Spurs",
      },
    });
  });

  it("returns the Python-matching 404 when a team is missing", async () => {
    const app = await createPagesApp();
    const response = await app.inject({ method: "GET", url: "/teams/404" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ detail: "Team not found" });
  });

  it("renders the compare page template", async () => {
    const app = await createPagesApp();
    const response = await app.inject({ method: "GET", url: "/compare" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      template: "compare.html",
      context: {
        request: { method: "GET", url: "/compare" },
        page_title: "Compare",
      },
    });
  });
});

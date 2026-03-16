import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
    vi.fn<(fplId: number, limit?: number) => Array<Record<string, unknown>>>(),
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

vi.mock("../src/logger.ts", () => ({
  getLogger: () => ({
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  }),
  setupLogging: () => ({
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  }),
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

import { FPLDatabase } from "../src/database.ts";
import { FPLNotFoundError } from "../src/errors.ts";
import { type CliDeps, EXIT_FATAL, EXIT_PARTIAL, EXIT_SUCCESS, main } from "../src/main.ts";
import { FPLSyncer } from "../src/sync.ts";
import {
  transform_bootstrap,
  transform_element_summary,
  transform_event_live,
  transform_fixtures,
} from "../src/transform.ts";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(TESTS_DIR, "fixtures");
const PYTHON_ORACLE = join(TESTS_DIR, "python_oracle.py");
const OPEN_DATABASES: FPLDatabase[] = [];
const TEMP_DIRECTORIES: string[] = [];
const APPS: FastifyInstance[] = [];

function loadFixture<T>(filename: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, filename), "utf8")) as T;
}

function pick<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}

function createDatabase(): FPLDatabase {
  const tempDirectory = mkdtempSync(join(tmpdir(), "fpl-parity-"));
  TEMP_DIRECTORIES.push(tempDirectory);
  const database = new FPLDatabase(join(tempDirectory, "test.db"));
  OPEN_DATABASES.push(database);
  database.initializeSchema();
  return database;
}

function normalizePageContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const { request: _request, ...rest } = context;
  return rest;
}

function execPython(command: string): string {
  const candidates = ["python3", "python"];
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      return execFileSync(candidate, [PYTHON_ORACLE, command], {
        cwd: dirname(TESTS_DIR),
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONPATH: dirname(TESTS_DIR),
        },
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("python executable not available");
}

function runPythonOracle<T>(command: string): T {
  try {
    return JSON.parse(execPython(command)) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Python oracle failed for ${command}: ${message}`);
  }
}

class FixtureBackedApi {
  requestCount = 0;
  readonly #bootstrap = loadFixture<Record<string, unknown>>(
    "bootstrap_static.json",
  );
  readonly #fixtures = loadFixture<Array<Record<string, unknown>>>(
    "fixtures.json",
  );
  readonly #eventLive = loadFixture<Record<string, unknown>>(
    "event_25_live.json",
  );
  readonly #elementSummary = loadFixture<Record<string, unknown>>(
    "element_summary_318.json",
  );
  readonly #missingPlayerIds: ReadonlySet<number>;

  constructor(options: { missingPlayerIds?: Iterable<number> } = {}) {
    this.#missingPlayerIds = new Set(options.missingPlayerIds ?? []);
  }

  async getBootstrapStatic(): Promise<unknown> {
    this.requestCount += 1;
    return structuredClone(this.#bootstrap);
  }

  async getFixtures(gameweek?: number): Promise<unknown[]> {
    this.requestCount += 1;
    const fixtures = structuredClone(this.#fixtures);
    if (gameweek === undefined) {
      return fixtures;
    }
    return fixtures.filter((fixture) => fixture.event === gameweek);
  }

  async getEventLive(gameweek: number): Promise<unknown> {
    this.requestCount += 1;
    if (gameweek !== 25) {
      return { elements: [] };
    }
    return structuredClone(this.#eventLive);
  }

  async getElementSummary(playerId: number): Promise<unknown> {
    this.requestCount += 1;
    if (this.#missingPlayerIds.has(playerId)) {
      throw new FPLNotFoundError("404");
    }
    if (playerId !== 318) {
      throw new FPLNotFoundError(`404 Not Found: player ${playerId}`);
    }
    return structuredClone(this.#elementSummary);
  }
}

function transformActualPayload(): Record<string, unknown> {
  const [teams, gameweeks, players] = transform_bootstrap(
    loadFixture<Record<string, unknown>>("bootstrap_static.json"),
  );
  const [history, historyPast] = transform_element_summary(
    318,
    loadFixture<Record<string, unknown>>("element_summary_318.json"),
  );
  const fixtures = transform_fixtures(loadFixture<unknown>("fixtures.json"));
  const liveRows = transform_event_live(
    25,
    loadFixture<Record<string, unknown>>("event_25_live.json"),
  );
  const currentGameweek = gameweeks.find((gameweek) => gameweek.is_current === 1);
  if (!currentGameweek) {
    throw new Error("Expected current gameweek in bootstrap fixture");
  }

  return {
    bootstrap: {
      counts: {
        teams: teams.length,
        gameweeks: gameweeks.length,
        players: players.length,
      },
      team: pick(teams[0], ["fpl_id", "name", "short_name", "strength"]),
      current_gameweek: pick(currentGameweek, [
        "fpl_id",
        "name",
        "deadline_time",
        "is_current",
        "is_finished",
        "chip_plays",
      ]),
      player: pick(players[0], [
        "fpl_id",
        "web_name",
        "team_fpl_id",
        "element_type",
        "now_cost",
        "total_points",
        "form",
        "selected_by_percent",
        "expected_goals",
        "expected_assists",
        "expected_goal_involvements",
        "expected_goals_conceded",
        "xgp",
        "xap",
        "xgip",
        "defensive_contribution",
        "defensive_contribution_per_90",
      ]),
    },
    element_summary: {
      history: pick(history[0], [
        "player_fpl_id",
        "gameweek_fpl_id",
        "total_points",
        "goals_scored",
        "assists",
        "expected_goals",
        "expected_assists",
        "expected_goal_involvements",
        "expected_goals_conceded",
        "xgp",
        "xap",
        "xgip",
        "value",
        "selected",
      ]),
      history_past: pick(historyPast[0], [
        "player_fpl_id",
        "season_name",
        "total_points",
        "expected_goals",
        "expected_assists",
        "expected_goal_involvements",
        "expected_goals_conceded",
      ]),
    },
    fixtures: {
      fixture: {
        ...pick(fixtures[0], [
          "fpl_id",
          "gameweek_fpl_id",
          "team_h_fpl_id",
          "team_a_fpl_id",
          "finished",
          "team_h_score",
          "team_a_score",
        ]),
        stats: JSON.parse(fixtures[0].stats as string),
      },
    },
    event_live: {
      row: {
        ...pick(liveRows[0], [
          "player_fpl_id",
          "gameweek_fpl_id",
          "total_points",
          "in_dreamteam",
          "minutes",
          "influence",
          "expected_goals_conceded",
        ]),
        explain: JSON.parse(liveRows[0].explain as string),
      },
    },
  };
}

function readSyncSnapshot(db: FPLDatabase): Record<string, unknown> {
  const fixture = db._conn
    .prepare(
      "SELECT fpl_id, gameweek_fpl_id, team_h_fpl_id, team_a_fpl_id, finished, team_h_score, team_a_score, stats FROM fixtures ORDER BY fpl_id LIMIT 1",
    )
    .get() as Record<string, unknown> | undefined;
  const live = db._conn
    .prepare(
      "SELECT player_fpl_id, gameweek_fpl_id, total_points, in_dreamteam, minutes, influence, expected_goals_conceded, explain FROM live_gameweek_stats ORDER BY player_fpl_id, gameweek_fpl_id LIMIT 1",
    )
    .get() as Record<string, unknown> | undefined;

  return {
    player_ids: db.getAllPlayerFplIds(),
    player_history:
      (db._conn
        .prepare(
          "SELECT player_fpl_id, gameweek_fpl_id, total_points, xgp, xap, xgip FROM player_history ORDER BY player_fpl_id, gameweek_fpl_id LIMIT 1",
        )
        .get() as Record<string, unknown> | undefined) ?? null,
    player_history_past:
      (db._conn
        .prepare(
          "SELECT player_fpl_id, season_name, total_points FROM player_history_past ORDER BY player_fpl_id, season_name LIMIT 1",
        )
        .get() as Record<string, unknown> | undefined) ?? null,
    fixture:
      fixture === undefined
        ? null
        : {
            ...fixture,
            stats:
              typeof fixture.stats === "string" ? JSON.parse(fixture.stats) : null,
          },
    live:
      live === undefined
        ? null
        : {
            ...live,
            explain:
              typeof live.explain === "string" ? JSON.parse(live.explain) : null,
          },
    scrape_log:
      (db._conn
        .prepare(
          "SELECT mode, gameweek_fpl_id, status, players_scraped, requests_made, errors_encountered, error_detail FROM scrape_log ORDER BY id DESC LIMIT 1",
        )
        .get() as Record<string, unknown> | undefined) ?? null,
    counts: {
      teams: (db._conn.prepare("SELECT COUNT(*) AS count FROM teams").get() as { count: number }).count,
      gameweeks: (db._conn.prepare("SELECT COUNT(*) AS count FROM gameweeks").get() as { count: number }).count,
      players: (db._conn.prepare("SELECT COUNT(*) AS count FROM players").get() as { count: number }).count,
      player_history: (db._conn.prepare("SELECT COUNT(*) AS count FROM player_history").get() as { count: number }).count,
      player_history_past: (db._conn.prepare("SELECT COUNT(*) AS count FROM player_history_past").get() as { count: number }).count,
      fixtures: (db._conn.prepare("SELECT COUNT(*) AS count FROM fixtures").get() as { count: number }).count,
      live_gameweek_stats: (db._conn.prepare("SELECT COUNT(*) AS count FROM live_gameweek_stats").get() as { count: number }).count,
    },
  };
}

async function runTsFullSync(options: {
  missingPlayerIds?: Iterable<number>;
}): Promise<Record<string, unknown>> {
  const db = createDatabase();
  const api = new FixtureBackedApi(options);
  const syncer = new FPLSyncer(api as never, db, false);
  const result = await syncer.fullSync();

  return {
    result: {
      mode: result.mode,
      players_synced: result.playersSynced,
      requests_made: result.requestsMade,
      errors: result.errors,
      warnings: result.warnings,
      summary: result.summary(),
    },
    db: readSyncSnapshot(db),
  };
}

async function createApiApp(): Promise<FastifyInstance> {
  vi.resetModules();
  const { apiRoutes } = await import("../webapp/routers/api.ts");
  const app = Fastify({ disableRequestLogging: true });
  await app.register(apiRoutes, { prefix: "/api" });
  await app.ready();
  APPS.push(app);
  return app;
}

async function createPagesApp(): Promise<FastifyInstance> {
  vi.resetModules();
  const { pageRoutes } = await import("../webapp/routers/pages.ts");
  const app = Fastify({ disableRequestLogging: true });
  await app.register(pageRoutes, {
    renderPage: (_reply, template, context) => ({ template, context }),
  });
  await app.ready();
  APPS.push(app);
  return app;
}

function createCliDeps(result: {
  errors: number;
  playersSynced: number;
  summary: string;
}): CliDeps {
  const syncResult = {
    errors: result.errors,
    playersSynced: result.playersSynced,
    summary: () => result.summary,
  };

  return {
    settings: {
      DB_PATH: "/tmp/fpl.db",
      LOG_FILE: "/tmp/fpl.log",
      SESSION_FILE: "/tmp/session.json",
      FPL_BASE_URL: "https://fantasy.premierleague.com/api",
      FPL_LOGIN_URL: "https://users.premierleague.com/accounts/login/",
      FPL_LOGIN: "user@example.com",
      FPL_PASSWORD: "secret",
      REQUEST_DELAY_MIN: 2,
      REQUEST_DELAY_MAX: 3,
      BACKOFF_FACTOR: 2,
      MAX_RETRIES: 5,
      MAX_BACKOFF: 120,
      REQUEST_TIMEOUT: 30,
      LOG_LEVEL: "INFO",
    },
    setupLogging: () => ({
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }),
    createDatabase: () => ({
      initializeSchema: () => undefined,
      close: () => undefined,
    }),
    createAuth: () => ({
      getCookies: async () => ({ sessionid: "session-cookie" }),
      invalidate: async () => undefined,
    }),
    createScraper: () => ({ requestCount: 0 }) as never,
    createApi: () => ({ discover: async () => ({}) }),
    createSyncer: () => ({
      fullSync: async () => syncResult,
      gameweekSync: async () => syncResult,
    }),
    printLine: () => undefined,
    printError: () => undefined,
  };
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
  runtime.searchTeams.mockReset();
  runtime.searchPlayers.mockReset();
  runtime.getCompareTeams.mockReset();
  runtime.getComparePlayers.mockReset();
  runtime.getComparePlayerHistories.mockReset();
  runtime.playerPhotoUrl.mockReset();
  runtime.teamBadgeUrl.mockReset();

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

  for (const db of OPEN_DATABASES.splice(0)) {
    try {
      db.close();
    } catch {
      // Database may already be closed by the test.
    }
  }

  for (const tempDirectory of TEMP_DIRECTORIES.splice(0)) {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

describe("migrate-to-ts parity coverage", () => {
  it("matches Python transform outputs and derived fields for the checked-in fixtures", () => {
    const oracle = runPythonOracle<Record<string, unknown>>("transform");
    const actual = transformActualPayload();

    expect(actual).toEqual(oracle);
  });

  it("matches Python full-sync result summaries and SQLite state on a successful run", async () => {
    const oracle = runPythonOracle<Record<string, unknown>>("sync-success");
    const actual = await runTsFullSync({});

    expect(actual).toEqual(oracle);
  });

  it("matches Python partial-failure accounting and scrape-log outcomes", async () => {
    const oracle = runPythonOracle<Record<string, unknown>>("sync-partial");
    const actual = await runTsFullSync({ missingPlayerIds: [318] });

    expect(actual).toEqual(oracle);
  });

  it("keeps the CLI exit mapping characterized by the Python tests", async () => {
    await expect(
      main(["--full-sync"], createCliDeps({
        errors: 0,
        playersSynced: 3,
        summary: "mode=full_sync players=3 requests=12 errors=0",
      })),
    ).resolves.toBe(EXIT_SUCCESS);

    await expect(
      main(["--current-gameweek"], createCliDeps({
        errors: 2,
        playersSynced: 5,
        summary: "mode=gameweek_sync gw=25 players=5 requests=9 errors=2",
      })),
    ).resolves.toBe(EXIT_PARTIAL);

    await expect(
      main(["--full-sync"], createCliDeps({
        errors: 1,
        playersSynced: 0,
        summary: "mode=full_sync players=0 requests=4 errors=1",
      })),
    ).resolves.toBe(EXIT_FATAL);
  });

  it("matches the Python-characterized API response shape for filtered players", async () => {
    runtime.getPlayers.mockReturnValue([
      [{ fpl_id: 7, web_name: "Bruno", code: 19, team_fpl_id: 14 }],
      83,
    ]);

    const app = await createApiApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/players?pos=3&team=14&status=a&min_cost=65&max_cost=110&sort=form&order=asc&page=2&per_page=15",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
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
  });

  it("matches the Python-characterized players page context apart from framework request objects", async () => {
    runtime.getPlayers.mockReturnValue([[{ fpl_id: 9, web_name: "Haaland" }], 81]);
    runtime.getAllTeams.mockReturnValue([{ fpl_id: 2, name: "Man City" }]);
    runtime.getAllGameweeks.mockReturnValue([{ fpl_id: 1 }, { fpl_id: 2 }]);

    const app = await createPagesApp();
    const response = await app.inject({
      method: "GET",
      url: "/players?pos=4&team=2&status=a&min_cost=70&max_cost=150&gw_start=5&gw_end=7&sort=minutes&order=asc&page=3",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().template).toBe("players.html");
    expect(normalizePageContext(response.json().context)).toEqual({
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
    });
  });
});

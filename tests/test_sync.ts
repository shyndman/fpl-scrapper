import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture<T>(filename: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, filename), "utf8")) as T;
}

const OPEN_DATABASES: FPLDatabase[] = [];
const TEMP_DIRECTORIES: string[] = [];

afterEach(() => {
  for (const db of OPEN_DATABASES.splice(0)) {
    try {
      db.close();
    } catch {
      // Some tests close explicitly before cleanup.
    }
  }

  for (const tempDirectory of TEMP_DIRECTORIES.splice(0)) {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

vi.mock("../src/logger.ts", () => ({
  getLogger: () => ({
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  }),
}));

import { FPLDatabase } from "../src/database.ts";
import { FPLAPIError, FPLNotFoundError } from "../src/errors.ts";
import { FPLSyncer, SyncResult, _findCurrentGw } from "../src/sync.ts";
import { Gameweek } from "../src/models.ts";
import { transform_bootstrap } from "../src/transform.ts";

function createDatabase(): FPLDatabase {
  const tempDirectory = mkdtempSync(join(tmpdir(), "fpl-sync-"));
  TEMP_DIRECTORIES.push(tempDirectory);

  const database = new FPLDatabase(join(tempDirectory, "test.db"));
  OPEN_DATABASES.push(database);
  database.initializeSchema();
  return database;
}

type SummaryFailureMap = Map<number, Error>;

class FixtureBackedApi {
  requestCount = 0;
  readonly #bootstrap = loadFixture<Record<string, unknown>>(
    "bootstrap_static.json",
  );
  readonly #fixtures = loadFixture<unknown[]>("fixtures.json");
  readonly #eventLive =
    loadFixture<Record<string, unknown>>("event_25_live.json");
  readonly #elementSummary = loadFixture<Record<string, unknown>>(
    "element_summary_318.json",
  );
  readonly #summaryFailures: SummaryFailureMap;
  readonly #fixturesFailure: Error | null;

  constructor(
    options: {
      summaryFailures?: SummaryFailureMap;
      fixturesFailure?: Error;
    } = {},
  ) {
    this.#summaryFailures = options.summaryFailures ?? new Map();
    this.#fixturesFailure = options.fixturesFailure ?? null;
  }

  async getBootstrapStatic(): Promise<unknown> {
    this.requestCount += 1;
    return structuredClone(this.#bootstrap);
  }

  async getFixtures(gameweek?: number): Promise<unknown[]> {
    this.requestCount += 1;
    if (this.#fixturesFailure) {
      throw this.#fixturesFailure;
    }

    const fixtures = structuredClone(this.#fixtures);
    if (gameweek === undefined) {
      return fixtures;
    }
    return fixtures.filter(
      (fixture): fixture is Record<string, unknown> =>
        typeof fixture === "object" &&
        fixture !== null &&
        "event" in fixture &&
        fixture.event === gameweek,
    );
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
    const failure = this.#summaryFailures.get(playerId);
    if (failure) {
      throw failure;
    }
    if (playerId !== 318) {
      throw new FPLNotFoundError(`404 Not Found: player ${playerId}`);
    }
    return structuredClone(this.#elementSummary);
  }
}

describe("src/sync.ts helpers", () => {
  it("finds the current gameweek before considering finished fallbacks", () => {
    const [, gameweeks] = transform_bootstrap(
      loadFixture<Record<string, unknown>>("bootstrap_static.json"),
    );

    expect(_findCurrentGw(gameweeks)).toBe(25);
  });

  it("falls back to the most recent finished gameweek when none is current", () => {
    const current = new Gameweek(
      24,
      "GW24",
      "2025-02-01T11:00:00Z",
      null,
      null,
      null,
      0,
      0,
      1,
      null,
      null,
      null,
      null,
      null,
      null,
      "2025-02-01T11:00:00Z",
    );
    const earlier = new Gameweek(
      23,
      "GW23",
      "2025-01-25T11:00:00Z",
      null,
      null,
      null,
      0,
      0,
      1,
      null,
      null,
      null,
      null,
      null,
      null,
      "2025-01-25T11:00:00Z",
    );

    expect(_findCurrentGw([earlier, current])).toBe(24);
  });

  it("returns undefined when no gameweek is current or finished", () => {
    const future = new Gameweek(
      26,
      "GW26",
      "2025-02-08T11:00:00Z",
      null,
      null,
      null,
      0,
      1,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      "2025-02-08T11:00:00Z",
    );

    expect(_findCurrentGw([future])).toBeUndefined();
  });

  it("summarizes sync results with and without a gameweek id", () => {
    expect(
      new SyncResult({
        errors: 1,
        gameweekId: 25,
        mode: "gameweek_sync",
        playersSynced: 3,
        requestsMade: 12,
      }).summary(),
    ).toBe("mode=gameweek_sync gw=25 players=3 requests=12 errors=1");

    expect(
      new SyncResult({
        mode: "full_sync",
        playersSynced: 4,
        requestsMade: 8,
      }).summary(),
    ).toBe("mode=full_sync players=4 requests=8 errors=0");
  });
});

describe("FPLSyncer fullSync", () => {
  it("returns a populated dry-run result without writing rows or scrape logs", async () => {
    const db = createDatabase();
    const api = new FixtureBackedApi();
    const syncer = new FPLSyncer(api, db, true);

    const result = await syncer.fullSync();

    expect(result).toMatchObject({
      mode: "full_sync",
      playersSynced: 1,
      requestsMade: 4,
      errors: 0,
      warnings: [],
    });
    expect(db.getAllPlayerFplIds()).toEqual([]);
    expect(
      db._conn.prepare("SELECT COUNT(*) AS count FROM scrape_log").get(),
    ).toMatchObject({ count: 0 });
  });

  it("writes bootstrap, history, and scrape-log rows on a real database", async () => {
    const db = createDatabase();
    const api = new FixtureBackedApi();
    const syncer = new FPLSyncer(api, db, false);

    const result = await syncer.fullSync();

    expect(result).toMatchObject({
      mode: "full_sync",
      playersSynced: 1,
      requestsMade: 4,
      errors: 0,
    });
    expect(db.getAllPlayerFplIds()).toEqual([318]);
    expect(
      db._conn
        .prepare(
          "SELECT COUNT(*) AS count FROM player_history WHERE player_fpl_id = 318 AND gameweek_fpl_id = 24",
        )
        .get(),
    ).toMatchObject({ count: 1 });
    expect(db.getLastSuccessfulScrape("full_sync")).toMatchObject({
      errors_encountered: 0,
      mode: "full_sync",
      players_scraped: 1,
      requests_made: 4,
      status: "success",
    });
  });

  it("records partial failures and keeps going when a player summary is missing", async () => {
    const db = createDatabase();
    const api = new FixtureBackedApi({
      summaryFailures: new Map([[318, new FPLNotFoundError("404")]]),
    });
    const syncer = new FPLSyncer(api, db, false);

    const result = await syncer.fullSync();

    const log = db._conn
      .prepare(
        "SELECT status, players_scraped, requests_made, errors_encountered FROM scrape_log WHERE mode = 'full_sync' ORDER BY started_at DESC LIMIT 1",
      )
      .get();
    expect(result).toMatchObject({
      errors: 1,
      playersSynced: 0,
      requestsMade: 4,
      warnings: ["Player 318: 404 Not Found"],
    });
    expect(log).toMatchObject({
      status: "partial",
      players_scraped: 0,
      requests_made: 4,
      errors_encountered: 1,
    });
  });

  it("rethrows fatal errors after recording scrape-log error state", async () => {
    const db = createDatabase();
    const api = new FixtureBackedApi({
      fixturesFailure: new Error("fixtures failed"),
    });
    const syncer = new FPLSyncer(api, db, false);

    await expect(syncer.fullSync()).rejects.toThrow("fixtures failed");

    expect(
      db._conn
        .prepare(
          "SELECT status, players_scraped, requests_made, errors_encountered, error_detail FROM scrape_log WHERE mode = 'full_sync' ORDER BY started_at DESC LIMIT 1",
        )
        .get(),
    ).toMatchObject({
      status: "error",
      players_scraped: 0,
      requests_made: 2,
      errors_encountered: 1,
      error_detail: "fixtures failed",
    });
  });
});

describe("FPLSyncer gameweekSync", () => {
  it("auto-detects the current gameweek from the database in dry-run mode", async () => {
    const db = createDatabase();
    const [, gameweeks] = transform_bootstrap(
      loadFixture<Record<string, unknown>>("bootstrap_static.json"),
    );
    db.upsertGameweeks(gameweeks);

    const api = new FixtureBackedApi();
    const syncer = new FPLSyncer(api, db, true);

    const result = await syncer.gameweekSync();

    expect(result).toMatchObject({
      mode: "gameweek_sync",
      gameweekId: 25,
      playersSynced: 1,
      requestsMade: 4,
      errors: 0,
    });
    expect(db.getActivePlayerIdsInGw(25)).toEqual([]);
  });

  it("errors when no current gameweek exists in the database", async () => {
    const db = createDatabase();
    const syncer = new FPLSyncer(new FixtureBackedApi(), db, true);

    await expect(syncer.gameweekSync()).rejects.toThrow(
      "No current gameweek in the database",
    );
  });

  it("also errors when the database only has finished gameweeks and no current one", async () => {
    const db = createDatabase();
    const [, gameweeks] = transform_bootstrap(
      loadFixture<Record<string, unknown>>("bootstrap_static.json"),
    );
    const finishedOnly = gameweeks.map(
      (gameweek) =>
        new Gameweek(
          gameweek.fpl_id,
          gameweek.name,
          gameweek.deadline_time,
          gameweek.average_entry_score,
          gameweek.highest_score,
          gameweek.highest_scoring_entry,
          0,
          gameweek.is_next,
          gameweek.is_finished,
          gameweek.chip_plays,
          gameweek.most_selected,
          gameweek.most_transferred_in,
          gameweek.most_captained,
          gameweek.most_vice_captained,
          gameweek.transfers_made,
          gameweek.scraped_at,
        ),
    );
    db.upsertGameweeks(finishedOnly);

    const syncer = new FPLSyncer(new FixtureBackedApi(), db, true);

    await expect(syncer.gameweekSync()).rejects.toThrow(
      "No current gameweek in the database",
    );
  });

  it("records partial failures and request counts for active-player refreshes", async () => {
    const db = createDatabase();
    const api = new FixtureBackedApi({
      summaryFailures: new Map([[318, new FPLAPIError("boom")]]),
    });
    const syncer = new FPLSyncer(api, db, false);

    const result = await syncer.gameweekSync(25);

    const log = db._conn
      .prepare(
        "SELECT status, gameweek_fpl_id, players_scraped, requests_made, errors_encountered FROM scrape_log WHERE mode = 'gameweek_sync' ORDER BY started_at DESC LIMIT 1",
      )
      .get();
    expect(result).toMatchObject({
      gameweekId: 25,
      playersSynced: 0,
      requestsMade: 4,
      errors: 1,
      warnings: [],
    });
    expect(log).toMatchObject({
      status: "partial",
      gameweek_fpl_id: 25,
      players_scraped: 0,
      requests_made: 4,
      errors_encountered: 1,
    });
  });
});

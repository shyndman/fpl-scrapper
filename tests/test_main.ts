import { afterEach, describe, expect, it, vi } from "vitest";

import { FPLAuthError } from "../src/errors.ts";
import {
  type CliDeps,
  EXIT_FATAL,
  EXIT_PARTIAL,
  EXIT_SUCCESS,
  buildParser,
  main,
} from "../src/main.ts";

class DummyDatabase {
  initialized = false;
  closed = false;

  initializeSchema(): void {
    this.initialized = true;
  }

  close(): void {
    this.closed = true;
  }
}

type SyncResultStub = {
  errors: number;
  playersSynced: number;
  summary(): string;
};

function createSyncResult(
  errors: number,
  playersSynced: number,
  summary: string,
): SyncResultStub {
  return {
    errors,
    playersSynced,
    summary: () => summary,
  };
}

function createDeps(): {
  deps: CliDeps;
  db: DummyDatabase;
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  output: string[];
  errors: string[];
  syncer: {
    fullSync: ReturnType<typeof vi.fn>;
    gameweekSync: ReturnType<typeof vi.fn>;
  };
  api: {
    discover: ReturnType<typeof vi.fn>;
  };
  scraper: {
    requestCount: number;
  };
} {
  const db = new DummyDatabase();
  const output: string[] = [];
  const errors: string[] = [];
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const scraper = { requestCount: 12 };
  const api = {
    discover: vi.fn(async () => ({
      "bootstrap-static": { keys: ["elements"], type: "dict" },
    })),
  };
  const syncer = {
    fullSync: vi.fn(async () =>
      createSyncResult(0, 3, "mode=full_sync players=3 requests=12 errors=0"),
    ),
    gameweekSync: vi.fn(async () =>
      createSyncResult(
        0,
        1,
        "mode=gameweek_sync gw=7 players=1 requests=2 errors=0",
      ),
    ),
  };

  const deps: CliDeps = {
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
    setupLogging: () => logger,
    createDatabase: () => db,
    createAuth: () => ({
      getCookies: async () => ({ sessionid: "session-cookie" }),
      invalidate: async () => undefined,
    }),
    createScraper: () => scraper as never,
    createApi: () => api,
    createSyncer: () => syncer,
    printLine: (text) => {
      output.push(text);
    },
    printError: (text) => {
      errors.push(text);
    },
  };

  return { deps, db, logger, output, errors, syncer, api, scraper };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("src/main.ts buildParser", () => {
  it("requires exactly one mode and parses overrides", () => {
    const parser = buildParser();

    expect(() => parser.parseArgs([])).toThrowError(
      /Exactly one mode is required/u,
    );
    expect(() =>
      parser.parseArgs(["--full-sync", "--current-gameweek"]),
    ).toThrowError(/Exactly one mode is required/u);

    expect(
      parser.parseArgs([
        "--gameweek",
        "25",
        "--dry-run",
        "--db-path",
        "/tmp/custom.db",
        "--log-level",
        "DEBUG",
      ]),
    ).toEqual({
      fullSync: false,
      currentGameweek: false,
      gameweek: 25,
      discoverApi: false,
      dbPath: "/tmp/custom.db",
      logLevel: "DEBUG",
      dryRun: true,
      help: false,
      version: false,
    });
  });
});

describe("src/main.ts main", () => {
  it("runs full sync successfully, initializes the database, and closes it", async () => {
    const { db, deps, syncer } = createDeps();

    await expect(main(["--full-sync"], deps)).resolves.toBe(EXIT_SUCCESS);

    expect(syncer.fullSync).toHaveBeenCalledOnce();
    expect(syncer.gameweekSync).not.toHaveBeenCalled();
    expect(db.initialized).toBe(true);
    expect(db.closed).toBe(true);
  });

  it("dispatches current and explicit gameweek sync modes with stable exit codes", async () => {
    const current = createDeps();
    current.syncer.gameweekSync.mockResolvedValueOnce(
      createSyncResult(
        2,
        5,
        "mode=gameweek_sync gw=25 players=5 requests=9 errors=2",
      ),
    );

    await expect(main(["--current-gameweek"], current.deps)).resolves.toBe(
      EXIT_PARTIAL,
    );
    expect(current.syncer.gameweekSync).toHaveBeenCalledWith();
    expect(current.db.closed).toBe(true);

    const explicit = createDeps();
    await expect(main(["--gameweek", "7"], explicit.deps)).resolves.toBe(
      EXIT_SUCCESS,
    );
    expect(explicit.syncer.gameweekSync).toHaveBeenCalledWith(7);
  });

  it("treats sync errors with no scraped players as fatal", async () => {
    const { deps } = createDeps();
    deps.createSyncer = () => ({
      fullSync: vi.fn(async () =>
        createSyncResult(1, 0, "mode=full_sync players=0 requests=4 errors=1"),
      ),
      gameweekSync: vi.fn(),
    });

    await expect(main(["--full-sync"], deps)).resolves.toBe(EXIT_FATAL);
  });

  it("returns fatal on auth failures and still closes the database", async () => {
    const { db, deps } = createDeps();
    deps.createSyncer = () => ({
      fullSync: vi.fn(async () => {
        throw new FPLAuthError("bad credentials");
      }),
      gameweekSync: vi.fn(),
    });

    await expect(main(["--full-sync"], deps)).resolves.toBe(EXIT_FATAL);
    expect(db.closed).toBe(true);
  });

  it("prints discovery JSON, skips sync dispatch, and closes the database", async () => {
    const { api, db, deps, output, syncer } = createDeps();
    api.discover.mockResolvedValueOnce({ "bootstrap-static": ["elements"] });

    await expect(main(["--discover-api"], deps)).resolves.toBe(EXIT_SUCCESS);

    expect(JSON.parse(output[0] ?? "null")).toEqual({
      "bootstrap-static": ["elements"],
    });
    expect(syncer.fullSync).not.toHaveBeenCalled();
    expect(syncer.gameweekSync).not.toHaveBeenCalled();
    expect(db.closed).toBe(true);
  });
});

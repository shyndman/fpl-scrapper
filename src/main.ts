import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import type { Settings } from "../config/settings.ts";
import { settings } from "../config/settings.ts";
import { FPLAPI } from "./api.ts";
import { FPLAuth } from "./auth.ts";
import { FPLDatabase } from "./database.ts";
import { FPLAuthError } from "./errors.ts";
import { setupLogging } from "./logger.ts";
import {
  FPLScraper,
  type FPLScraperOptions,
  type ScraperAuth,
} from "./scraper.ts";
import { FPLSyncer } from "./sync.ts";

export const EXIT_SUCCESS = 0;
export const EXIT_PARTIAL = 1;
export const EXIT_FATAL = 2;

const VERSION = "fpl-scraper 0.1.0";
const LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"] as const;
const HELP_TEXT = `Fantasy Premier League player statistics scraper

Usage:
  node src/main.ts --full-sync
  node src/main.ts --current-gameweek
  node src/main.ts --gameweek N
  node src/main.ts --discover-api
  node src/main.ts --full-sync --dry-run --log-level DEBUG

Modes (exactly one required):
  --full-sync         Full scrape: all players, all history, teams, fixtures (~700 requests)
  --current-gameweek  Incremental update for the current gameweek (auto-detected from DB)
  --gameweek N        Incremental update for gameweek N
  --discover-api      Probe all public FPL API endpoints and print their structure (no DB writes)

Options:
  --db-path PATH      Override database path
  --log-level LEVEL   One of DEBUG, INFO, WARNING, ERROR
  --dry-run           Fetch data but do NOT write to the database
  --version           Print the CLI version and exit
  --help              Print this help and exit

Exit codes:
  0  All data synced successfully
  1  Partial success (some players failed, DB partially updated — re-run is safe)
  2  Fatal error (auth failure, DB unreachable, network down)
`;

type LogLevel = (typeof LOG_LEVELS)[number];

export interface CliArgs {
  readonly fullSync: boolean;
  readonly currentGameweek: boolean;
  readonly gameweek: number | null;
  readonly discoverApi: boolean;
  readonly dbPath: string | null;
  readonly logLevel: LogLevel;
  readonly dryRun: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

export interface Parser {
  parseArgs(argv?: readonly string[]): CliArgs;
  helpText(): string;
}

interface LoggerLike {
  info(message: string, ...meta: unknown[]): unknown;
  warn(message: string, ...meta: unknown[]): unknown;
  error(message: string, ...meta: unknown[]): unknown;
}

interface DatabaseLike {
  initializeSchema(): void;
  close(): void;
}

interface DiscoveryApi {
  discover(): Promise<unknown>;
}

interface SyncResultLike {
  errors: number;
  playersSynced: number;
  summary(): string;
}

interface SyncerLike {
  fullSync(): Promise<SyncResultLike>;
  gameweekSync(gameweekId?: number): Promise<SyncResultLike>;
}

export interface CliDeps {
  readonly settings: Settings;
  setupLogging(logLevel?: string, logFile?: string): LoggerLike;
  createDatabase(dbPath: string): DatabaseLike;
  createAuth(sessionFile: string, login: string, password: string): ScraperAuth;
  createScraper(
    auth: ScraperAuth,
    baseUrl: string,
    options: FPLScraperOptions,
  ): FPLScraper;
  createApi(scraper: FPLScraper): DiscoveryApi;
  createSyncer(
    api: DiscoveryApi,
    db: DatabaseLike,
    dryRun: boolean,
    getRequestCount: () => number,
  ): SyncerLike;
  printLine(text: string): void;
  printError(text: string): void;
}

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

function parseGameweek(rawGameweek: string): number {
  if (!/^\d+$/u.test(rawGameweek)) {
    throw new CliUsageError(
      `--gameweek expects a positive integer, received ${JSON.stringify(rawGameweek)}`,
    );
  }

  const gameweek = Number.parseInt(rawGameweek, 10);
  if (gameweek <= 0) {
    throw new CliUsageError(
      `--gameweek expects a positive integer, received ${JSON.stringify(rawGameweek)}`,
    );
  }

  return gameweek;
}

function createDefaultDeps(): CliDeps {
  return {
    settings,
    setupLogging,
    createDatabase: (dbPath) => new FPLDatabase(dbPath),
    createAuth: (sessionFile, login, password) =>
      new FPLAuth(sessionFile, login, password),
    createScraper: (auth, baseUrl, options) =>
      new FPLScraper(auth, baseUrl, options),
    createApi: (scraper) => new FPLAPI(scraper),
    createSyncer: (api, db, dryRun, getRequestCount) =>
      new FPLSyncer(api as FPLAPI, db as FPLDatabase, dryRun, getRequestCount),
    printLine: (text) => {
      console.log(text);
    },
    printError: (text) => {
      console.error(text);
    },
  };
}

export function buildParser(): Parser {
  return {
    parseArgs(argv: readonly string[] = process.argv.slice(2)): CliArgs {
      const { values } = parseArgs({
        args: [...argv],
        allowPositionals: false,
        options: {
          "full-sync": { type: "boolean" },
          "current-gameweek": { type: "boolean" },
          gameweek: { type: "string" },
          "discover-api": { type: "boolean" },
          "db-path": { type: "string" },
          "log-level": { type: "string" },
          "dry-run": { type: "boolean" },
          version: { type: "boolean" },
          help: { type: "boolean", short: "h" },
        },
        strict: true,
      });

      const help = values.help === true;
      const version = values.version === true;
      const fullSync = values["full-sync"] === true;
      const currentGameweek = values["current-gameweek"] === true;
      const discoverApi = values["discover-api"] === true;
      const gameweek =
        typeof values.gameweek === "string"
          ? parseGameweek(values.gameweek)
          : null;
      const dbPath =
        typeof values["db-path"] === "string" ? values["db-path"] : null;
      const dryRun = values["dry-run"] === true;
      const rawLogLevel =
        typeof values["log-level"] === "string"
          ? values["log-level"]
          : settings.LOG_LEVEL;

      if (!isLogLevel(rawLogLevel)) {
        throw new CliUsageError(
          `--log-level must be one of ${LOG_LEVELS.join(", ")}, received ${JSON.stringify(rawLogLevel)}`,
        );
      }

      if (!help && !version) {
        const enabledModes = [
          fullSync,
          currentGameweek,
          gameweek !== null,
          discoverApi,
        ].filter(Boolean).length;
        if (enabledModes !== 1) {
          throw new CliUsageError(
            "Exactly one mode is required: --full-sync, --current-gameweek, --gameweek N, or --discover-api.",
          );
        }
      }

      return {
        fullSync,
        currentGameweek,
        gameweek,
        discoverApi,
        dbPath,
        logLevel: rawLogLevel,
        dryRun,
        help,
        version,
      };
    },
    helpText(): string {
      return HELP_TEXT;
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValueError(error: unknown): boolean {
  return error instanceof Error && error.name === "ValueError";
}

/**
 * Own the CLI boundary: parse the user's requested mode, wire the runtime modules,
 * and convert sync outcomes into stable process exit codes.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: CliDeps = createDefaultDeps(),
): Promise<number> {
  const parser = buildParser();

  let args: CliArgs;
  try {
    args = parser.parseArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      deps.printError(`${error.message}\n\n${parser.helpText()}`);
      return EXIT_FATAL;
    }
    throw error;
  }

  if (args.help) {
    deps.printLine(parser.helpText());
    return EXIT_SUCCESS;
  }

  if (args.version) {
    deps.printLine(VERSION);
    return EXIT_SUCCESS;
  }

  const logger = deps.setupLogging(args.logLevel, deps.settings.LOG_FILE);
  if (args.dryRun) {
    logger.info("DRY RUN mode — no database writes will occur");
  }

  const dbPath = args.dbPath ?? deps.settings.DB_PATH;
  let db: DatabaseLike | null = null;
  let result: SyncResultLike | null = null;

  try {
    db = deps.createDatabase(dbPath);
    db.initializeSchema();

    const auth = deps.createAuth(
      deps.settings.SESSION_FILE,
      deps.settings.FPL_LOGIN,
      deps.settings.FPL_PASSWORD,
    );
    const scraper = deps.createScraper(auth, deps.settings.FPL_BASE_URL, {
      minDelay: deps.settings.REQUEST_DELAY_MIN,
      maxDelay: deps.settings.REQUEST_DELAY_MAX,
      backoffFactor: deps.settings.BACKOFF_FACTOR,
      maxRetries: deps.settings.MAX_RETRIES,
      maxBackoff: deps.settings.MAX_BACKOFF,
      timeoutMs: deps.settings.REQUEST_TIMEOUT * 1000,
    });
    const api = deps.createApi(scraper);
    const syncer = deps.createSyncer(
      api,
      db,
      args.dryRun,
      () => scraper.requestCount,
    );

    if (args.fullSync) {
      result = await syncer.fullSync();
    } else if (args.currentGameweek) {
      result = await syncer.gameweekSync();
    } else if (args.gameweek !== null) {
      result = await syncer.gameweekSync(args.gameweek);
    } else if (args.discoverApi) {
      logger.info("Probing FPL API endpoints…");
      deps.printLine(JSON.stringify(await api.discover(), null, 2));
      return EXIT_SUCCESS;
    }
  } catch (error) {
    if (error instanceof FPLAuthError) {
      logger.error("Authentication failed: %s", error.message);
      return EXIT_FATAL;
    }

    if (isValueError(error)) {
      logger.error("Configuration error: %s", describeError(error));
      return EXIT_FATAL;
    }

    if (db === null) {
      logger.error(
        "Failed to open database at %s: %s",
        dbPath,
        describeError(error),
      );
      return EXIT_FATAL;
    }

    logger.error("Unexpected fatal error: %s", describeError(error));
    return EXIT_FATAL;
  } finally {
    db?.close();
  }

  if (result === null) {
    logger.error("No CLI mode was dispatched.");
    return EXIT_FATAL;
  }

  if (result.errors > 0 && result.playersSynced === 0) {
    logger.error("Sync failed with no players scraped");
    return EXIT_FATAL;
  }

  if (result.errors > 0) {
    logger.warn(
      "Sync completed with %d errors (%d players synced). Re-running is safe.",
      result.errors,
      result.playersSynced,
    );
    return EXIT_PARTIAL;
  }

  logger.info("Sync completed successfully: %s", result.summary());
  return EXIT_SUCCESS;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const exitCode = await main();
  process.exit(exitCode);
}

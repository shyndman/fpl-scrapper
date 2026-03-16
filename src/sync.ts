import { randomUUID } from "node:crypto";

import type { FPLAPI } from "./api.ts";
import { FPLDatabase } from "./database.ts";
import { FPLAPIError, FPLNotFoundError } from "./errors.ts";
import { getLogger } from "./logger.ts";
import {
  transform_bootstrap,
  transform_element_summary,
  transform_event_live,
  transform_fixtures,
} from "./transform.ts";

const logger = getLogger("src.sync");

type SyncMode = "full_sync" | "gameweek_sync";

type SyncApi = Pick<
  FPLAPI,
  "getBootstrapStatic" | "getElementSummary" | "getEventLive" | "getFixtures"
>;

type RequestCountSource = () => number;

type GameweekLike = {
  fpl_id: number;
  is_current: number;
  is_finished: number;
};

export interface SyncResultInit {
  mode: SyncMode;
  playersSynced?: number;
  requestsMade?: number;
  errors?: number;
  gameweekId?: number;
  warnings?: string[];
}

/**
 * Summarises one sync run so callers can inspect outcomes without reading the
 * scrape log directly.
 */
export class SyncResult {
  readonly mode: SyncMode;
  playersSynced: number;
  requestsMade: number;
  errors: number;
  gameweekId?: number;
  warnings: string[];

  constructor(init: SyncResultInit) {
    this.mode = init.mode;
    this.playersSynced = init.playersSynced ?? 0;
    this.requestsMade = init.requestsMade ?? 0;
    this.errors = init.errors ?? 0;
    this.gameweekId = init.gameweekId;
    this.warnings = [...(init.warnings ?? [])];
  }

  summary(): string {
    const parts = [
      `mode=${this.mode}`,
      `players=${this.playersSynced}`,
      `requests=${this.requestsMade}`,
      `errors=${this.errors}`,
    ];
    if (this.gameweekId !== undefined) {
      parts.splice(1, 0, `gw=${this.gameweekId}`);
    }
    return parts.join(" ");
  }
}

/**
 * Coordinates the sync pipeline end-to-end: fetch raw FPL payloads, transform
 * them into stable rows, persist them when not dry-running, and record scrape-log state.
 */
export class FPLSyncer {
  readonly #api: SyncApi;
  readonly #db: FPLDatabase;
  readonly #dryRun: boolean;
  readonly #getRequestCount: RequestCountSource;

  constructor(
    api: SyncApi,
    db: FPLDatabase,
    dryRun = false,
    getRequestCount?: RequestCountSource,
  ) {
    this.#api = api;
    this.#db = db;
    this.#dryRun = dryRun;
    this.#getRequestCount =
      getRequestCount ?? this.#defaultRequestCountSource(api);
  }

  /**
   * Rebuild the local cache from bootstrap, fixtures, live stats, and every
   * player summary while keeping partial failures observable instead of fatal.
   */
  async fullSync(): Promise<SyncResult> {
    const result = new SyncResult({ mode: "full_sync" });
    const runId = this.#startRun(result.mode, null);

    logger.info("Starting full sync (run_id=%s)", runId);

    try {
      logger.info("[1/5] Fetching bootstrap-static…");
      const bootstrap = await this.#api.getBootstrapStatic();
      const [teams, gameweeks, players] = transform_bootstrap(bootstrap);

      if (!this.#dryRun) {
        this.#db.upsertTeams(teams);
        this.#db.upsertGameweeks(gameweeks);
        this.#db.upsertPlayers(players);
      }

      logger.info(
        "Bootstrap: %d teams, %d gameweeks, %d players",
        teams.length,
        gameweeks.length,
        players.length,
      );

      logger.info("[2/5] Fetching all fixtures…");
      const rawFixtures = await this.#api.getFixtures();
      const fixtures = transform_fixtures(rawFixtures);
      if (!this.#dryRun) {
        this.#db.upsertFixtures(fixtures);
      }
      logger.info("Fixtures: %d records", fixtures.length);

      const currentGameweek = _findCurrentGw(gameweeks);
      if (currentGameweek !== undefined) {
        logger.info("[3/5] Fetching live stats for GW%d…", currentGameweek);
        const rawLive = await this.#api.getEventLive(currentGameweek);
        const liveRows = transform_event_live(currentGameweek, rawLive);
        if (!this.#dryRun) {
          this.#db.upsertLiveGameweekStats(liveRows);
        }
        logger.info(
          "Live stats: %d rows for GW%d",
          liveRows.length,
          currentGameweek,
        );
      } else {
        logger.warn("[3/5] No current gameweek found — skipping live stats");
      }

      const playerIds = players.map((player) => player.fpl_id);
      logger.info(
        "[4/5] Fetching element-summary for %d players…",
        playerIds.length,
      );

      for (const [index, playerId] of playerIds.entries()) {
        try {
          const rawSummary = await this.#api.getElementSummary(playerId);
          const [history, historyPast] = transform_element_summary(
            playerId,
            rawSummary,
          );
          if (!this.#dryRun) {
            this.#db.upsertPlayerHistory(history);
            this.#db.upsertPlayerHistoryPast(historyPast);
          }
          result.playersSynced += 1;
        } catch (error) {
          this.#recordPlayerSummaryFailure(result, playerId, error, true);
        }

        const progress = index + 1;
        if (progress % 50 === 0 || progress === playerIds.length) {
          logger.info(
            "  Progress: %d/%d players scraped",
            progress,
            playerIds.length,
          );
        }
      }

      logger.info("[5/5] Sync complete.");
    } catch (error) {
      this.#finishFatalRun(
        runId,
        result,
        error,
        "Fatal error during full sync",
      );
      throw error;
    }

    this.#finishCompletedRun(runId, result);
    logger.info("Full sync finished: %s", result.summary());
    return result;
  }

  /**
   * Refresh one gameweek incrementally: update bootstrap data, persist that
   * gameweek's fixtures/live stats, then rescrape summaries only for active players.
   */
  async gameweekSync(gameweekId?: number): Promise<SyncResult> {
    const resolvedGameweekId = gameweekId ?? this.#resolveCurrentGameweekId();
    const result = new SyncResult({
      mode: "gameweek_sync",
      gameweekId: resolvedGameweekId,
    });
    const runId = this.#startRun(result.mode, resolvedGameweekId);

    logger.info(
      "Starting gameweek sync for GW%d (run_id=%s)",
      resolvedGameweekId,
      runId,
    );

    try {
      logger.info("[1/4] Fetching bootstrap-static…");
      const bootstrap = await this.#api.getBootstrapStatic();
      const [teams, gameweeks, players] = transform_bootstrap(bootstrap);
      if (!this.#dryRun) {
        this.#db.upsertTeams(teams);
        this.#db.upsertGameweeks(gameweeks);
        this.#db.upsertPlayers(players);
      }
      logger.info("Bootstrap: %d players updated", players.length);

      logger.info("[2/4] Fetching fixtures for GW%d…", resolvedGameweekId);
      const rawFixtures = await this.#api.getFixtures(resolvedGameweekId);
      const fixtures = transform_fixtures(rawFixtures);
      if (!this.#dryRun) {
        this.#db.upsertFixtures(fixtures);
      }
      logger.info("Fixtures: %d for GW%d", fixtures.length, resolvedGameweekId);

      logger.info("[3/4] Fetching live stats for GW%d…", resolvedGameweekId);
      const rawLive = await this.#api.getEventLive(resolvedGameweekId);
      const liveRows = transform_event_live(resolvedGameweekId, rawLive);
      if (!this.#dryRun) {
        this.#db.upsertLiveGameweekStats(liveRows);
      }
      logger.info("Live stats: %d rows", liveRows.length);

      const activeIds = this.#dryRun
        ? liveRows
            .filter((row) => row.minutes > 0)
            .map((row) => row.player_fpl_id)
        : this.#db.getActivePlayerIdsInGw(resolvedGameweekId);
      logger.info(
        "[4/4] Fetching element-summary for %d active players in GW%d…",
        activeIds.length,
        resolvedGameweekId,
      );

      for (const [index, playerId] of activeIds.entries()) {
        try {
          const rawSummary = await this.#api.getElementSummary(playerId);
          const [history] = transform_element_summary(playerId, rawSummary);
          const gameweekHistory = history.filter(
            (row) => row.gameweek_fpl_id === resolvedGameweekId,
          );
          if (!this.#dryRun) {
            this.#db.upsertPlayerHistory(gameweekHistory);
          }
          result.playersSynced += 1;
        } catch (error) {
          this.#recordPlayerSummaryFailure(result, playerId, error, false);
        }

        const progress = index + 1;
        if (progress % 25 === 0 || progress === activeIds.length) {
          logger.info(
            "  Progress: %d/%d active players scraped",
            progress,
            activeIds.length,
          );
        }
      }
    } catch (error) {
      this.#finishFatalRun(
        runId,
        result,
        error,
        "Fatal error during gameweek sync",
      );
      throw error;
    }

    this.#finishCompletedRun(runId, result);
    logger.info("Gameweek sync finished: %s", result.summary());
    return result;
  }

  #resolveCurrentGameweekId(): number {
    const gameweek = this.#db.getCurrentGameweek();
    if (gameweek === null) {
      throw new ValueError(
        "No current gameweek in the database. Run --full-sync first, or specify --gameweek N.",
      );
    }

    logger.info("Auto-detected current gameweek: GW%d", gameweek.fpl_id);
    return gameweek.fpl_id;
  }

  #startRun(mode: SyncMode, gameweekId: number | null): string {
    const runId = randomUUID();
    if (!this.#dryRun) {
      this.#db.startScrapeLog(runId, mode, gameweekId, _utcnow());
    }
    return runId;
  }

  #finishCompletedRun(runId: string, result: SyncResult): void {
    result.requestsMade = this.#getRequestCount();
    if (!this.#dryRun) {
      this.#db.finishScrapeLog(
        runId,
        result.errors === 0 ? "success" : "partial",
        result.playersSynced,
        result.requestsMade,
        result.errors,
        _utcnow(),
      );
    }
  }

  #finishFatalRun(
    runId: string,
    result: SyncResult,
    error: unknown,
    message: string,
  ): void {
    logger.error("%s: %s", message, error);
    result.errors += 1;
    result.requestsMade = this.#getRequestCount();
    if (!this.#dryRun) {
      this.#db.finishScrapeLog(
        runId,
        "error",
        result.playersSynced,
        result.requestsMade,
        result.errors,
        _utcnow(),
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  #recordPlayerSummaryFailure(
    result: SyncResult,
    playerId: number,
    error: unknown,
    includeWarnings: boolean,
  ): void {
    if (error instanceof FPLNotFoundError) {
      logger.warn("Player %d not found — skipping", playerId);
      result.errors += 1;
      if (includeWarnings) {
        result.warnings.push(`Player ${playerId}: 404 Not Found`);
      }
      return;
    }

    if (error instanceof FPLAPIError) {
      logger.error("API error for player %d: %s", playerId, error);
      result.errors += 1;
      if (includeWarnings) {
        result.warnings.push(`Player ${playerId}: ${error.message}`);
      }
      return;
    }

    throw error;
  }

  #defaultRequestCountSource(api: SyncApi): RequestCountSource {
    const withRequestCount = api as SyncApi & { requestCount?: number };
    if (typeof withRequestCount.requestCount === "number") {
      return () => withRequestCount.requestCount ?? 0;
    }

    return () => 0;
  }
}

export function _utcnow(): string {
  return new Date().toISOString();
}

export function _findCurrentGw(
  gameweeks: readonly GameweekLike[],
): number | undefined {
  for (const gameweek of gameweeks) {
    if (gameweek.is_current) {
      return gameweek.fpl_id;
    }
  }

  let latestFinished: number | undefined;
  for (const gameweek of gameweeks) {
    if (
      gameweek.is_finished &&
      (latestFinished === undefined || gameweek.fpl_id > latestFinished)
    ) {
      latestFinished = gameweek.fpl_id;
    }
  }

  return latestFinished;
}

class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

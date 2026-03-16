import { getLogger } from "./logger.ts";
import {
  Fixture,
  Gameweek,
  LiveGameweekStats,
  Player,
  PlayerHistory,
  PlayerHistoryPast,
  Team,
} from "./models.ts";

const logger = getLogger("src.transform");

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Build the bootstrap model rows consumed by sync and persistence without duplicating normalization. */
export function transform_bootstrap(
  data: unknown,
): [Team[], Gameweek[], Player[]] {
  const payload = isRecord(data) ? data : {};

  const teams: Team[] = [];
  const rawTeams = Array.isArray(payload.teams) ? payload.teams : [];
  for (const raw of rawTeams) {
    if (!isRecord(raw)) {
      logger.warn(
        "Skipping malformed team %s: expected object payload",
        undefined,
      );
      continue;
    }

    try {
      teams.push(Team.fromDict(raw));
    } catch (error) {
      logger.warn("Skipping malformed team %s: %s", raw.id, error);
    }
  }

  const gameweeks: Gameweek[] = [];
  const rawGameweeks = Array.isArray(payload.events) ? payload.events : [];
  for (const raw of rawGameweeks) {
    if (!isRecord(raw)) {
      logger.warn(
        "Skipping malformed gameweek %s: expected object payload",
        undefined,
      );
      continue;
    }

    try {
      gameweeks.push(Gameweek.fromDict(raw));
    } catch (error) {
      logger.warn("Skipping malformed gameweek %s: %s", raw.id, error);
    }
  }

  const players: Player[] = [];
  const rawPlayers = Array.isArray(payload.elements) ? payload.elements : [];
  for (const raw of rawPlayers) {
    if (!isRecord(raw)) {
      logger.warn(
        "Skipping malformed player %s: expected object payload",
        undefined,
      );
      continue;
    }

    try {
      players.push(Player.fromDict(raw));
    } catch (error) {
      logger.warn("Skipping malformed player %s: %s", raw.id, error);
    }
  }

  logger.debug(
    "Transformed bootstrap: %d teams, %d gameweeks, %d players",
    teams.length,
    gameweeks.length,
    players.length,
  );
  return [teams, gameweeks, players];
}

/** Build the per-player history rows for sync/database consumers while skipping bad summary entries. */
export function transform_element_summary(
  player_fpl_id: number,
  data: unknown,
): [PlayerHistory[], PlayerHistoryPast[]] {
  const payload = isRecord(data) ? data : {};

  const history: PlayerHistory[] = [];
  const rawHistory = Array.isArray(payload.history) ? payload.history : [];
  for (const raw of rawHistory) {
    if (!isRecord(raw)) {
      logger.warn(
        "Skipping malformed history row for player %d (GW %s): %s",
        player_fpl_id,
        undefined,
        "expected object payload",
      );
      continue;
    }

    try {
      history.push(PlayerHistory.fromDict(player_fpl_id, raw));
    } catch (error) {
      logger.warn(
        "Skipping malformed history row for player %d (GW %s): %s",
        player_fpl_id,
        raw.round,
        error,
      );
    }
  }

  const history_past: PlayerHistoryPast[] = [];
  const rawHistoryPast = Array.isArray(payload.history_past)
    ? payload.history_past
    : [];
  for (const raw of rawHistoryPast) {
    if (!isRecord(raw)) {
      logger.warn(
        "Skipping malformed history_past row for player %d (%s): %s",
        player_fpl_id,
        undefined,
        "expected object payload",
      );
      continue;
    }

    try {
      history_past.push(PlayerHistoryPast.fromDict(player_fpl_id, raw));
    } catch (error) {
      logger.warn(
        "Skipping malformed history_past row for player %d (%s): %s",
        player_fpl_id,
        raw.season_name,
        error,
      );
    }
  }

  return [history, history_past];
}

/** Build stable fixture rows from raw fixture collections so downstream ports can persist them directly. */
export function transform_fixtures(data: unknown): Fixture[] {
  const rawFixtures = Array.isArray(data) ? data : [];
  const fixtures: Fixture[] = [];

  for (const raw of rawFixtures) {
    if (!isRecord(raw)) {
      logger.warn(
        "Skipping malformed fixture %s: %s",
        undefined,
        "expected object payload",
      );
      continue;
    }

    try {
      fixtures.push(Fixture.fromDict(raw));
    } catch (error) {
      logger.warn("Skipping malformed fixture %s: %s", raw.id, error);
    }
  }

  logger.debug("Transformed %d fixtures", fixtures.length);
  return fixtures;
}

/** Build live-stat rows for one gameweek so later sync/database ports can upsert them unchanged. */
export function transform_event_live(
  gameweek_fpl_id: number,
  data: unknown,
): LiveGameweekStats[] {
  const payload = isRecord(data) ? data : {};
  const rawElements = Array.isArray(payload.elements) ? payload.elements : [];
  const rows: LiveGameweekStats[] = [];

  for (const element of rawElements) {
    if (!isRecord(element)) {
      logger.warn(
        "Skipping malformed live stats for element %s: %s",
        undefined,
        "expected object payload",
      );
      continue;
    }

    try {
      const player_fpl_id = Number.parseInt(String(element.id), 10);
      if (!Number.isSafeInteger(player_fpl_id)) {
        throw new TypeError("Expected integer for element.id");
      }

      rows.push(
        LiveGameweekStats.fromDict(player_fpl_id, gameweek_fpl_id, element),
      );
    } catch (error) {
      logger.warn(
        "Skipping malformed live stats for element %s: %s",
        element.id,
        error,
      );
    }
  }

  logger.debug(
    "Transformed %d live stats rows for GW%d",
    rows.length,
    gameweek_fpl_id,
  );
  return rows;
}

import { threadId } from "node:worker_threads";

import BetterSqlite3 from "better-sqlite3";

const EXPECTED_FLOAT_FIELDS = new Set([
  "expected_goals",
  "expected_assists",
  "expected_goal_involvements",
]);

const VALID_PLAYER_SORTS = new Set([
  "total_points",
  "now_cost",
  "goals_scored",
  "assists",
  "minutes",
  "transfers_in",
  "bonus",
  "clean_sheets",
  "goals_conceded",
  "bps",
  "tackles",
  "clearances_blocks_interceptions",
  "recoveries",
  "defensive_contribution",
  "xgp",
  "xap",
  "xgip",
  "expected_goals",
  "expected_assists",
  "expected_goal_involvements",
  "form",
  "selected_by_percent",
  "points_per_game",
  "influence",
  "creativity",
  "threat",
  "ict_index",
  "expected_goals_conceded",
  "web_name",
]);

const TEXT_NUMERIC_PLAYER_SORTS = new Set([
  "form",
  "selected_by_percent",
  "points_per_game",
  "influence",
  "creativity",
  "threat",
  "ict_index",
  "expected_goals_conceded",
  "expected_goals",
  "expected_assists",
  "expected_goal_involvements",
]);

const GAMEWEEK_AGGREGATE_SORTS = new Set([
  "total_points",
  "goals_scored",
  "assists",
  "clean_sheets",
  "goals_conceded",
  "minutes",
  "bonus",
  "bps",
  "transfers_in",
  "expected_goals",
  "expected_assists",
  "expected_goal_involvements",
  "expected_goals_conceded",
  "xgp",
  "xap",
  "xgip",
  "tackles",
  "clearances_blocks_interceptions",
  "recoveries",
  "defensive_contribution",
]);

const CACHE = new Map<string, { value: unknown; expiresAt: number }>();
const CONNECTIONS = new Map<number, BetterSqliteDatabase>();

let configuredDbPath = "";

type SqliteScalar = string | number | bigint | null | Uint8Array;
type DatabaseRow = Record<string, SqliteScalar>;
type BetterSqliteDatabase = InstanceType<typeof BetterSqlite3>;

type CacheableFunction<TArgs extends readonly unknown[], TResult> = (
  ...args: TArgs
) => TResult;

export interface GetPlayersOptions {
  pos?: number;
  team?: number;
  status?: string;
  minCost?: number;
  maxCost?: number;
  gwStart?: number;
  gwEnd?: number;
  sort?: string;
  order?: string;
  page?: number;
  perPage?: number;
}

function closeConnections(): void {
  for (const connection of CONNECTIONS.values()) {
    connection.close();
  }
  CONNECTIONS.clear();
}

function rowsFor<T extends DatabaseRow>(
  sql: string,
  params: readonly unknown[] = [],
): T[] {
  return getDb()
    .prepare(sql)
    .all(...params) as T[];
}

function rowFor<T extends DatabaseRow>(
  sql: string,
  params: readonly unknown[] = [],
): T | null {
  const row = getDb()
    .prepare(sql)
    .get(...params) as T | undefined;
  return row ?? null;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function cacheKey(name: string, args: readonly unknown[]): string {
  return `${name}:${JSON.stringify(args)}`;
}

function ttlCache<TArgs extends readonly unknown[], TResult>(
  name: string,
  seconds: number,
  fn: CacheableFunction<TArgs, TResult>,
): CacheableFunction<TArgs, TResult> {
  return (...args: TArgs): TResult => {
    const key = cacheKey(name, args);
    const now = Date.now();
    const cached = CACHE.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value as TResult;
    }

    const value = fn(...args);
    CACHE.set(key, { value, expiresAt: now + seconds * 1000 });
    return value;
  };
}

function playerSortColumn(sort: string, useGameweekRange: boolean): string {
  if (useGameweekRange && GAMEWEEK_AGGREGATE_SORTS.has(sort)) {
    return sort;
  }
  if (TEXT_NUMERIC_PLAYER_SORTS.has(sort)) {
    return `CAST(p.${sort} AS REAL)`;
  }
  return `p.${sort}`;
}

function normalizedPlayerStatus(status: string | undefined): string | null {
  if (!status) {
    return null;
  }

  if (status === "available") {
    return "a";
  }
  if (status === "injured") {
    return "i";
  }
  if (status === "doubt") {
    return "d";
  }
  return null;
}

function coerceExpectedFloatFields(row: DatabaseRow): DatabaseRow {
  const copy: DatabaseRow = { ...row };
  for (const field of EXPECTED_FLOAT_FIELDS) {
    const value = copy[field];
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (!Number.isNaN(parsed)) {
        copy[field] = parsed;
      }
    }
  }
  return copy;
}

function rowsToPlayerPage(
  rows: DatabaseRow[],
  total: number,
): [DatabaseRow[], number] {
  return [rowsToDicts(rows), total];
}

/** Configure the read-model layer with the SQLite file future requests should open. */
export function configure(dbPath: string): void {
  closeConnections();
  configuredDbPath = dbPath;
  invalidateCache();
}

/** Return the current thread's read-only SQLite handle after configuration. */
export function getDb(): BetterSqliteDatabase {
  const existing = CONNECTIONS.get(threadId);
  if (existing) {
    return existing;
  }
  if (!configuredDbPath) {
    throw new Error("DB path not configured - call configure(path) first");
  }

  const db = new BetterSqlite3(configuredDbPath, {
    fileMustExist: true,
    readonly: true,
  });
  db.pragma("query_only = ON");
  CONNECTIONS.set(threadId, db);
  return db;
}

/** Convert SQLite rows into plain objects while normalizing legacy expected-* text columns. */
export function rowsToDicts(rows: readonly DatabaseRow[]): DatabaseRow[] {
  return rows.map((row) => coerceExpectedFloatFields(row));
}

/** Clear all memoized query results so external writes become visible immediately. */
export function invalidateCache(): void {
  CACHE.clear();
}

/** Return every gameweek for page filter controls and overview rendering. */
export const getAllGameweeks = ttlCache(
  "getAllGameweeks",
  60,
  (): DatabaseRow[] => {
    return rowsToDicts(rowsFor("SELECT * FROM gameweeks ORDER BY fpl_id ASC"));
  },
);

/** Return the active gameweek used to anchor dashboard snapshots. */
export const getCurrentGameweek = ttlCache(
  "getCurrentGameweek",
  60,
  (): DatabaseRow | null => {
    return rowFor("SELECT * FROM gameweeks WHERE is_current = 1 LIMIT 1");
  },
);

/** Return all teams ordered for stable navigation and filters. */
export const getAllTeams = ttlCache("getAllTeams", 300, (): DatabaseRow[] => {
  return rowsToDicts(rowsFor("SELECT * FROM teams ORDER BY name ASC"));
});

/** Return one team row for team detail pages and lookups from player rows. */
export const getTeam = ttlCache(
  "getTeam",
  300,
  (fplId: number): DatabaseRow | null => {
    return rowFor("SELECT * FROM teams WHERE fpl_id = ? LIMIT 1", [fplId]);
  },
);

/** Return teams enriched with finished-match records and summed squad expected stats. */
export const getTeamsWithStats = ttlCache(
  "getTeamsWithStats",
  300,
  (): DatabaseRow[] => {
    const sql = `
    SELECT
      t.*,
      COUNT(CASE WHEN
        (f.team_h_fpl_id = t.fpl_id AND f.team_h_score > f.team_a_score) OR
        (f.team_a_fpl_id = t.fpl_id AND f.team_a_score > f.team_h_score)
        THEN 1 END) AS wins,
      COUNT(CASE WHEN
        f.finished = 1 AND f.team_h_score = f.team_a_score AND
        (f.team_h_fpl_id = t.fpl_id OR f.team_a_fpl_id = t.fpl_id)
        THEN 1 END) AS draws,
      COUNT(CASE WHEN
        (f.team_h_fpl_id = t.fpl_id AND f.team_h_score < f.team_a_score) OR
        (f.team_a_fpl_id = t.fpl_id AND f.team_a_score < f.team_h_score)
        THEN 1 END) AS losses,
      xg.team_xg,
      xg.team_xa,
      xg.team_xgi,
      xg.team_xgp,
      xg.team_xap,
      xg.team_xgip
    FROM teams t
    LEFT JOIN fixtures f ON f.finished = 1 AND
      (f.team_h_fpl_id = t.fpl_id OR f.team_a_fpl_id = t.fpl_id)
    LEFT JOIN (
      SELECT
        team_fpl_id,
        ROUND(COALESCE(SUM(expected_goals), 0), 2) AS team_xg,
        ROUND(COALESCE(SUM(expected_assists), 0), 2) AS team_xa,
        ROUND(COALESCE(SUM(expected_goal_involvements), 0), 2) AS team_xgi,
        ROUND(COALESCE(SUM(xgp), 0), 2) AS team_xgp,
        ROUND(COALESCE(SUM(xap), 0), 2) AS team_xap,
        ROUND(COALESCE(SUM(xgip), 0), 2) AS team_xgip
      FROM players
      GROUP BY team_fpl_id
    ) xg ON xg.team_fpl_id = t.fpl_id
    GROUP BY t.fpl_id
    ORDER BY t.name ASC
  `;

    return rowsToDicts(rowsFor(sql));
  },
);

/** Return filtered players plus a total count for paginated list pages. */
export function getPlayers(
  options: GetPlayersOptions = {},
): [DatabaseRow[], number] {
  const {
    pos,
    team,
    status,
    minCost,
    maxCost,
    gwStart,
    gwEnd,
    sort: requestedSort = "total_points",
    order = "desc",
    page = 1,
    perPage = 40,
  } = options;

  const sort = VALID_PLAYER_SORTS.has(requestedSort)
    ? requestedSort
    : "total_points";
  const orderDirection = order.toLowerCase() === "desc" ? "DESC" : "ASC";
  const useGameweekRange = gwStart !== undefined || gwEnd !== undefined;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (pos !== undefined) {
    conditions.push("p.element_type = ?");
    params.push(pos);
  }
  if (team !== undefined) {
    conditions.push("p.team_fpl_id = ?");
    params.push(team);
  }

  const normalizedStatus = normalizedPlayerStatus(status);
  if (normalizedStatus) {
    conditions.push("p.status = ?");
    params.push(normalizedStatus);
  }
  if (minCost !== undefined) {
    conditions.push("p.now_cost >= ?");
    params.push(minCost);
  }
  if (maxCost !== undefined) {
    conditions.push("p.now_cost <= ?");
    params.push(maxCost);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * perPage;

  if (useGameweekRange) {
    const effectiveGwStart = gwStart ?? 1;
    const maxGameweekRow = rowFor<{ max_gameweek: number | null }>(
      "SELECT MAX(fpl_id) AS max_gameweek FROM gameweeks",
    );
    const effectiveGwEnd = gwEnd ?? maxGameweekRow?.max_gameweek ?? 38;
    const cteParams = [effectiveGwStart, effectiveGwEnd];
    const sortExpression = playerSortColumn(sort, true);
    const cte = `
      WITH gw_stats AS (
        SELECT
          player_fpl_id,
          COALESCE(SUM(total_points), 0) AS total_points,
          COALESCE(SUM(goals_scored), 0) AS goals_scored,
          COALESCE(SUM(assists), 0) AS assists,
          COALESCE(SUM(clean_sheets), 0) AS clean_sheets,
          COALESCE(SUM(goals_conceded), 0) AS goals_conceded,
          COALESCE(SUM(minutes), 0) AS minutes,
          COALESCE(SUM(bonus), 0) AS bonus,
          COALESCE(SUM(bps), 0) AS bps,
          COALESCE(SUM(transfers_in), 0) AS transfers_in,
          ROUND(COALESCE(SUM(expected_goals), 0), 2) AS expected_goals,
          ROUND(COALESCE(SUM(expected_assists), 0), 2) AS expected_assists,
          ROUND(COALESCE(SUM(expected_goal_involvements), 0), 2) AS expected_goal_involvements,
          ROUND(COALESCE(SUM(CAST(expected_goals_conceded AS REAL)), 0), 2) AS expected_goals_conceded,
          ROUND(COALESCE(SUM(xgp), 0), 2) AS xgp,
          ROUND(COALESCE(SUM(xap), 0), 2) AS xap,
          ROUND(COALESCE(SUM(xgip), 0), 2) AS xgip,
          COALESCE(SUM(tackles), 0) AS tackles,
          COALESCE(SUM(clearances_blocks_interceptions), 0) AS clearances_blocks_interceptions,
          COALESCE(SUM(recoveries), 0) AS recoveries,
          COALESCE(SUM(defensive_contribution), 0) AS defensive_contribution
        FROM player_history
        WHERE gameweek_fpl_id BETWEEN ? AND ?
        GROUP BY player_fpl_id
      )
    `;

    const countSql = `
      ${cte}
      SELECT COUNT(*) AS total
      FROM players p
      JOIN teams t ON t.fpl_id = p.team_fpl_id
      LEFT JOIN gw_stats gs ON gs.player_fpl_id = p.fpl_id
      ${where}
    `;
    const dataSql = `
      ${cte}
      SELECT
        p.fpl_id,
        p.web_name,
        p.first_name,
        p.second_name,
        p.code,
        p.element_type,
        p.now_cost,
        p.status,
        p.news,
        p.chance_of_playing_next_round,
        p.chance_of_playing_this_round,
        p.team_fpl_id,
        p.form,
        p.selected_by_percent,
        p.points_per_game,
        p.influence,
        p.creativity,
        p.threat,
        p.ict_index,
        t.name AS team_name,
        t.short_name AS team_short_name,
        COALESCE(gs.total_points, 0) AS total_points,
        COALESCE(gs.goals_scored, 0) AS goals_scored,
        COALESCE(gs.assists, 0) AS assists,
        COALESCE(gs.clean_sheets, 0) AS clean_sheets,
        COALESCE(gs.goals_conceded, 0) AS goals_conceded,
        COALESCE(gs.minutes, 0) AS minutes,
        COALESCE(gs.bonus, 0) AS bonus,
        COALESCE(gs.bps, 0) AS bps,
        COALESCE(gs.transfers_in, 0) AS transfers_in,
        COALESCE(gs.expected_goals, 0) AS expected_goals,
        COALESCE(gs.expected_assists, 0) AS expected_assists,
        COALESCE(gs.expected_goal_involvements, 0) AS expected_goal_involvements,
        COALESCE(gs.expected_goals_conceded, 0) AS expected_goals_conceded,
        COALESCE(gs.xgp, 0) AS xgp,
        COALESCE(gs.xap, 0) AS xap,
        COALESCE(gs.xgip, 0) AS xgip,
        COALESCE(gs.tackles, 0) AS tackles,
        COALESCE(gs.clearances_blocks_interceptions, 0) AS clearances_blocks_interceptions,
        COALESCE(gs.recoveries, 0) AS recoveries,
        COALESCE(gs.defensive_contribution, 0) AS defensive_contribution
      FROM players p
      JOIN teams t ON t.fpl_id = p.team_fpl_id
      LEFT JOIN gw_stats gs ON gs.player_fpl_id = p.fpl_id
      ${where}
      ORDER BY ${sortExpression} ${orderDirection}
      LIMIT ? OFFSET ?
    `;

    const totalRow = getDb()
      .prepare(countSql)
      .get(...cteParams, ...params) as { total: number };
    const rows = getDb()
      .prepare(dataSql)
      .all(...cteParams, ...params, perPage, offset) as DatabaseRow[];
    return rowsToPlayerPage(rows, totalRow.total);
  }

  const totalSql = `
    SELECT COUNT(*) AS total
    FROM players p
    JOIN teams t ON t.fpl_id = p.team_fpl_id
    ${where}
  `;
  const totalRow = getDb()
    .prepare(totalSql)
    .get(...params) as { total: number };
  const dataSql = `
    SELECT p.*, t.name AS team_name, t.short_name AS team_short_name
    FROM players p
    JOIN teams t ON t.fpl_id = p.team_fpl_id
    ${where}
    ORDER BY ${playerSortColumn(sort, false)} ${orderDirection}
    LIMIT ? OFFSET ?
  `;
  const rows = getDb()
    .prepare(dataSql)
    .all(...params, perPage, offset) as DatabaseRow[];
  return rowsToPlayerPage(rows, totalRow.total);
}

/** Return one player plus team labels for player detail pages. */
export const getPlayer = ttlCache(
  "getPlayer",
  60,
  (fplId: number): DatabaseRow | null => {
    const sql = `
    SELECT p.*, t.name AS team_name, t.short_name AS team_short_name
    FROM players p
    JOIN teams t ON t.fpl_id = p.team_fpl_id
    WHERE p.fpl_id = ?
    LIMIT 1
  `;
    return rowFor(sql, [fplId]);
  },
);

/** Return all recorded per-gameweek rows for a player in chronological order. */
export function getPlayerHistory(fplId: number): DatabaseRow[] {
  const sql = `
    SELECT ph.*, t.short_name AS opponent_short_name
    FROM player_history ph
    LEFT JOIN teams t ON t.fpl_id = ph.opponent_team
    WHERE ph.player_fpl_id = ?
    ORDER BY ph.gameweek_fpl_id ASC
  `;
  return rowsToDicts(rowsFor(sql, [fplId]));
}

/** Return historical season summary rows for a player, newest season first. */
export function getPlayerHistoryPast(fplId: number): DatabaseRow[] {
  const sql = `
    SELECT * FROM player_history_past
    WHERE player_fpl_id = ?
    ORDER BY season_name DESC
  `;
  return rowsToDicts(rowsFor(sql, [fplId]));
}

/** Return a team's squad grouped by position order for the team detail page. */
export function getTeamSquad(teamFplId: number): DatabaseRow[] {
  const sql = `
    SELECT * FROM players
    WHERE team_fpl_id = ?
    ORDER BY element_type ASC, total_points DESC
  `;
  return rowsToDicts(rowsFor(sql, [teamFplId]));
}

/** Return the next unfinished fixtures for a team with opponent context for badges and difficulty. */
export function getTeamFixtures(teamFplId: number, limit = 10): DatabaseRow[] {
  const sql = `
    SELECT
      f.*,
      th.name AS team_h_name,
      th.short_name AS team_h_short,
      ta.name AS team_a_name,
      ta.short_name AS team_a_short,
      CASE
        WHEN f.team_h_fpl_id = ? THEN f.team_a_difficulty
        ELSE f.team_h_difficulty
      END AS my_difficulty,
      CASE
        WHEN f.team_h_fpl_id = ? THEN ta.short_name
        ELSE th.short_name
      END AS opponent_short,
      CASE WHEN f.team_h_fpl_id = ? THEN 1 ELSE 0 END AS is_home
    FROM fixtures f
    JOIN teams th ON th.fpl_id = f.team_h_fpl_id
    JOIN teams ta ON ta.fpl_id = f.team_a_fpl_id
    WHERE (f.team_h_fpl_id = ? OR f.team_a_fpl_id = ?)
      AND f.finished = 0
    ORDER BY f.kickoff_time IS NULL ASC, f.kickoff_time ASC
    LIMIT ?
  `;

  return rowsToDicts(
    rowsFor(sql, [
      teamFplId,
      teamFplId,
      teamFplId,
      teamFplId,
      teamFplId,
      limit,
    ]),
  );
}

/** Return the dashboard snapshot: current gameweek, top performers, last scrape, and counts. */
export const getOverview = ttlCache(
  "getOverview",
  120,
  (): Record<string, unknown> => {
    const currentGameweek = getCurrentGameweek();
    const currentGameweekId =
      typeof currentGameweek?.fpl_id === "number"
        ? currentGameweek.fpl_id
        : null;

    let topPlayers: DatabaseRow[] = [];
    if (currentGameweekId !== null) {
      const sql = `
      SELECT p.fpl_id, p.web_name, p.code, p.team_fpl_id, p.element_type,
             t.short_name AS team_short,
             ph.total_points, ph.goals_scored, ph.assists,
             ph.minutes, ph.bonus, ph.clean_sheets
      FROM player_history ph
      JOIN players p ON p.fpl_id = ph.player_fpl_id
      JOIN teams t ON t.fpl_id = p.team_fpl_id
      WHERE ph.gameweek_fpl_id = ?
      ORDER BY ph.total_points DESC
      LIMIT 10
    `;
      topPlayers = rowsToDicts(rowsFor(sql, [currentGameweekId]));
    }

    const lastScrape = rowFor(
      "SELECT * FROM scrape_log ORDER BY started_at DESC LIMIT 1",
    );
    const playerCount =
      rowFor<{ total: number }>("SELECT COUNT(*) AS total FROM players")
        ?.total ?? 0;
    const teamCount =
      rowFor<{ total: number }>("SELECT COUNT(*) AS total FROM teams")?.total ??
      0;

    return {
      current_gameweek: currentGameweek,
      top_players: topPlayers,
      last_scrape: lastScrape,
      player_count: playerCount,
      team_count: teamCount,
    };
  },
);

/** Return player typeahead matches ordered by current points. */
export function searchPlayers(query: string, limit = 10): DatabaseRow[] {
  const like = `%${query}%`;
  const sql = `
    SELECT p.fpl_id, p.web_name, p.first_name, p.second_name,
           p.code, p.element_type, p.now_cost, p.total_points,
           t.short_name AS team_short
    FROM players p
    JOIN teams t ON t.fpl_id = p.team_fpl_id
    WHERE p.web_name LIKE ? OR p.first_name LIKE ? OR p.second_name LIKE ?
    ORDER BY p.total_points DESC
    LIMIT ?
  `;
  return rowsToDicts(rowsFor(sql, [like, like, like, limit]));
}

/** Return team typeahead matches ordered alphabetically. */
export function searchTeams(query: string, limit = 10): DatabaseRow[] {
  const like = `%${query}%`;
  const sql = `
    SELECT fpl_id, name, short_name, strength
    FROM teams
    WHERE name LIKE ? OR short_name LIKE ?
    ORDER BY name ASC
    LIMIT ?
  `;
  return rowsToDicts(rowsFor(sql, [like, like, limit]));
}

/** Return player rows for compare views without inventing placeholder rows. */
export function getComparePlayers(fplIds: readonly number[]): DatabaseRow[] {
  if (fplIds.length === 0) {
    return [];
  }

  const sql = `
    SELECT p.*, t.name AS team_name, t.short_name AS team_short_name
    FROM players p
    JOIN teams t ON t.fpl_id = p.team_fpl_id
    WHERE p.fpl_id IN (${placeholders(fplIds.length)})
  `;
  return rowsToDicts(rowsFor(sql, fplIds));
}

/** Return team rows for compare views without issuing invalid IN () SQL. */
export function getCompareTeams(fplIds: readonly number[]): DatabaseRow[] {
  if (fplIds.length === 0) {
    return [];
  }

  const sql = `SELECT * FROM teams WHERE fpl_id IN (${placeholders(fplIds.length)})`;
  return rowsToDicts(rowsFor(sql, fplIds));
}

/** Return compare chart history keyed by player id so callers can render aligned series. */
export function getComparePlayerHistories(
  fplIds: readonly number[],
): Record<number, DatabaseRow[]> {
  if (fplIds.length === 0) {
    return {};
  }

  const sql = `
    SELECT * FROM player_history
    WHERE player_fpl_id IN (${placeholders(fplIds.length)})
    ORDER BY player_fpl_id ASC, gameweek_fpl_id ASC
  `;
  const rows = rowsFor(sql, fplIds);
  const result: Record<number, DatabaseRow[]> = Object.fromEntries(
    fplIds.map((fplId) => [fplId, [] as DatabaseRow[]]),
  );

  for (const row of rows) {
    const playerFplId = row.player_fpl_id;
    if (typeof playerFplId === "number") {
      result[playerFplId]?.push({ ...row });
    }
  }
  return result;
}

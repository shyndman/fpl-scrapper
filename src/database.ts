import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import BetterSqlite3 from "better-sqlite3";

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

const logger = getLogger("src.database");
const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teams (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    fpl_id                  INTEGER NOT NULL UNIQUE,
    name                    TEXT NOT NULL,
    short_name              TEXT NOT NULL,
    code                    INTEGER,
    strength                INTEGER,
    strength_overall_home   INTEGER,
    strength_overall_away   INTEGER,
    strength_attack_home    INTEGER,
    strength_attack_away    INTEGER,
    strength_defence_home   INTEGER,
    strength_defence_away   INTEGER,
    pulse_id                INTEGER,
    scraped_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_teams_fpl_id ON teams(fpl_id);

CREATE TABLE IF NOT EXISTS gameweeks (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    fpl_id                  INTEGER NOT NULL UNIQUE,
    name                    TEXT NOT NULL,
    deadline_time           TEXT NOT NULL,
    average_entry_score     INTEGER,
    highest_score           INTEGER,
    highest_scoring_entry   INTEGER,
    is_current              INTEGER NOT NULL DEFAULT 0,
    is_next                 INTEGER NOT NULL DEFAULT 0,
    is_finished             INTEGER NOT NULL DEFAULT 0,
    chip_plays              TEXT,
    most_selected           INTEGER,
    most_transferred_in     INTEGER,
    most_captained          INTEGER,
    most_vice_captained     INTEGER,
    transfers_made          INTEGER,
    scraped_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gameweeks_fpl_id     ON gameweeks(fpl_id);
CREATE INDEX IF NOT EXISTS idx_gameweeks_is_current ON gameweeks(is_current);

CREATE TABLE IF NOT EXISTS players (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    fpl_id                          INTEGER NOT NULL UNIQUE,
    first_name                      TEXT NOT NULL,
    second_name                     TEXT NOT NULL,
    web_name                        TEXT NOT NULL,
    team_fpl_id                     INTEGER NOT NULL,
    element_type                    INTEGER NOT NULL,
    status                          TEXT,
    code                            INTEGER,
    now_cost                        INTEGER,
    cost_change_start               INTEGER,
    cost_change_event               INTEGER,
    chance_of_playing_this_round    INTEGER,
    chance_of_playing_next_round    INTEGER,
    total_points                    INTEGER DEFAULT 0,
    event_points                    INTEGER DEFAULT 0,
    points_per_game                 TEXT,
    form                            TEXT,
    selected_by_percent             TEXT,
    transfers_in                    INTEGER DEFAULT 0,
    transfers_out                   INTEGER DEFAULT 0,
    transfers_in_event              INTEGER DEFAULT 0,
    transfers_out_event             INTEGER DEFAULT 0,
    minutes                         INTEGER DEFAULT 0,
    goals_scored                    INTEGER DEFAULT 0,
    assists                         INTEGER DEFAULT 0,
    clean_sheets                    INTEGER DEFAULT 0,
    goals_conceded                  INTEGER DEFAULT 0,
    own_goals                       INTEGER DEFAULT 0,
    penalties_saved                 INTEGER DEFAULT 0,
    penalties_missed                INTEGER DEFAULT 0,
    yellow_cards                    INTEGER DEFAULT 0,
    red_cards                       INTEGER DEFAULT 0,
    saves                           INTEGER DEFAULT 0,
    bonus                           INTEGER DEFAULT 0,
    bps                             INTEGER DEFAULT 0,
    influence                       TEXT,
    creativity                      TEXT,
    threat                          TEXT,
    ict_index                       TEXT,
    starts                          INTEGER DEFAULT 0,
    expected_goals                  REAL,
    expected_assists                REAL,
    expected_goal_involvements      REAL,
    expected_goals_conceded         TEXT,
    xgp                             REAL,
    xap                             REAL,
    xgip                            REAL,
    tackles                         INTEGER DEFAULT 0,
    clearances_blocks_interceptions INTEGER DEFAULT 0,
    recoveries                      INTEGER DEFAULT 0,
    defensive_contribution          INTEGER DEFAULT 0,
    defensive_contribution_per_90   REAL,
    news                            TEXT,
    news_added                      TEXT,
    squad_number                    INTEGER,
    photo                           TEXT,
    scraped_at                      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_players_fpl_id       ON players(fpl_id);
CREATE INDEX IF NOT EXISTS idx_players_team         ON players(team_fpl_id);
CREATE INDEX IF NOT EXISTS idx_players_element_type ON players(element_type);
CREATE INDEX IF NOT EXISTS idx_players_status       ON players(status);

CREATE TABLE IF NOT EXISTS player_history (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    player_fpl_id                   INTEGER NOT NULL,
    gameweek_fpl_id                 INTEGER NOT NULL,
    opponent_team                   INTEGER,
    was_home                        INTEGER,
    kickoff_time                    TEXT,
    total_points                    INTEGER DEFAULT 0,
    minutes                         INTEGER DEFAULT 0,
    goals_scored                    INTEGER DEFAULT 0,
    assists                         INTEGER DEFAULT 0,
    clean_sheets                    INTEGER DEFAULT 0,
    goals_conceded                  INTEGER DEFAULT 0,
    own_goals                       INTEGER DEFAULT 0,
    penalties_saved                 INTEGER DEFAULT 0,
    penalties_missed                INTEGER DEFAULT 0,
    yellow_cards                    INTEGER DEFAULT 0,
    red_cards                       INTEGER DEFAULT 0,
    saves                           INTEGER DEFAULT 0,
    bonus                           INTEGER DEFAULT 0,
    bps                             INTEGER DEFAULT 0,
    influence                       TEXT,
    creativity                      TEXT,
    threat                          TEXT,
    ict_index                       TEXT,
    starts                          INTEGER DEFAULT 0,
    expected_goals                  REAL,
    expected_assists                REAL,
    expected_goal_involvements      REAL,
    expected_goals_conceded         TEXT,
    xgp                             REAL,
    xap                             REAL,
    xgip                            REAL,
    tackles                         INTEGER DEFAULT 0,
    clearances_blocks_interceptions INTEGER DEFAULT 0,
    recoveries                      INTEGER DEFAULT 0,
    defensive_contribution          INTEGER DEFAULT 0,
    value                           INTEGER,
    transfers_balance               INTEGER,
    selected                        INTEGER,
    transfers_in                    INTEGER DEFAULT 0,
    transfers_out                   INTEGER DEFAULT 0,
    round                           INTEGER,
    scraped_at                      TEXT NOT NULL,
    UNIQUE(player_fpl_id, gameweek_fpl_id)
);

CREATE INDEX IF NOT EXISTS idx_ph_player    ON player_history(player_fpl_id);
CREATE INDEX IF NOT EXISTS idx_ph_gameweek  ON player_history(gameweek_fpl_id);
CREATE INDEX IF NOT EXISTS idx_ph_player_gw ON player_history(player_fpl_id, gameweek_fpl_id);

CREATE TABLE IF NOT EXISTS player_history_past (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    player_fpl_id                   INTEGER NOT NULL,
    season_name                     TEXT NOT NULL,
    element_code                    INTEGER,
    start_cost                      INTEGER,
    end_cost                        INTEGER,
    total_points                    INTEGER DEFAULT 0,
    minutes                         INTEGER DEFAULT 0,
    goals_scored                    INTEGER DEFAULT 0,
    assists                         INTEGER DEFAULT 0,
    clean_sheets                    INTEGER DEFAULT 0,
    goals_conceded                  INTEGER DEFAULT 0,
    own_goals                       INTEGER DEFAULT 0,
    penalties_saved                 INTEGER DEFAULT 0,
    penalties_missed                INTEGER DEFAULT 0,
    yellow_cards                    INTEGER DEFAULT 0,
    red_cards                       INTEGER DEFAULT 0,
    saves                           INTEGER DEFAULT 0,
    bonus                           INTEGER DEFAULT 0,
    bps                             INTEGER DEFAULT 0,
    influence                       TEXT,
    creativity                      TEXT,
    threat                          TEXT,
    ict_index                       TEXT,
    starts                          INTEGER DEFAULT 0,
    expected_goals                  REAL,
    expected_assists                REAL,
    expected_goal_involvements      REAL,
    expected_goals_conceded         TEXT,
    tackles                         INTEGER DEFAULT 0,
    clearances_blocks_interceptions INTEGER DEFAULT 0,
    recoveries                      INTEGER DEFAULT 0,
    defensive_contribution          INTEGER DEFAULT 0,
    scraped_at                      TEXT NOT NULL,
    UNIQUE(player_fpl_id, season_name)
);

CREATE INDEX IF NOT EXISTS idx_php_player ON player_history_past(player_fpl_id);

CREATE TABLE IF NOT EXISTS fixtures (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    fpl_id                  INTEGER NOT NULL UNIQUE,
    gameweek_fpl_id         INTEGER,
    kickoff_time            TEXT,
    team_h_fpl_id           INTEGER NOT NULL,
    team_a_fpl_id           INTEGER NOT NULL,
    team_h_score            INTEGER,
    team_a_score            INTEGER,
    finished                INTEGER NOT NULL DEFAULT 0,
    finished_provisional    INTEGER DEFAULT 0,
    started                 INTEGER DEFAULT 0,
    minutes                 INTEGER DEFAULT 0,
    team_h_difficulty       INTEGER,
    team_a_difficulty       INTEGER,
    code                    INTEGER,
    pulse_id                INTEGER,
    stats                   TEXT,
    scraped_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fixtures_fpl_id ON fixtures(fpl_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_gw     ON fixtures(gameweek_fpl_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_team_h ON fixtures(team_h_fpl_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_team_a ON fixtures(team_a_fpl_id);

CREATE TABLE IF NOT EXISTS live_gameweek_stats (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    player_fpl_id                   INTEGER NOT NULL,
    gameweek_fpl_id                 INTEGER NOT NULL,
    minutes                         INTEGER DEFAULT 0,
    goals_scored                    INTEGER DEFAULT 0,
    assists                         INTEGER DEFAULT 0,
    clean_sheets                    INTEGER DEFAULT 0,
    goals_conceded                  INTEGER DEFAULT 0,
    own_goals                       INTEGER DEFAULT 0,
    penalties_saved                 INTEGER DEFAULT 0,
    penalties_missed                INTEGER DEFAULT 0,
    yellow_cards                    INTEGER DEFAULT 0,
    red_cards                       INTEGER DEFAULT 0,
    saves                           INTEGER DEFAULT 0,
    bonus                           INTEGER DEFAULT 0,
    bps                             INTEGER DEFAULT 0,
    influence                       TEXT,
    creativity                      TEXT,
    threat                          TEXT,
    ict_index                       TEXT,
    starts                          INTEGER DEFAULT 0,
    expected_goals                  REAL,
    expected_assists                REAL,
    expected_goal_involvements      REAL,
    expected_goals_conceded         TEXT,
    tackles                         INTEGER DEFAULT 0,
    clearances_blocks_interceptions INTEGER DEFAULT 0,
    recoveries                      INTEGER DEFAULT 0,
    defensive_contribution          INTEGER DEFAULT 0,
    total_points                    INTEGER DEFAULT 0,
    in_dreamteam                    INTEGER DEFAULT 0,
    explain                         TEXT,
    scraped_at                      TEXT NOT NULL,
    UNIQUE(player_fpl_id, gameweek_fpl_id)
);

CREATE INDEX IF NOT EXISTS idx_lgs_player ON live_gameweek_stats(player_fpl_id);
CREATE INDEX IF NOT EXISTS idx_lgs_gw     ON live_gameweek_stats(gameweek_fpl_id);

CREATE TABLE IF NOT EXISTS scrape_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id              TEXT NOT NULL,
    mode                TEXT NOT NULL,
    gameweek_fpl_id     INTEGER,
    started_at          TEXT NOT NULL,
    finished_at         TEXT,
    status              TEXT NOT NULL DEFAULT 'running',
    players_scraped     INTEGER DEFAULT 0,
    requests_made       INTEGER DEFAULT 0,
    errors_encountered  INTEGER DEFAULT 0,
    error_detail        TEXT
);
`;

type SqliteValue = string | number | null;
type TupleRow = { toDbTuple(): SqliteValue[] };
type BetterSqliteDatabase = InstanceType<typeof BetterSqlite3>;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

export type DatabaseRow = Record<string, SqliteValue>;
export type GameweekRow = DatabaseRow & {
  fpl_id: number;
  is_current: number;
  is_next: number;
};
export type ScrapeLogRow = DatabaseRow & {
  run_id: string;
  mode: string;
  status: string;
  finished_at: string | null;
  players_scraped: number;
  requests_made: number;
  errors_encountered: number;
  error_detail: string | null;
};

/**
 * Own the app's SQLite contract directly: create the current schema, expose explicit
 * upserts for each persisted model, and return plain rows that later sync/web ports can read naturally.
 */
export class FPLDatabase {
  readonly _conn: BetterSqliteDatabase;
  readonly _dbPath: string;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this._dbPath = dbPath;
    this._conn = new BetterSqlite3(dbPath);
    this._conn.pragma("journal_mode = WAL");
    this._conn.pragma("foreign_keys = ON");
    logger.debug("Opened database: %s", dbPath);
  }

  initializeSchema(): void {
    this._conn.exec(SCHEMA_SQL);
    logger.info("Database schema initialised at %s", this._dbPath);
  }

  upsertTeams(teams: readonly Team[]): number {
    return this.runBatch(
      `
        INSERT OR REPLACE INTO teams
            (fpl_id, name, short_name, code, strength,
             strength_overall_home, strength_overall_away,
             strength_attack_home, strength_attack_away,
             strength_defence_home, strength_defence_away,
             pulse_id, scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      teams,
    );
  }

  upsertGameweeks(gameweeks: readonly Gameweek[]): number {
    return this.runBatch(
      `
        INSERT OR REPLACE INTO gameweeks
            (fpl_id, name, deadline_time, average_entry_score, highest_score,
             highest_scoring_entry, is_current, is_next, is_finished,
             chip_plays, most_selected, most_transferred_in,
             most_captained, most_vice_captained, transfers_made, scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      gameweeks,
    );
  }

  upsertPlayers(players: readonly Player[]): number {
    return this.runBatch(
      `
        INSERT OR REPLACE INTO players
            (fpl_id, first_name, second_name, web_name, team_fpl_id, element_type,
             status, code, now_cost, cost_change_start, cost_change_event,
             chance_of_playing_this_round, chance_of_playing_next_round,
             total_points, event_points, points_per_game, form, selected_by_percent,
             transfers_in, transfers_out, transfers_in_event, transfers_out_event,
             minutes, goals_scored, assists, clean_sheets, goals_conceded, own_goals,
             penalties_saved, penalties_missed, yellow_cards, red_cards, saves,
             bonus, bps, influence, creativity, threat, ict_index, starts,
             expected_goals, expected_assists, expected_goal_involvements,
             expected_goals_conceded, xgp, xap, xgip,
             tackles, clearances_blocks_interceptions, recoveries,
             defensive_contribution, defensive_contribution_per_90,
             news, news_added, squad_number, photo, scraped_at)
        VALUES (${placeholders(57)})
      `,
      players,
    );
  }

  upsertPlayerHistory(rows: readonly PlayerHistory[]): number {
    return this.runBatch(
      `
        INSERT OR REPLACE INTO player_history
            (player_fpl_id, gameweek_fpl_id, opponent_team, was_home, kickoff_time,
             total_points, minutes, goals_scored, assists, clean_sheets,
             goals_conceded, own_goals, penalties_saved, penalties_missed,
             yellow_cards, red_cards, saves, bonus, bps,
             influence, creativity, threat, ict_index, starts,
             expected_goals, expected_assists, expected_goal_involvements,
             expected_goals_conceded, xgp, xap, xgip,
             tackles, clearances_blocks_interceptions, recoveries, defensive_contribution,
             value, transfers_balance, selected,
             transfers_in, transfers_out, round, scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      rows,
    );
  }

  upsertPlayerHistoryPast(rows: readonly PlayerHistoryPast[]): number {
    return this.runBatch(
      `
        INSERT OR REPLACE INTO player_history_past
            (player_fpl_id, season_name, element_code, start_cost, end_cost,
             total_points, minutes, goals_scored, assists, clean_sheets,
             goals_conceded, own_goals, penalties_saved, penalties_missed,
             yellow_cards, red_cards, saves, bonus, bps,
             influence, creativity, threat, ict_index, starts,
             expected_goals, expected_assists, expected_goal_involvements,
             expected_goals_conceded,
             tackles, clearances_blocks_interceptions, recoveries, defensive_contribution,
             scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      rows,
    );
  }

  upsertFixtures(fixtures: readonly Fixture[]): number {
    return this.runBatch(
      `
        INSERT OR REPLACE INTO fixtures
            (fpl_id, gameweek_fpl_id, kickoff_time,
             team_h_fpl_id, team_a_fpl_id, team_h_score, team_a_score,
             finished, finished_provisional, started, minutes,
             team_h_difficulty, team_a_difficulty, code, pulse_id, stats,
             scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      fixtures,
    );
  }

  upsertLiveGameweekStats(rows: readonly LiveGameweekStats[]): number {
    return this.runBatch(
      `
        INSERT OR REPLACE INTO live_gameweek_stats
            (player_fpl_id, gameweek_fpl_id, minutes, goals_scored, assists,
             clean_sheets, goals_conceded, own_goals, penalties_saved, penalties_missed,
             yellow_cards, red_cards, saves, bonus, bps,
             influence, creativity, threat, ict_index, starts,
             expected_goals, expected_assists, expected_goal_involvements,
             expected_goals_conceded,
             tackles, clearances_blocks_interceptions, recoveries, defensive_contribution,
             total_points, in_dreamteam, explain,
             scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      rows,
    );
  }

  getAllPlayerFplIds(): number[] {
    const rows = this._conn
      .prepare("SELECT fpl_id FROM players ORDER BY fpl_id")
      .all() as Array<{ fpl_id: number }>;
    return rows.map((row) => row.fpl_id);
  }

  getCurrentGameweek(): GameweekRow | null {
    return this.getOptionalRow<GameweekRow>(
      "SELECT * FROM gameweeks WHERE is_current = 1 ORDER BY fpl_id LIMIT 1",
    );
  }

  getNextGameweek(): GameweekRow | null {
    return this.getOptionalRow<GameweekRow>(
      "SELECT * FROM gameweeks WHERE is_next = 1 ORDER BY fpl_id LIMIT 1",
    );
  }

  getGameweekById(gameweekFplId: number): GameweekRow | null {
    return this.getOptionalRow<GameweekRow>(
      "SELECT * FROM gameweeks WHERE fpl_id = ? LIMIT 1",
      gameweekFplId,
    );
  }

  getActivePlayerIdsInGw(gameweekFplId: number): number[] {
    const rows = this._conn
      .prepare(
        `
          SELECT DISTINCT player_fpl_id
          FROM live_gameweek_stats
          WHERE gameweek_fpl_id = ? AND minutes > 0
          ORDER BY player_fpl_id
        `,
      )
      .all(gameweekFplId) as Array<{ player_fpl_id: number }>;
    return rows.map((row) => row.player_fpl_id);
  }

  getLastSuccessfulScrape(mode: string): ScrapeLogRow | null {
    return this.getOptionalRow<ScrapeLogRow>(
      `
        SELECT * FROM scrape_log
        WHERE mode = ? AND status = 'success'
        ORDER BY finished_at DESC
        LIMIT 1
      `,
      mode,
    );
  }

  startScrapeLog(
    runId: string,
    mode: string,
    gameweekFplId: number | null,
    startedAt: string,
  ): void {
    this._conn
      .prepare(
        `
          INSERT INTO scrape_log (run_id, mode, gameweek_fpl_id, started_at, status)
          VALUES (?, ?, ?, ?, 'running')
        `,
      )
      .run(runId, mode, gameweekFplId, startedAt);
  }

  finishScrapeLog(
    runId: string,
    status: string,
    playersScraped: number,
    requestsMade: number,
    errorsEncountered: number,
    finishedAt: string,
    errorDetail: string | null = null,
  ): void {
    this._conn
      .prepare(
        `
          UPDATE scrape_log
          SET status = ?, players_scraped = ?, requests_made = ?,
              errors_encountered = ?, finished_at = ?, error_detail = ?
          WHERE run_id = ?
        `,
      )
      .run(
        status,
        playersScraped,
        requestsMade,
        errorsEncountered,
        finishedAt,
        errorDetail,
        runId,
      );
  }

  close(): void {
    this._conn.close();
    logger.debug("Database connection closed");
  }

  private getOptionalRow<T extends DatabaseRow>(
    sql: string,
    ...params: SqliteValue[]
  ): T | null {
    const row = this._conn.prepare(sql).get(...params) as T | undefined;
    return row ?? null;
  }

  private runBatch<T extends TupleRow>(
    sql: string,
    rows: readonly T[],
  ): number {
    if (rows.length === 0) {
      return 0;
    }

    const statement = this._conn.prepare(sql);
    const transaction = this._conn.transaction((batch: readonly T[]) => {
      for (const row of batch) {
        statement.run(...row.toDbTuple());
      }
    });

    transaction(rows);
    return rows.length;
  }
}

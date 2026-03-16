import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FPLDatabase } from "../src/database.ts";
import {
  configure,
  getAllGameweeks,
  getAllTeams,
  getComparePlayerHistories,
  getComparePlayers,
  getCompareTeams,
  getCurrentGameweek,
  getDb,
  getOverview,
  getPlayer,
  getPlayerHistory,
  getPlayerHistoryPast,
  getPlayers,
  getTeam,
  getTeamFixtures,
  getTeamsWithStats,
  getTeamSquad,
  invalidateCache,
  rowsToDicts,
  searchPlayers,
  searchTeams,
} from "../webapp/db.ts";

const SCRAPED_AT = "2026-03-16T00:00:00Z";
const TEMP_DIRECTORIES: string[] = [];
const OPEN_DATABASES: FPLDatabase[] = [];
const OPEN_WRITERS: Array<InstanceType<typeof BetterSqlite3>> = [];

function createDatabase(): FPLDatabase {
  const tempDirectory = mkdtempSync(join(tmpdir(), "fpl-webapp-db-"));
  TEMP_DIRECTORIES.push(tempDirectory);

  const database = new FPLDatabase(join(tempDirectory, "webapp.db"));
  OPEN_DATABASES.push(database);
  database.initializeSchema();
  return database;
}

function openWriter(dbPath: string): InstanceType<typeof BetterSqlite3> {
  const writer = new BetterSqlite3(dbPath);
  OPEN_WRITERS.push(writer);
  return writer;
}

function seedConfiguredDb(): string {
  const database = createDatabase();
  const conn = database._conn;

  conn.exec(`
    INSERT INTO teams (fpl_id, name, short_name, code, strength, scraped_at)
    VALUES
      (1, 'Arsenal', 'ARS', 3, 5, '${SCRAPED_AT}'),
      (2, 'Brighton', 'BHA', 36, 4, '${SCRAPED_AT}');

    INSERT INTO gameweeks (fpl_id, name, deadline_time, is_current, is_finished, scraped_at)
    VALUES
      (1, 'GW1', '2026-08-10T10:00:00Z', 0, 1, '${SCRAPED_AT}'),
      (2, 'GW2', '2026-08-17T10:00:00Z', 1, 0, '${SCRAPED_AT}');

    INSERT INTO players (
      fpl_id, first_name, second_name, web_name, team_fpl_id, element_type,
      status, code, now_cost, total_points, points_per_game, form,
      selected_by_percent, transfers_in, minutes, goals_scored, assists,
      clean_sheets, goals_conceded, bonus, bps, influence, creativity,
      threat, ict_index, expected_goals, expected_assists,
      expected_goal_involvements, expected_goals_conceded, xgp, xap, xgip,
      tackles, clearances_blocks_interceptions, recoveries,
      defensive_contribution, scraped_at
    )
    VALUES
      (1, 'Alice', 'Alpha', 'Alpha', 1, 2, 'a', 111, 100, 20, '5.0', '1.5', '10.0', 1000, 180, 1, 0, 1, 1, 2, 20, '12.0', '3.0', '1.0', '16.0', 1.1, 0.2, 1.3, '0.4', 2.0, 0.3, 2.3, 5, 7, 9, 11, '${SCRAPED_AT}'),
      (2, 'Bob', 'Bravo', 'Bravo', 1, 3, 'i', 222, 90, 30, '6.0', '10.0', '5.0', 900, 175, 2, 4, 0, 0, 4, 25, '9.0', '7.0', '6.0', '22.0', 0.1, 1.0, 1.1, '0.2', 1.5, 1.2, 2.7, 3, 2, 4, 6, '${SCRAPED_AT}'),
      (3, 'Cara', 'Charlie', 'Charlie', 2, 4, 'd', 333, 85, 25, '4.0', '3.0', '3.0', 800, 160, 3, 1, 0, 2, 1, 18, '8.0', '4.0', '9.0', '21.0', 0.8, 0.4, 1.2, '0.9', 1.1, 0.5, 1.6, 1, 1, 2, 3, '${SCRAPED_AT}');

    INSERT INTO player_history (
      player_fpl_id, gameweek_fpl_id, opponent_team, was_home, kickoff_time,
      total_points, minutes, goals_scored, assists, clean_sheets,
      goals_conceded, bonus, bps, expected_goals, expected_assists,
      expected_goal_involvements, expected_goals_conceded, xgp, xap, xgip,
      tackles, clearances_blocks_interceptions, recoveries,
      defensive_contribution, transfers_in, scraped_at
    )
    VALUES
      (1, 1, 2, 1, '2026-08-12T12:00:00Z', 4, 90, 0, 0, 1, 0, 1, 12, 0.4, 0.1, 0.5, '0.1', 0.6, 0.2, 0.8, 2, 3, 4, 5, 100, '${SCRAPED_AT}'),
      (1, 2, 2, 0, '2026-08-19T12:00:00Z', 10, 90, 1, 0, 0, 1, 2, 18, 0.7, 0.1, 0.8, '0.3', 0.9, 0.2, 1.1, 3, 4, 5, 6, 120, '${SCRAPED_AT}'),
      (2, 1, 2, 1, '2026-08-12T12:00:00Z', 8, 88, 1, 1, 0, 0, 3, 16, 0.6, 0.7, 1.3, '0.2', 0.8, 0.8, 1.6, 1, 1, 2, 3, 130, '${SCRAPED_AT}'),
      (2, 2, 2, 0, '2026-08-19T12:00:00Z', 2, 87, 0, 0, 0, 0, 0, 9, 0.1, 0.3, 0.4, '0.1', 0.2, 0.4, 0.6, 2, 0, 1, 2, 140, '${SCRAPED_AT}'),
      (3, 1, 1, 0, '2026-08-12T12:00:00Z', 3, 80, 0, 0, 0, 1, 0, 8, 0.2, 0.1, 0.3, '0.5', 0.3, 0.1, 0.4, 0, 2, 1, 1, 90, '${SCRAPED_AT}'),
      (3, 2, 1, 1, '2026-08-19T12:00:00Z', 6, 80, 1, 0, 0, 1, 1, 14, 0.5, 0.2, 0.7, '0.4', 0.6, 0.2, 0.8, 1, 3, 2, 2, 95, '${SCRAPED_AT}');

    INSERT INTO player_history_past (
      player_fpl_id, season_name, total_points, expected_goals, expected_assists,
      expected_goal_involvements, expected_goals_conceded, scraped_at
    )
    VALUES
      (1, '2025/26', 150, 10.5, 3.2, 13.7, '4.4', '${SCRAPED_AT}'),
      (1, '2024/25', 120, 9.1, 2.4, 11.5, '5.0', '${SCRAPED_AT}');

    INSERT INTO fixtures (
      fpl_id, gameweek_fpl_id, kickoff_time, team_h_fpl_id, team_a_fpl_id,
      team_h_score, team_a_score, finished, team_h_difficulty,
      team_a_difficulty, scraped_at
    )
    VALUES
      (10, 1, '2026-08-12T12:00:00Z', 1, 2, 2, 1, 1, 2, 4, '${SCRAPED_AT}'),
      (11, 3, '2026-08-26T12:00:00Z', 2, 1, NULL, NULL, 0, 3, 2, '${SCRAPED_AT}');

    INSERT INTO scrape_log (
      run_id, mode, started_at, finished_at, status, players_scraped,
      requests_made, errors_encountered
    )
    VALUES
      ('run-1', 'full_sync', '${SCRAPED_AT}', '2026-03-16T01:00:00Z', 'success', 3, 12, 0);
  `);

  configure(database._dbPath);
  return database._dbPath;
}

beforeEach(() => {
  invalidateCache();
  configure("");
});

afterEach(() => {
  configure("");

  for (const writer of OPEN_WRITERS.splice(0)) {
    try {
      writer.close();
    } catch {
      // Test may already have closed the writer explicitly.
    }
  }

  for (const database of OPEN_DATABASES.splice(0)) {
    try {
      database.close();
    } catch {
      // Test may already have closed the database explicitly.
    }
  }

  for (const tempDirectory of TEMP_DIRECTORIES.splice(0)) {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

describe("webapp/db.ts", () => {
  it("fails clearly before configuration", () => {
    expect(() => getDb()).toThrow(/configure\(path\)/i);
  });

  it("opens a read-only connection with query_only enabled", () => {
    seedConfiguredDb();

    const db = getDb();
    const queryOnly = db.pragma("query_only", { simple: true });

    expect(db.prepare("SELECT 1 AS value").get()).toMatchObject({ value: 1 });
    expect(queryOnly).toBe(1);
    expect(() =>
      db
        .prepare(
          "INSERT INTO teams (fpl_id, name, short_name, scraped_at) VALUES (99, 'X', 'X', 'now')",
        )
        .run(),
    ).toThrow(/readonly|query only/i);
  });

  it("coerces expected metric fields without changing unrelated values", () => {
    const converted = rowsToDicts([
      {
        expected_goals: "1.25",
        expected_assists: "2.50",
        expected_goal_involvements: "3.75",
        other_value: "keep-me",
      },
    ]);

    expect(converted[0]).toEqual({
      expected_goals: 1.25,
      expected_assists: 2.5,
      expected_goal_involvements: 3.75,
      other_value: "keep-me",
    });
  });

  it("invalidates cached reads after external writes", () => {
    const dbPath = seedConfiguredDb();

    const initial = getAllTeams();
    const writer = openWriter(dbPath);
    writer
      .prepare(
        "INSERT INTO teams (fpl_id, name, short_name, code, strength, scraped_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(3, "Chelsea", "CHE", 8, 5, SCRAPED_AT);

    const cached = getAllTeams();
    invalidateCache();
    const refreshed = getAllTeams();

    expect(initial.map((team) => team.name)).toEqual(["Arsenal", "Brighton"]);
    expect(cached.map((team) => team.name)).toEqual(["Arsenal", "Brighton"]);
    expect(refreshed.map((team) => team.name)).toEqual([
      "Arsenal",
      "Brighton",
      "Chelsea",
    ]);
  });

  it("returns representative dashboard and entity queries", () => {
    seedConfiguredDb();

    expect(getAllGameweeks().map((gameweek) => gameweek.fpl_id)).toEqual([
      1, 2,
    ]);
    expect(getCurrentGameweek()).toMatchObject({ fpl_id: 2, is_current: 1 });
    expect(getTeam(1)).toMatchObject({ fpl_id: 1, name: "Arsenal" });
    expect(getPlayer(1)).toMatchObject({ fpl_id: 1, web_name: "Alpha" });
    expect(getPlayerHistory(1).map((row) => row.gameweek_fpl_id)).toEqual([
      1, 2,
    ]);
    expect(getPlayerHistory(1)[0]).toMatchObject({
      opponent_short_name: "BHA",
    });
    expect(getPlayerHistoryPast(1).map((row) => row.season_name)).toEqual([
      "2025/26",
      "2024/25",
    ]);
    expect(getTeamSquad(1).map((row) => row.web_name)).toEqual([
      "Alpha",
      "Bravo",
    ]);
    expect(getTeamFixtures(1, 8)).toEqual([
      expect.objectContaining({
        fpl_id: 11,
        opponent_short: "BHA",
        is_home: 0,
        my_difficulty: 3,
      }),
    ]);
    expect(getTeamsWithStats()).toEqual([
      expect.objectContaining({
        fpl_id: 1,
        wins: 1,
        draws: 0,
        losses: 0,
        team_xg: 1.2,
        team_xa: 1.2,
        team_xgi: 2.4,
        team_xgp: 3.5,
        team_xap: 1.5,
        team_xgip: 5,
      }),
      expect.objectContaining({
        fpl_id: 2,
        wins: 0,
        draws: 0,
        losses: 1,
        team_xg: 0.8,
      }),
    ]);

    const overview = getOverview();
    expect(overview).toMatchObject({
      current_gameweek: expect.objectContaining({ fpl_id: 2 }),
      last_scrape: expect.objectContaining({ run_id: "run-1" }),
      player_count: 3,
      team_count: 2,
    });
    expect(
      (overview.top_players as Array<{ web_name: string }>).map(
        (player) => player.web_name,
      ),
    ).toEqual(["Alpha", "Charlie", "Bravo"]);
  });

  it("filters, sorts, paginates, and aggregates players like the Python read model", () => {
    seedConfiguredDb();

    const [injuredMidfielders, total] = getPlayers({
      pos: 3,
      status: "injured",
      minCost: 80,
      maxCost: 95,
      sort: "form",
      order: "desc",
      page: 1,
      perPage: 5,
    });
    const [secondPage, pagedTotal] = getPlayers({
      team: 1,
      sort: "not_a_real_column",
      order: "asc",
      page: 2,
      perPage: 1,
    });
    const [gameweekPlayers, gameweekTotal] = getPlayers({
      gwStart: 1,
      gwEnd: 1,
      sort: "expected_goals",
      order: "desc",
      perPage: 10,
    });

    expect(total).toBe(1);
    expect(injuredMidfielders.map((player) => player.web_name)).toEqual([
      "Bravo",
    ]);
    expect(pagedTotal).toBe(2);
    expect(secondPage.map((player) => player.web_name)).toEqual(["Bravo"]);
    expect(gameweekTotal).toBe(3);
    expect(gameweekPlayers.map((player) => player.web_name)).toEqual([
      "Bravo",
      "Alpha",
      "Charlie",
    ]);
    expect(gameweekPlayers[0]).toMatchObject({
      total_points: 8,
      expected_goals: 0.6,
    });
    expect(gameweekPlayers[1]).toMatchObject({ total_points: 4 });
  });

  it("supports search and compare helpers including empty compare inputs", () => {
    seedConfiguredDb();

    expect(searchPlayers("har", 5).map((player) => player.web_name)).toEqual([
      "Charlie",
    ]);
    expect(searchTeams("Ars", 5).map((team) => team.name)).toEqual(["Arsenal"]);
    expect(
      new Set(getComparePlayers([1, 3]).map((player) => player.fpl_id)),
    ).toEqual(new Set([1, 3]));
    expect(new Set(getCompareTeams([2, 1]).map((team) => team.fpl_id))).toEqual(
      new Set([1, 2]),
    );

    const histories = getComparePlayerHistories([3, 1]);
    expect(histories[1]?.map((row) => row.gameweek_fpl_id)).toEqual([1, 2]);
    expect(histories[3]?.map((row) => row.gameweek_fpl_id)).toEqual([1, 2]);
    expect(getComparePlayers([])).toEqual([]);
    expect(getCompareTeams([])).toEqual([]);
    expect(getComparePlayerHistories([])).toEqual({});
  });
});

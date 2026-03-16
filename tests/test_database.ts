import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { FPLDatabase } from "../src/database.ts";
import { Fixture, Gameweek, Team } from "../src/models.ts";
import {
  transform_bootstrap,
  transform_element_summary,
  transform_event_live,
  transform_fixtures,
} from "../src/transform.ts";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const TEMP_DIRECTORIES: string[] = [];
const OPEN_DATABASES: FPLDatabase[] = [];

function loadFixture<T>(filename: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, filename), "utf8")) as T;
}

function createDatabase(): FPLDatabase {
  const tempDirectory = mkdtempSync(join(tmpdir(), "fpl-database-"));
  TEMP_DIRECTORIES.push(tempDirectory);

  const database = new FPLDatabase(join(tempDirectory, "test.db"));
  OPEN_DATABASES.push(database);
  database.initializeSchema();
  return database;
}

afterEach(() => {
  for (const database of OPEN_DATABASES.splice(0)) {
    try {
      database.close();
    } catch {
      // Tests may already have closed the connection explicitly.
    }
  }

  for (const tempDirectory of TEMP_DIRECTORIES.splice(0)) {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

describe("src/database.ts", () => {
  it("creates the full schema, keeps initialization idempotent, and preserves SQLite pragmas", () => {
    const db = createDatabase();

    db.initializeSchema();

    const tables = db._conn
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((row) => row.name);

    expect(tableNames).toEqual(
      expect.arrayContaining([
        "fixtures",
        "gameweeks",
        "live_gameweek_stats",
        "player_history",
        "player_history_past",
        "players",
        "scrape_log",
        "teams",
      ]),
    );
    expect(db._conn.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db._conn.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("upserts bootstrap rows and answers the gameweek/player helpers", () => {
    const db = createDatabase();
    const bootstrap = loadFixture<Record<string, unknown>>(
      "bootstrap_static.json",
    );
    const [teams, gameweeks, players] = transform_bootstrap(bootstrap);
    const baseCurrentGameweek =
      gameweeks.find((gameweek) => gameweek.fpl_id === 25) ?? gameweeks[0]!;
    const baseNextGameweek =
      gameweeks.find(
        (gameweek) => gameweek.fpl_id !== baseCurrentGameweek.fpl_id,
      ) ?? gameweeks[0]!;

    expect(db.upsertTeams(teams)).toBe(1);
    expect(db.upsertGameweeks(gameweeks)).toBe(2);
    expect(db.upsertPlayers(players)).toBe(1);

    const seededCurrentGameweek = new Gameweek(
      baseCurrentGameweek.fpl_id,
      baseCurrentGameweek.name,
      baseCurrentGameweek.deadline_time,
      baseCurrentGameweek.average_entry_score,
      baseCurrentGameweek.highest_score,
      baseCurrentGameweek.highest_scoring_entry,
      1,
      0,
      baseCurrentGameweek.is_finished,
      baseCurrentGameweek.chip_plays,
      baseCurrentGameweek.most_selected,
      baseCurrentGameweek.most_transferred_in,
      baseCurrentGameweek.most_captained,
      baseCurrentGameweek.most_vice_captained,
      baseCurrentGameweek.transfers_made,
      baseCurrentGameweek.scraped_at,
    );
    db.upsertGameweeks([seededCurrentGameweek]);

    const seededNextGameweek = new Gameweek(
      baseNextGameweek.fpl_id,
      baseNextGameweek.name,
      baseNextGameweek.deadline_time,
      baseNextGameweek.average_entry_score,
      baseNextGameweek.highest_score,
      baseNextGameweek.highest_scoring_entry,
      0,
      1,
      baseNextGameweek.is_finished,
      baseNextGameweek.chip_plays,
      baseNextGameweek.most_selected,
      baseNextGameweek.most_transferred_in,
      baseNextGameweek.most_captained,
      baseNextGameweek.most_vice_captained,
      baseNextGameweek.transfers_made,
      baseNextGameweek.scraped_at,
    );
    db.upsertGameweeks([seededNextGameweek]);

    const updatedTeam = new Team(
      1,
      "Arsenal FC",
      "ARS",
      3,
      5,
      1200,
      1190,
      1180,
      1170,
      1160,
      1150,
      1,
      teams[0]?.scraped_at,
    );
    db.upsertTeams([updatedTeam]);

    const currentGameweek = db.getCurrentGameweek();
    const nextGameweek = db.getNextGameweek();
    const gameweekById = db.getGameweekById(25);

    expect(currentGameweek).not.toBeNull();
    expect(currentGameweek?.fpl_id).toBe(baseCurrentGameweek.fpl_id);
    expect(nextGameweek?.fpl_id).toBe(baseNextGameweek.fpl_id);
    expect(gameweekById?.name).toBe(baseCurrentGameweek.name);
    expect(db.getAllPlayerFplIds()).toEqual([318]);
    const teamRow = db._conn
      .prepare("SELECT name FROM teams WHERE fpl_id = 1")
      .get() as { name: string } | undefined;
    expect(teamRow?.name).toBe("Arsenal FC");
    expect(
      db._conn
        .prepare(
          "SELECT now_cost, xgp, tackles FROM players WHERE fpl_id = 318",
        )
        .get(),
    ).toMatchObject({
      now_cost: players[0]!.now_cost,
      xgp: players[0]!.xgp,
      tackles: players[0]!.tackles,
    });
  });

  it("upserts player history, past history, fixtures, and live stats idempotently from real payloads", () => {
    const db = createDatabase();
    const [history, historyPast] = transform_element_summary(
      318,
      loadFixture<Record<string, unknown>>("element_summary_318.json"),
    );
    const fixtures = transform_fixtures(loadFixture<unknown>("fixtures.json"));
    const liveStats = transform_event_live(
      25,
      loadFixture<Record<string, unknown>>("event_25_live.json"),
    );

    expect(db.upsertPlayerHistory(history)).toBe(1);
    expect(db.upsertPlayerHistory(history)).toBe(1);
    expect(db.upsertPlayerHistoryPast(historyPast)).toBe(1);
    expect(db.upsertFixtures(fixtures)).toBe(1);
    expect(db.upsertLiveGameweekStats(liveStats)).toBe(1);

    expect(
      db._conn
        .prepare(
          "SELECT COUNT(*) AS count FROM player_history WHERE player_fpl_id = 318",
        )
        .get(),
    ).toMatchObject({ count: 1 });
    expect(
      db._conn
        .prepare(
          "SELECT season_name FROM player_history_past WHERE player_fpl_id = 318",
        )
        .get(),
    ).toMatchObject({ season_name: "2023/24" });
    expect(
      db._conn.prepare("SELECT stats FROM fixtures WHERE fpl_id = 1").get(),
    ).toMatchObject({
      stats: Fixture.fromDict(
        loadFixture<Record<string, unknown>[]>("fixtures.json")[0] as Record<
          string,
          unknown
        >,
      ).stats,
    });
    expect(
      db._conn
        .prepare(
          "SELECT total_points, explain FROM live_gameweek_stats WHERE player_fpl_id = 318 AND gameweek_fpl_id = 25",
        )
        .get(),
    ).toMatchObject({
      total_points: 12,
      explain: liveStats[0]?.explain,
    });
    expect(db.getActivePlayerIdsInGw(25)).toEqual([318]);
  });

  it("tracks scrape logs and returns the most recent successful run for a mode", () => {
    const db = createDatabase();

    db.startScrapeLog("run-error", "full_sync", null, "2025-01-01T00:00:00Z");
    db.finishScrapeLog(
      "run-error",
      "error",
      10,
      20,
      1,
      "2025-01-01T00:15:00Z",
      "boom",
    );
    db.startScrapeLog("run-success", "full_sync", 25, "2025-01-01T01:00:00Z");
    db.finishScrapeLog(
      "run-success",
      "success",
      700,
      750,
      0,
      "2025-01-01T01:30:00Z",
    );

    const latestSuccess = db.getLastSuccessfulScrape("full_sync");

    expect(latestSuccess).not.toBeNull();
    expect(latestSuccess).toMatchObject({
      run_id: "run-success",
      gameweek_fpl_id: 25,
      status: "success",
      players_scraped: 700,
      requests_made: 750,
      errors_encountered: 0,
      error_detail: null,
    });
    expect(
      db._conn
        .prepare("SELECT status FROM scrape_log WHERE run_id = ?")
        .get("run-error"),
    ).toMatchObject({ status: "error" });
  });

  it("closes the underlying SQLite connection", () => {
    const db = createDatabase();

    db.close();

    expect(() => db._conn.prepare("SELECT 1").get()).toThrow(/not open/i);
  });
});

import { describe, expect, it } from "vitest";

import {
  Fixture,
  Gameweek,
  LiveGameweekStats,
  Player,
  PlayerHistory,
  PlayerHistoryPast,
  ScrapeLog,
  Team,
  _bool_int,
  _float,
  _float_str,
  _int,
  _now,
  _str,
  _xp,
} from "../src/models.ts";

describe("src/models.ts helpers", () => {
  it("normalizes scalar helper inputs like the Python model layer", () => {
    expect(_str("  Salah  ")).toBe("Salah");
    expect(_str("   ")).toBeNull();

    expect(_int("42")).toBe(42);
    expect(_int("  -7  ")).toBe(-7);
    expect(_int(true)).toBe(1);
    expect(_int("3.5")).toBeNull();
    expect(_int("1e2")).toBeNull();
    expect(_int("not-an-int")).toBeNull();

    expect(_float_str("  12.34 ")).toBe("12.34");
    expect(_float_str(0)).toBe("0");
    expect(_float_str("  ")).toBeNull();

    expect(_float("3.5")).toBe(3.5);
    expect(_float("  ")).toBeNull();
    expect(_float("bad")).toBeNull();

    expect(_bool_int(true)).toBe(1);
    expect(_bool_int(0)).toBe(0);
    expect(_bool_int([])).toBe(0);
    expect(_bool_int({})).toBe(0);

    expect(_xp(5, 3.333)).toBe(1.67);
    expect(_xp(1, null)).toBeNull();
    expect(_xp("bad", 1.2)).toBeNull();
  });

  it("emits UTC ISO timestamps for scrape provenance", () => {
    expect(_now()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/u,
    );
  });
});

describe("src/models.ts rows", () => {
  it("builds Team rows with the SQLite tuple ordering intact", () => {
    const team = Team.fromDict({
      id: 14,
      name: "Liverpool",
      short_name: "LIV",
      code: "14",
      strength: "5",
      strength_overall_home: "1350",
      strength_overall_away: "1340",
      strength_attack_home: "1400",
      strength_attack_away: "1390",
      strength_defence_home: "1300",
      strength_defence_away: "1290",
      pulse_id: "7",
    });

    expect(team.toDbTuple()).toEqual([
      14,
      "Liverpool",
      "LIV",
      14,
      5,
      1350,
      1340,
      1400,
      1390,
      1300,
      1290,
      7,
      team.scraped_at,
    ]);
  });

  it("computes expected-performance fields for Player rows and preserves numeric strings", () => {
    const player = Player.fromDict({
      id: 10,
      first_name: "  Mo ",
      second_name: "Salah",
      web_name: "Salah",
      team: 14,
      element_type: 3,
      status: " a ",
      goals_scored: 5,
      assists: 4,
      expected_goals: "3.333",
      expected_assists: "1.111",
      expected_goal_involvements: "4.444",
      expected_goals_conceded: "2.20",
      points_per_game: "7.8",
      form: "12.3",
      selected_by_percent: "55.5",
      influence: "10.0",
      creativity: "20.0",
      threat: "30.0",
      ict_index: "40.0",
      news: "  fit ",
      photo: "  10.jpg ",
    });

    expect(player.first_name).toBe("  Mo ");
    expect(player.status).toBe("a");
    expect(player.news).toBe("fit");
    expect(player.photo).toBe("10.jpg");
    expect(player.expected_goals).toBe(3.333);
    expect(player.expected_assists).toBe(1.111);
    expect(player.expected_goals_conceded).toBe("2.20");
    expect(player.influence).toBe("10.0");
    expect(player.creativity).toBe("20.0");
    expect(player.threat).toBe("30.0");
    expect(player.xgp).toBe(1.67);
    expect(player.xap).toBe(2.89);
    expect(player.xgip).toBe(4.56);

    expect(player.toDbTuple().slice(0, 8)).toEqual([
      10,
      "  Mo ",
      "Salah",
      "Salah",
      14,
      3,
      "a",
      null,
    ]);
    expect(player.toDbTuple().slice(35, 47)).toEqual([
      "10.0",
      "20.0",
      "30.0",
      "40.0",
      0,
      3.333,
      1.111,
      4.444,
      "2.20",
      1.67,
      2.89,
      4.56,
    ]);
  });

  it("builds PlayerHistory rows with per-gameweek expectation deltas and tuple ordering", () => {
    const history = PlayerHistory.fromDict(318, {
      round: 25,
      opponent_team: 7,
      was_home: true,
      kickoff_time: "2026-02-01T15:00:00Z",
      goals_scored: 2,
      assists: 1,
      expected_goals: "1.245",
      expected_assists: "0.335",
      expected_goal_involvements: "1.58",
      expected_goals_conceded: "0.75",
      influence: "12.3",
      creativity: "4.5",
      threat: "6.7",
      ict_index: "23.5",
      value: "130",
      transfers_balance: "-1000",
      selected: "900000",
      transfers_in: 5000,
      transfers_out: 6000,
    });

    expect(history.gameweek_fpl_id).toBe(25);
    expect(history.was_home).toBe(1);
    expect(history.xgp).toBe(0.75);
    expect(history.xap).toBe(0.67);
    expect(history.xgip).toBe(1.42);
    expect(history.expected_goals_conceded).toBe("0.75");
    expect(history.toDbTuple().slice(0, 6)).toEqual([
      318,
      25,
      7,
      1,
      "2026-02-01T15:00:00Z",
      0,
    ]);
    expect(history.toDbTuple().slice(35, 42)).toEqual([
      130,
      -1000,
      900000,
      5000,
      6000,
      25,
      history.scraped_at,
    ]);
  });

  it("serializes JSON blobs and preserves tuple order for Gameweek, Fixture, and live stats rows", () => {
    const gameweek = Gameweek.fromDict({
      id: 25,
      name: "GW25",
      deadline_time: "2026-02-01T11:00:00Z",
      finished: false,
      chip_plays: [{ chip_name: "wildcard", num_played: 10 }],
    });
    const fixture = Fixture.fromDict({
      id: 1,
      event: 25,
      team_h: 1,
      team_a: 2,
      finished: false,
      finished_provisional: false,
      started: false,
      stats: [{ identifier: "goals_scored", h: [], a: [] }],
    });
    const live = LiveGameweekStats.fromDict(318, 25, {
      stats: {
        minutes: 90,
        expected_goals: "0.75",
        in_dreamteam: true,
      },
      explain: [[{ fixture: 1, points: 3 }]],
    });

    expect(JSON.parse(gameweek.chip_plays as string)).toEqual([
      { chip_name: "wildcard", num_played: 10 },
    ]);
    expect(JSON.parse(fixture.stats as string)).toEqual([
      { identifier: "goals_scored", h: [], a: [] },
    ]);
    expect(JSON.parse(live.explain as string)).toEqual([
      [{ fixture: 1, points: 3 }],
    ]);
    expect(live.in_dreamteam).toBe(1);

    expect(gameweek.toDbTuple().slice(0, 10)).toEqual([
      25,
      "GW25",
      "2026-02-01T11:00:00Z",
      null,
      null,
      null,
      0,
      0,
      0,
      gameweek.chip_plays,
    ]);
    expect(fixture.toDbTuple().slice(0, 16)).toEqual([
      1,
      25,
      null,
      1,
      2,
      null,
      null,
      0,
      0,
      0,
      0,
      null,
      null,
      null,
      null,
      fixture.stats,
    ]);
    expect(live.toDbTuple().slice(0, 6)).toEqual([318, 25, 90, 0, 0, 0]);
    expect(live.toDbTuple().slice(28, 32)).toEqual([
      0,
      1,
      live.explain,
      live.scraped_at,
    ]);
  });

  it("preserves PlayerHistoryPast numeric-string fields and final tuple layout", () => {
    const historyPast = PlayerHistoryPast.fromDict(318, {
      season_name: "2024/25",
      element_code: "12345",
      start_cost: "125",
      end_cost: "130",
      total_points: 250,
      minutes: 3000,
      goals_scored: 20,
      assists: 10,
      clean_sheets: 15,
      goals_conceded: 30,
      own_goals: 1,
      penalties_saved: 0,
      penalties_missed: 1,
      yellow_cards: 2,
      red_cards: 0,
      saves: 0,
      bonus: 40,
      bps: 800,
      influence: "900.1",
      creativity: "700.2",
      threat: "850.3",
      ict_index: "245.6",
      starts: 34,
      expected_goals: "18.2",
      expected_assists: "9.4",
      expected_goal_involvements: "27.6",
      expected_goals_conceded: "28.8",
      tackles: 20,
      clearances_blocks_interceptions: 8,
      recoveries: 55,
      defensive_contribution: 63,
    });

    expect(historyPast.influence).toBe("900.1");
    expect(historyPast.expected_goals_conceded).toBe("28.8");
    expect(historyPast.toDbTuple().slice(0, 6)).toEqual([
      318,
      "2024/25",
      12345,
      125,
      130,
      250,
    ]);
    expect(historyPast.toDbTuple().slice(28, 33)).toEqual([
      20,
      8,
      55,
      63,
      historyPast.scraped_at,
    ]);
  });

  it("keeps ScrapeLog tuple ordering explicit for later database writes", () => {
    const log = ScrapeLog.fromDict({
      run_id: "run-1",
      mode: "full_sync",
      gameweek_fpl_id: null,
      started_at: "2026-03-16T00:00:00+00:00",
      finished_at: "2026-03-16T00:01:00+00:00",
      status: "partial",
      players_scraped: 99,
      requests_made: 123,
      errors_encountered: 2,
      error_detail: "boom",
    });

    expect(log.toDbTuple()).toEqual([
      "run-1",
      "full_sync",
      null,
      "2026-03-16T00:00:00+00:00",
      "2026-03-16T00:01:00+00:00",
      "partial",
      99,
      123,
      2,
      "boom",
    ]);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { debugSpy, warnSpy } = vi.hoisted(() => ({
  debugSpy: vi.fn(),
  warnSpy: vi.fn(),
}));

vi.mock("../src/logger.ts", () => ({
  getLogger: () => ({
    debug: debugSpy,
    warn: warnSpy,
  }),
}));

import {
  transform_bootstrap,
  transform_element_summary,
  transform_event_live,
  transform_fixtures,
} from "../src/transform.ts";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture<T>(filename: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, filename), "utf8")) as T;
}

beforeEach(() => {
  debugSpy.mockClear();
  warnSpy.mockClear();
});

describe("src/transform.ts", () => {
  it("transforms bootstrap fixtures into team, gameweek, and player rows", () => {
    const data = loadFixture<Record<string, unknown>>("bootstrap_static.json");

    const [teams, gameweeks, players] = transform_bootstrap(data);

    expect(teams).toHaveLength(1);
    expect(gameweeks).toHaveLength(2);
    expect(players).toHaveLength(1);

    expect(teams[0]).toMatchObject({
      fpl_id: 1,
      name: "Arsenal",
      short_name: "ARS",
      strength: 4,
    });
    expect(
      gameweeks.find((gameweek) => gameweek.is_current === 1),
    ).toMatchObject({
      fpl_id: 25,
    });
    expect(players[0]).toMatchObject({
      fpl_id: 318,
      web_name: "Salah",
      now_cost: 130,
      total_points: 185,
      element_type: 3,
      form: "12.8",
      selected_by_percent: "45.2",
      expected_goals: 15.34,
    });
    expect(debugSpy).toHaveBeenCalledWith(
      "Transformed bootstrap: %d teams, %d gameweeks, %d players",
      1,
      2,
      1,
    );
  });

  it("treats missing bootstrap collections as empty and skips malformed players with warnings", () => {
    const data = loadFixture<Record<string, unknown>>("bootstrap_static.json");
    const malformedBootstrap = {
      ...data,
      teams: undefined,
      events: undefined,
      elements: [
        ...(data.elements as unknown[]),
        { web_name: "NoId", team: 1, element_type: 3 },
      ],
    };

    const [teams, gameweeks, players] = transform_bootstrap(malformedBootstrap);

    expect(teams).toEqual([]);
    expect(gameweeks).toEqual([]);
    expect(players).toHaveLength(1);
    expect(players[0].fpl_id).toBe(318);
    expect(warnSpy).toHaveBeenCalledWith(
      "Skipping malformed player %s: %s",
      undefined,
      expect.any(TypeError),
    );
  });

  it("transforms element-summary fixtures into current and past history rows", () => {
    const data = loadFixture<Record<string, unknown>>(
      "element_summary_318.json",
    );

    const [history, historyPast] = transform_element_summary(318, data);

    expect(history).toHaveLength(1);
    expect(historyPast).toHaveLength(1);
    expect(history[0]).toMatchObject({
      player_fpl_id: 318,
      gameweek_fpl_id: 24,
      total_points: 14,
      goals_scored: 2,
      was_home: 1,
    });
    expect(historyPast[0]).toMatchObject({
      player_fpl_id: 318,
      season_name: "2023/24",
      total_points: 229,
    });
  });

  it("treats missing element-summary arrays as empty collections", () => {
    const [history, historyPast] = transform_element_summary(318, {});

    expect(history).toEqual([]);
    expect(historyPast).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("transforms fixtures fixtures into stable rows and preserves serialized stats blobs", () => {
    const data = loadFixture<unknown>("fixtures.json");

    const fixtures = transform_fixtures(data);

    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      fpl_id: 1,
      gameweek_fpl_id: 1,
      team_h_fpl_id: 14,
      team_a_fpl_id: 3,
      finished: 1,
      team_h_score: 1,
    });
    expect(JSON.parse(fixtures[0].stats as string)).toEqual([
      {
        identifier: "goals_scored",
        h: [{ value: 1, element: 200 }],
        a: [{ value: 1, element: 150 }],
      },
    ]);
    expect(debugSpy).toHaveBeenCalledWith("Transformed %d fixtures", 1);
  });

  it("returns an empty fixture list when the payload is not an array", () => {
    expect(transform_fixtures({ fixtures: [] })).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("transforms event-live fixtures into live stat rows and preserves nested JSON blobs", () => {
    const data = loadFixture<Record<string, unknown>>("event_25_live.json");

    const rows = transform_event_live(25, data);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      player_fpl_id: 318,
      gameweek_fpl_id: 25,
      total_points: 12,
      in_dreamteam: 1,
      minutes: 90,
      influence: "60.2",
      expected_goals_conceded: "0.74",
    });
    expect(JSON.parse(rows[0].explain as string)).toEqual([
      {
        fixture: 290,
        stats: [
          { identifier: "minutes", points: 2, value: 90 },
          { identifier: "goals_scored", points: 5, value: 1 },
          { identifier: "assists", points: 3, value: 1 },
          { identifier: "bonus", points: 3, value: 3 },
        ],
      },
    ]);
    expect(debugSpy).toHaveBeenCalledWith(
      "Transformed %d live stats rows for GW%d",
      1,
      25,
    );
  });

  it("treats missing event-live elements as an empty collection", () => {
    expect(transform_event_live(25, {})).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

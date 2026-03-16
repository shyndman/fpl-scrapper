import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  _download,
  PLAYER_PHOTO_URL,
  PLAYER_PHOTO_URL_LEGACY,
  TEAM_BADGE_URL,
  downloadImages,
  playerPhotoUrl,
  teamBadgeUrl,
  type ImageResponse,
  type ImageSession,
} from "../webapp/images.ts";

const TEMP_DIRECTORIES: string[] = [];

class FakeResponse implements ImageResponse {
  readonly statusCode: number;
  readonly content: Uint8Array;

  constructor(statusCode: number, content: Uint8Array = new Uint8Array()) {
    this.statusCode = statusCode;
    this.content = content;
  }
}

class FakeSession implements ImageSession {
  readonly #responses: Map<string, FakeResponse | Error>;
  readonly urls: Array<[string, number]> = [];

  constructor(responses: Record<string, FakeResponse | Error>) {
    this.#responses = new Map(Object.entries(responses));
  }

  async get(url: string, timeoutMs: number): Promise<ImageResponse> {
    this.urls.push([url, timeoutMs]);
    const response = this.#responses.get(url);
    if (!response) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}

function createTempDirectory(): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), "fpl-webapp-images-"));
  TEMP_DIRECTORIES.push(tempDirectory);
  return tempDirectory;
}

function makeImageDb(dbPath: string): void {
  const db = new BetterSqlite3(dbPath);
  try {
    db.exec(`
      CREATE TABLE players (code INTEGER);
      CREATE TABLE teams (fpl_id INTEGER, code INTEGER);
      INSERT INTO players (code) VALUES (101), (202);
      INSERT INTO teams (fpl_id, code) VALUES (1, 7);
    `);
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const tempDirectory of TEMP_DIRECTORIES.splice(0)) {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

describe("webapp/images.ts", () => {
  it("writes downloaded bytes on success", async () => {
    const tempDirectory = createTempDirectory();
    const destination = join(tempDirectory, "asset.png");
    const session = new FakeSession({
      "https://example.test/ok.png": new FakeResponse(200, Buffer.from("png")),
    });

    await expect(
      _download("https://example.test/ok.png", destination, session),
    ).resolves.toBe(true);
    expect(readFileSync(destination)).toEqual(Buffer.from("png"));
  });

  it("returns false on http errors and thrown download failures", async () => {
    const tempDirectory = createTempDirectory();
    const httpDestination = join(tempDirectory, "http.png");
    const errorDestination = join(tempDirectory, "error.png");
    const session = new FakeSession({
      "https://example.test/missing.png": new FakeResponse(404),
      "https://example.test/error.png": new Error("boom"),
    });

    await expect(
      _download("https://example.test/missing.png", httpDestination, session),
    ).resolves.toBe(false);
    await expect(
      _download("https://example.test/error.png", errorDestination, session),
    ).resolves.toBe(false);
    expect(() => readFileSync(httpDestination)).toThrow();
    expect(() => readFileSync(errorDestination)).toThrow();
  });

  it("uses the legacy player fallback and saves badges by team fpl_id", async () => {
    const tempDirectory = createTempDirectory();
    const dbPath = join(tempDirectory, "images.db");
    makeImageDb(dbPath);

    const staticDir = join(tempDirectory, "static-images");
    const playerDir = join(staticDir, "players");
    const badgeDir = join(staticDir, "badges");
    mkdirSync(playerDir, { recursive: true });
    mkdirSync(badgeDir, { recursive: true });
    writeFileSync(join(playerDir, "p202.png"), Buffer.from("existing"));

    const session = new FakeSession({
      [PLAYER_PHOTO_URL.replace("{code}", "101")]: new FakeResponse(404),
      [PLAYER_PHOTO_URL_LEGACY.replace("{code}", "101")]: new FakeResponse(
        200,
        Buffer.from("legacy-player"),
      ),
      [TEAM_BADGE_URL.replace("{team_id}", "7")]: new FakeResponse(
        200,
        Buffer.from("badge"),
      ),
    });

    await downloadImages(dbPath, {
      session,
      sleep: async () => {},
      staticDir,
    });

    expect(readFileSync(join(playerDir, "p101.png"))).toEqual(
      Buffer.from("legacy-player"),
    );
    expect(readFileSync(join(playerDir, "p202.png"))).toEqual(
      Buffer.from("existing"),
    );
    expect(readFileSync(join(badgeDir, "t1.png"))).toEqual(
      Buffer.from("badge"),
    );
    expect(session.urls.map(([url]) => url)).toEqual([
      PLAYER_PHOTO_URL.replace("{code}", "101"),
      PLAYER_PHOTO_URL_LEGACY.replace("{code}", "101"),
      TEAM_BADGE_URL.replace("{team_id}", "7"),
    ]);
  });

  it("creates image directories and returns early when the db cannot be read", async () => {
    const tempDirectory = createTempDirectory();
    const staticDir = join(tempDirectory, "static-images");
    const session = new FakeSession({});

    await expect(
      downloadImages(join(tempDirectory, "missing.db"), {
        session,
        sleep: async () => {},
        staticDir,
      }),
    ).resolves.toBeUndefined();

    expect(existsSync(join(staticDir, "players"))).toBe(true);
    expect(existsSync(join(staticDir, "badges"))).toBe(true);
    expect(session.urls).toEqual([]);
  });

  it("uses downloaded image URLs and placeholder fallbacks", () => {
    const tempDirectory = createTempDirectory();
    const staticDir = join(tempDirectory, "static-images");
    mkdirSync(join(staticDir, "players"), { recursive: true });
    mkdirSync(join(staticDir, "badges"), { recursive: true });
    writeFileSync(
      join(staticDir, "players", "p101.png"),
      Buffer.from("player"),
    );
    writeFileSync(join(staticDir, "badges", "t1.png"), Buffer.from("badge"));

    expect(playerPhotoUrl(101, staticDir)).toBe(
      "/static/images/players/p101.png",
    );
    expect(playerPhotoUrl(999, staticDir)).toBe(
      "/static/images/placeholder_player.png",
    );
    expect(playerPhotoUrl(null, staticDir)).toBe(
      "/static/images/placeholder_player.png",
    );
    expect(teamBadgeUrl(1, staticDir)).toBe("/static/images/badges/t1.png");
    expect(teamBadgeUrl(99, staticDir)).toBe(
      "/static/images/placeholder_badge.png",
    );
    expect(teamBadgeUrl(null, staticDir)).toBe(
      "/static/images/placeholder_badge.png",
    );
  });
});

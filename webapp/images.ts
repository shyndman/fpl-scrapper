import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import BetterSqlite3 from "better-sqlite3";

import { getLogger } from "../src/logger.ts";

const logger = getLogger("webapp.images");
const DEFAULT_STATIC_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "static",
  "images",
);
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36";
const REQUEST_TIMEOUT_MS = 15_000;

export const PLAYER_PHOTO_URL =
  "https://resources.premierleague.com/premierleague25/photos/players/110x140/{code}.png";
export const PLAYER_PHOTO_URL_LEGACY =
  "https://resources.premierleague.com/premierleague/photos/players/110x140/p{code}.png";
export const TEAM_BADGE_URL =
  "https://resources.premierleague.com/premierleague/badges/70/t{team_id}.png";
export const SLEEP_BETWEEN_MS = 50;

interface PlayerRow {
  code: number;
}

interface TeamRow {
  fpl_id: number;
  code: number;
}

export interface ImageResponse {
  statusCode: number;
  content: Uint8Array;
}

export interface ImageSession {
  get(url: string, timeoutMs: number): Promise<ImageResponse>;
}

interface DownloadImagesDeps {
  session?: ImageSession;
  sleep?: (milliseconds: number) => Promise<void>;
  staticDir?: string;
}

function formatUrl(template: string, params: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/gu, (_match, key: string) =>
    String(params[key]),
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function createSession(fetchImpl: typeof fetch): ImageSession {
  return {
    async get(url: string, timeoutMs: number): Promise<ImageResponse> {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": DEFAULT_USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });

      return {
        statusCode: response.status,
        content: new Uint8Array(await response.arrayBuffer()),
      };
    },
  };
}

function readImageRows(dbPath: string): {
  playerRows: PlayerRow[];
  teamRows: TeamRow[];
} {
  const db = new BetterSqlite3(dbPath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    return {
      playerRows: db
        .prepare("SELECT DISTINCT code FROM players WHERE code IS NOT NULL")
        .all() as PlayerRow[],
      teamRows: db
        .prepare("SELECT fpl_id, code FROM teams WHERE code IS NOT NULL")
        .all() as TeamRow[],
    };
  } finally {
    db.close();
  }
}

export function _ensureDirs(staticDir = DEFAULT_STATIC_DIR): void {
  mkdirSync(join(staticDir, "players"), { recursive: true });
  mkdirSync(join(staticDir, "badges"), { recursive: true });
}

export async function _download(
  url: string,
  destination: string,
  session: ImageSession,
): Promise<boolean> {
  try {
    const response = await session.get(url, REQUEST_TIMEOUT_MS);
    if (response.statusCode !== 200) {
      logger.debug("HTTP %s for %s", response.statusCode, url);
      return false;
    }

    await writeFile(destination, response.content);
    return true;
  } catch (error) {
    logger.debug(
      "Download error for %s: %s",
      url,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/** Download any missing player photos and team badges into the static image tree at app startup. */
export async function downloadImages(
  dbPath: string,
  deps: DownloadImagesDeps = {},
): Promise<void> {
  const staticDir = deps.staticDir ?? DEFAULT_STATIC_DIR;
  _ensureDirs(staticDir);

  let playerRows: PlayerRow[];
  let teamRows: TeamRow[];
  try {
    ({ playerRows, teamRows } = readImageRows(dbPath));
  } catch (error) {
    logger.warn(
      "Could not read DB for image download: %s",
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  const session = deps.session ?? createSession(fetch);
  const pause = deps.sleep ?? sleep;

  const playerDir = join(staticDir, "players");
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const { code } of playerRows) {
    const destination = join(playerDir, `p${code}.png`);
    if (existsSync(destination)) {
      skipped += 1;
      continue;
    }

    let ok = await _download(
      formatUrl(PLAYER_PHOTO_URL, { code }),
      destination,
      session,
    );
    if (!ok) {
      ok = await _download(
        formatUrl(PLAYER_PHOTO_URL_LEGACY, { code }),
        destination,
        session,
      );
    }

    if (ok) {
      downloaded += 1;
    } else {
      failed += 1;
    }
    await pause(SLEEP_BETWEEN_MS);
  }

  logger.info(
    "Player photos: %d downloaded, %d skipped, %d failed",
    downloaded,
    skipped,
    failed,
  );

  const badgeDir = join(staticDir, "badges");
  downloaded = 0;
  skipped = 0;
  failed = 0;

  for (const { fpl_id, code } of teamRows) {
    const destination = join(badgeDir, `t${fpl_id}.png`);
    if (existsSync(destination)) {
      skipped += 1;
      continue;
    }

    const ok = await _download(
      formatUrl(TEAM_BADGE_URL, { team_id: code }),
      destination,
      session,
    );
    if (ok) {
      downloaded += 1;
    } else {
      failed += 1;
    }
    await pause(SLEEP_BETWEEN_MS);
  }

  logger.info(
    "Team badges: %d downloaded, %d skipped, %d failed",
    downloaded,
    skipped,
    failed,
  );
}

/** Return the static URL for a player photo, falling back to the shared placeholder when absent. */
export function playerPhotoUrl(
  code: number | null | undefined,
  staticDir = DEFAULT_STATIC_DIR,
): string {
  if (code == null) {
    return "/static/images/placeholder_player.png";
  }

  return existsSync(join(staticDir, "players", `p${code}.png`))
    ? `/static/images/players/p${code}.png`
    : "/static/images/placeholder_player.png";
}

/** Return the static URL for a team badge, falling back to the shared placeholder when absent. */
export function teamBadgeUrl(
  teamFplId: number | null | undefined,
  staticDir = DEFAULT_STATIC_DIR,
): string {
  if (teamFplId == null) {
    return "/static/images/placeholder_badge.png";
  }

  return existsSync(join(staticDir, "badges", `t${teamFplId}.png`))
    ? `/static/images/badges/t${teamFplId}.png`
    : "/static/images/placeholder_badge.png";
}

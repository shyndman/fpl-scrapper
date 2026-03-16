import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { FPLAuthError } from "./errors.ts";
import { getLogger } from "./logger.ts";
import type { PersistedSession, SessionCookies } from "./types.ts";

const logger = getLogger("src.auth");
const LOGIN_URL = "https://users.premierleague.com/accounts/login/";
const COOKIE_NAMES = new Set(["pl_profile", "sessionid"]);
const SESSION_TTL_HOURS = 20;
const LOGIN_TIMEOUT_MS = 30_000;
const LOGIN_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
} as const;

type HeadersWithSetCookie = Headers & {
  getSetCookie?: () => string[];
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getSessionExpiryIso(): string {
  return new Date(
    Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();
}

function splitCombinedSetCookieHeader(setCookieHeader: string): string[] {
  return setCookieHeader
    .split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function getSetCookieHeaders(headers: Headers): string[] {
  const headersWithSetCookie = headers as HeadersWithSetCookie;
  if (typeof headersWithSetCookie.getSetCookie === "function") {
    return headersWithSetCookie.getSetCookie();
  }

  const combinedHeader = headers.get("set-cookie");
  return combinedHeader ? splitCombinedSetCookieHeader(combinedHeader) : [];
}

function parseCookies(headers: Headers): SessionCookies {
  const cookies: SessionCookies = {};

  for (const setCookieHeader of getSetCookieHeaders(headers)) {
    const [cookiePair] = setCookieHeader.split(";", 1);
    if (!cookiePair) {
      continue;
    }

    const equalsIndex = cookiePair.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const cookieName = cookiePair.slice(0, equalsIndex).trim();
    if (!COOKIE_NAMES.has(cookieName)) {
      continue;
    }

    cookies[cookieName] = cookiePair.slice(equalsIndex + 1);
  }

  return cookies;
}

function isValidSession(
  session: PersistedSession | null,
): session is PersistedSession {
  if (!session) {
    return false;
  }

  const expiry = Date.parse(session.expires_at);
  if (Number.isNaN(expiry)) {
    return false;
  }

  return Date.now() < expiry;
}

/**
 * Supplies the minimal FPL auth cookie subset callers need, reusing a cached
 * session when it is still trustworthy and re-authenticating otherwise.
 */
export class FPLAuth {
  readonly #sessionFile: string;
  readonly #login: string;
  readonly #password: string;

  constructor(sessionFile: string, login: string, password: string) {
    this.#sessionFile = sessionFile;
    this.#login = login;
    this.#password = password;
  }

  async getCookies(): Promise<SessionCookies> {
    const cached = await this.#loadSession();
    if (isValidSession(cached)) {
      logger.debug("Using cached FPL session cookies");
      return cached.cookies;
    }

    logger.info("Authenticating with FPL...");
    return this.#loginAndSave();
  }

  async invalidate(): Promise<void> {
    try {
      await unlink(this.#sessionFile);
      logger.debug("Invalidated cached session");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  async #loginAndSave(): Promise<SessionCookies> {
    if (!this.#login || !this.#password) {
      throw new FPLAuthError(
        "FPL credentials not configured. Set FPL_LOGIN and FPL_PASSWORD in your .env file.",
      );
    }

    const payload = new URLSearchParams({
      login: this.#login,
      password: this.#password,
      redirect_uri: "https://fantasy.premierleague.com/",
      app: "plfpl-web",
    });

    let response: Response;
    try {
      response = await fetch(LOGIN_URL, {
        method: "POST",
        headers: LOGIN_HEADERS,
        body: payload,
        signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
      });
    } catch (error) {
      throw new FPLAuthError(
        `Login request failed: ${describeError(error)}`,
        error,
      );
    }

    if (response.status !== 200 && response.status !== 302) {
      throw new FPLAuthError(
        `Login returned HTTP ${response.status}. Check your FPL_LOGIN and FPL_PASSWORD.`,
      );
    }

    const cookies = parseCookies(response.headers);
    if (Object.keys(cookies).length === 0) {
      throw new FPLAuthError(
        "Login succeeded but no session cookies were returned. FPL may have changed their auth flow.",
      );
    }

    await this.#saveSession(cookies);
    logger.info("FPL login successful");
    return cookies;
  }

  async #saveSession(cookies: SessionCookies): Promise<void> {
    await mkdir(dirname(this.#sessionFile), { recursive: true });

    const session: PersistedSession = {
      cookies,
      expires_at: getSessionExpiryIso(),
    };

    await writeFile(this.#sessionFile, JSON.stringify(session), "utf8");
    await chmod(this.#sessionFile, 0o600);
    logger.debug(
      "Session saved to %s (expires %s)",
      this.#sessionFile,
      session.expires_at,
    );
  }

  async #loadSession(): Promise<PersistedSession | null> {
    try {
      const rawSession = await readFile(this.#sessionFile, "utf8");
      return JSON.parse(rawSession) as PersistedSession;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }

      if (error instanceof SyntaxError || isNodeError(error)) {
        logger.warn("Could not read session file; will re-authenticate");
        return null;
      }

      throw error;
    }
  }
}

import {
  FPLAPIError,
  FPLAuthError,
  FPLNotFoundError,
  FPLRateLimitError,
} from "./errors.ts";
import { getLogger } from "./logger.ts";
import type { SessionCookies } from "./types.ts";

const logger = getLogger("src.scraper");

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-GB,en;q=0.9",
  Referer: "https://fantasy.premierleague.com/",
} as const;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_AFTER_SECONDS = 60;

type Sleep = (milliseconds: number) => Promise<void>;
type Clock = () => number;
type Random = () => number;
type FetchLike = typeof fetch;

export interface ScraperAuth {
  getCookies(): Promise<SessionCookies>;
  invalidate(): Promise<void>;
}

interface RateLimiterDeps {
  sleep?: Sleep;
  now?: Clock;
  random?: Random;
}

interface ScraperDeps {
  fetch?: FetchLike;
  sleep?: Sleep;
  now?: Clock;
  random?: Random;
}

export interface FPLScraperOptions {
  minDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  maxRetries?: number;
  maxBackoff?: number;
  timeoutMs?: number;
  deps?: ScraperDeps;
}

interface GetOptions {
  requiresAuth?: boolean;
  params?: Record<string, string | number | boolean | null | undefined>;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeDelayBounds(
  minDelay: number,
  maxDelay: number,
): {
  minDelay: number;
  maxDelay: number;
} {
  return minDelay <= maxDelay
    ? { minDelay, maxDelay }
    : { minDelay: maxDelay, maxDelay: minDelay };
}

function buildCookieHeader(cookies: SessionCookies): string | null {
  const entries = Object.entries(cookies).filter(
    ([, value]) => value.length > 0,
  );
  if (entries.length === 0) {
    return null;
  }

  return entries.map(([name, value]) => `${name}=${value}`).join("; ");
}

function normalizeUrl(baseUrl: string, path: string): string {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/u, "");
  const trimmedPath = path.replace(/^\/+|\/+$/gu, "");
  return `${trimmedBaseUrl}/${trimmedPath}/`;
}

function appendSearchParams(
  url: URL,
  params: Record<string, string | number | boolean | null | undefined>,
): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

function parseRetryAfterSeconds(headerValue: string | null): number {
  const parsed = Number.parseInt(headerValue ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_RETRY_AFTER_SECONDS;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Enforces the scraper's minimum inter-request delay without penalizing the
 * first outbound request.
 */
export class RateLimiter {
  readonly #minDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #sleep: Sleep;
  readonly #now: Clock;
  readonly #random: Random;
  #lastCallMs: number | null = null;

  constructor(
    minDelaySeconds: number,
    maxDelaySeconds: number,
    deps: RateLimiterDeps = {},
  ) {
    const { minDelay, maxDelay } = normalizeDelayBounds(
      minDelaySeconds,
      maxDelaySeconds,
    );
    this.#minDelayMs = minDelay * 1000;
    this.#maxDelayMs = maxDelay * 1000;
    this.#sleep = deps.sleep ?? sleep;
    this.#now = deps.now ?? (() => performance.now());
    this.#random = deps.random ?? Math.random;
  }

  async wait(): Promise<void> {
    const now = this.#now();
    if (this.#lastCallMs === null) {
      this.#lastCallMs = now;
      return;
    }

    const delayMs =
      this.#minDelayMs + (this.#maxDelayMs - this.#minDelayMs) * this.#random();
    const elapsedMs = now - this.#lastCallMs;
    const remainingMs = delayMs - elapsedMs;
    if (remainingMs > 0) {
      logger.debug("Rate limit: sleeping %.2fs", remainingMs / 1000);
      await this.#sleep(remainingMs);
    }

    this.#lastCallMs = this.#now();
  }
}

/**
 * Performs FPL API GET requests with the same transport guarantees as the
 * Python scraper: normalized URLs, default headers, auth cookies, retries, and
 * observable request counting.
 */
export class FPLScraper {
  readonly #auth: ScraperAuth;
  readonly #baseUrl: string;
  readonly #backoffFactor: number;
  readonly #maxRetries: number;
  readonly #maxBackoffSeconds: number;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #sleep: Sleep;
  readonly #rateLimiter: RateLimiter;
  #requestCount = 0;

  constructor(
    auth: ScraperAuth,
    baseUrl: string,
    options: FPLScraperOptions = {},
  ) {
    const minDelay = options.minDelay ?? 2;
    const maxDelay = options.maxDelay ?? 3;

    this.#auth = auth;
    this.#baseUrl = baseUrl.replace(/\/+$/u, "");
    this.#backoffFactor = options.backoffFactor ?? 2;
    this.#maxRetries = options.maxRetries ?? 5;
    this.#maxBackoffSeconds = options.maxBackoff ?? 120;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.deps?.fetch ?? fetch;
    this.#sleep = options.deps?.sleep ?? sleep;
    this.#rateLimiter = new RateLimiter(minDelay, maxDelay, {
      now: options.deps?.now,
      random: options.deps?.random,
      sleep: options.deps?.sleep,
    });
  }

  get requestCount(): number {
    return this.#requestCount;
  }

  async get(path: string, options: GetOptions = {}): Promise<unknown> {
    const url = new URL(normalizeUrl(this.#baseUrl, path));
    if (options.params) {
      appendSearchParams(url, options.params);
    }

    let lastError: unknown;
    let reauthenticated = false;

    for (let attempt = 0; attempt < this.#maxRetries; attempt += 1) {
      await this.#rateLimiter.wait();

      const headers = new Headers(DEFAULT_HEADERS);
      if (options.requiresAuth) {
        const cookieHeader = buildCookieHeader(await this.#auth.getCookies());
        if (cookieHeader) {
          headers.set("Cookie", cookieHeader);
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(
          new DOMException("The operation timed out.", "TimeoutError"),
        );
      }, this.#timeoutMs);

      let response: Response;
      try {
        response = await this.#fetch(url, {
          headers,
          method: "GET",
          signal: controller.signal,
        });
        this.#requestCount += 1;
      } catch (error) {
        clearTimeout(timeout);

        lastError = error;
        const backoffSeconds = this.#backoff(attempt);
        logger.warn(
          isTimeoutError(error)
            ? "Timeout (attempt %d/%d) — sleeping %.1fs"
            : "Connection error (attempt %d/%d): %s — sleeping %.1fs",
          attempt + 1,
          this.#maxRetries,
          ...(isTimeoutError(error)
            ? [backoffSeconds]
            : [describeError(error), backoffSeconds]),
        );
        await this.#sleep(backoffSeconds * 1000);
        continue;
      }

      clearTimeout(timeout);

      if (response.status === 200) {
        logger.debug("GET %s -> 200 (attempt %d)", url.toString(), attempt + 1);
        return (await response.json()) as unknown;
      }

      if (response.status === 404) {
        throw new FPLNotFoundError(`404 Not Found: ${url.toString()}`);
      }

      if (response.status === 403) {
        if (!reauthenticated) {
          logger.info(
            "403 Forbidden — refreshing session cookies and retrying",
          );
          reauthenticated = true;
          await this.#auth.invalidate();
          continue;
        }

        throw new FPLAuthError(
          `403 Forbidden after re-auth attempt: ${url.toString()}. Check your FPL credentials.`,
        );
      }

      if (response.status === 429) {
        const retryAfterSeconds = parseRetryAfterSeconds(
          response.headers.get("Retry-After"),
        );
        logger.warn(
          "429 Rate limited — sleeping %ds (Retry-After)",
          retryAfterSeconds,
        );
        await this.#sleep(retryAfterSeconds * 1000);
        lastError = new FPLRateLimitError(`Rate limited on ${url.toString()}`);
        continue;
      }

      if (response.status >= 500) {
        const backoffSeconds = this.#backoff(attempt);
        logger.warn(
          "HTTP %d on %s (attempt %d/%d) — sleeping %.1fs",
          response.status,
          url.toString(),
          attempt + 1,
          this.#maxRetries,
          backoffSeconds,
        );
        lastError = new FPLAPIError(
          `HTTP ${response.status}: ${url.toString()}`,
        );
        await this.#sleep(backoffSeconds * 1000);
        continue;
      }

      throw new FPLAPIError(
        `Unexpected HTTP ${response.status}: ${url.toString()}`,
      );
    }

    if (lastError instanceof FPLRateLimitError) {
      throw lastError;
    }

    throw new FPLAPIError(
      `Max retries (${this.#maxRetries}) exceeded for ${url.toString()}`,
      lastError,
    );
  }

  #backoff(attempt: number): number {
    return Math.min(
      this.#maxBackoffSeconds,
      this.#backoffFactor ** attempt * 2,
    );
  }
}

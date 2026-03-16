import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FPLAPIError,
  FPLAuthError,
  FPLNotFoundError,
  FPLRateLimitError,
} from '../src/errors.ts';
import { setupLogging } from '../src/logger.ts';
import { FPLScraper, RateLimiter } from '../src/scraper.ts';
import type { SessionCookies } from '../src/types.ts';

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

type QueuedFetchResult = Response | Error;

type FetchCall = [input: URL | string | Request, init?: RequestInit];

setupLogging('error');

interface AuthStub {
  getCookies: ReturnType<typeof vi.fn<() => Promise<SessionCookies>>>;
  invalidate: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function createJsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    status,
  });
}

function createAuthStub(...cookieSets: SessionCookies[]): AuthStub {
  const queuedCookieSets = cookieSets.length > 0 ? cookieSets : [{}];
  return {
    getCookies: vi.fn(async () => queuedCookieSets.shift() ?? {}),
    invalidate: vi.fn(async () => undefined),
  };
}

function createFetchStub(...results: QueuedFetchResult[]) {
  const queue = [...results];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) {
      throw new Error('fetch queue exhausted');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
}

function createScraper(options: {
  auth?: AuthStub;
  fetchResults?: QueuedFetchResult[];
  maxRetries?: number;
  minDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  maxBackoff?: number;
  timeoutMs?: number;
  sleep?: ReturnType<typeof vi.fn<(milliseconds: number) => Promise<void>>>;
  now?: () => number;
  random?: () => number;
} = {}) {
  const auth = options.auth ?? createAuthStub();
  const fetchMock = createFetchStub(...(options.fetchResults ?? [createJsonResponse(200, {})]));
  const sleepMock =
    options.sleep ?? vi.fn<(milliseconds: number) => Promise<void>>(async () => undefined);

  const scraper = new FPLScraper(auth, 'https://fantasy.premierleague.com/api/', {
    backoffFactor: options.backoffFactor ?? 0.01,
    deps: {
      fetch: fetchMock as typeof fetch,
      now: options.now,
      random: options.random,
      sleep: sleepMock,
    },
    maxBackoff: options.maxBackoff ?? 0.05,
    maxDelay: options.maxDelay ?? 0,
    maxRetries: options.maxRetries ?? 3,
    minDelay: options.minDelay ?? 0,
    timeoutMs: options.timeoutMs ?? 5,
  });

  return { auth, fetchMock, scraper, sleepMock };
}

function getFetchCall(fetchMock: ReturnType<typeof vi.fn>, index = 0): FetchCall {
  return fetchMock.mock.calls[index] as FetchCall;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('src/scraper.ts', () => {
  describe('RateLimiter', () => {
    it('does not wait on the first call', async () => {
      const sleepMock = vi.fn<(milliseconds: number) => Promise<void>>(async () => undefined);
      const limiter = new RateLimiter(5, 5, {
        now: () => 100,
        random: () => 0,
        sleep: sleepMock,
      });

      await limiter.wait();

      expect(sleepMock).not.toHaveBeenCalled();
    });

    it('enforces the remaining delay between calls', async () => {
      const sleepMock = vi.fn<(milliseconds: number) => Promise<void>>(async () => undefined);
      const nowValues = [1000, 1030, 1030];
      const limiter = new RateLimiter(0.05, 0.05, {
        now: () => nowValues.shift() ?? 1030,
        random: () => 0,
        sleep: sleepMock,
      });

      await limiter.wait();
      await limiter.wait();

      expect(sleepMock).toHaveBeenCalledOnce();
      expect(sleepMock).toHaveBeenCalledWith(20);
    });
  });

  it('returns JSON for a successful 200 response', async () => {
    const { scraper } = createScraper({
      fetchResults: [createJsonResponse(200, { elements: [] })],
    });

    await expect(scraper.get('bootstrap-static')).resolves.toEqual({ elements: [] });
    expect(scraper.requestCount).toBe(1);
  });

  it('raises FPLNotFoundError for 404 responses', async () => {
    const { scraper } = createScraper({
      fetchResults: [createJsonResponse(404, { detail: 'missing' })],
    });

    await expect(scraper.get('element-summary/9999')).rejects.toThrowError(
      FPLNotFoundError,
    );
  });

  it('retries 5xx responses and eventually succeeds', async () => {
    const { scraper } = createScraper({
      fetchResults: [
        createJsonResponse(500, { error: 'boom' }),
        createJsonResponse(502, { error: 'boom' }),
        createJsonResponse(200, { events: [] }),
      ],
      maxRetries: 5,
    });

    await expect(scraper.get('bootstrap-static')).resolves.toEqual({ events: [] });
    expect(scraper.requestCount).toBe(3);
  });

  it('retries connection failures without incrementing requestCount until a response exists', async () => {
    const { scraper, sleepMock } = createScraper({
      fetchResults: [new TypeError('offline'), createJsonResponse(200, { ok: true })],
    });

    await expect(scraper.get('bootstrap-static')).resolves.toEqual({ ok: true });
    expect(scraper.requestCount).toBe(1);
    expect(sleepMock).toHaveBeenCalledOnce();
    expect(sleepMock).toHaveBeenCalledWith(50);
  });

  it('retries timeout failures without incrementing requestCount until a response exists', async () => {
    const { scraper, sleepMock } = createScraper({
      fetchResults: [new TimeoutError('slow'), createJsonResponse(200, { ok: true })],
    });

    await expect(scraper.get('bootstrap-static')).resolves.toEqual({ ok: true });
    expect(scraper.requestCount).toBe(1);
    expect(sleepMock).toHaveBeenCalledOnce();
    expect(sleepMock).toHaveBeenCalledWith(50);
  });

  it('raises FPLAPIError after exhausting retries on 5xx responses', async () => {
    const { scraper } = createScraper({
      fetchResults: Array.from({ length: 5 }, () => createJsonResponse(503, { error: 'down' })),
      maxRetries: 5,
    });

    await expect(scraper.get('bootstrap-static')).rejects.toMatchObject({
      cause: expect.any(FPLAPIError),
      message:
        'Max retries (5) exceeded for https://fantasy.premierleague.com/api/bootstrap-static/',
    });
  });

  it('re-authenticates once on 403 and retries the request', async () => {
    const auth = createAuthStub({ sessionid: 'stale' }, { sessionid: 'fresh' });
    const { scraper } = createScraper({
      auth,
      fetchResults: [createJsonResponse(403, {}), createJsonResponse(200, { picks: [] })],
    });

    await expect(scraper.get('my-team/1', { requiresAuth: true })).resolves.toEqual({
      picks: [],
    });
    expect(auth.invalidate).toHaveBeenCalledOnce();
    expect(auth.getCookies).toHaveBeenCalledTimes(2);
  });

  it('raises FPLAuthError when 403 persists after the forced re-auth attempt', async () => {
    const auth = createAuthStub({ sessionid: 'stale' }, { sessionid: 'fresh' });
    const { scraper } = createScraper({
      auth,
      fetchResults: [createJsonResponse(403, {}), createJsonResponse(403, {})],
    });

    const request = scraper.get('my-team/1', { requiresAuth: true });

    await expect(request).rejects.toThrowError(FPLAuthError);
    await expect(request).rejects.toThrow(/after re-auth attempt/);
  });

  it('honors Retry-After on 429 responses and surfaces FPLRateLimitError after the final retry', async () => {
    const { scraper, sleepMock } = createScraper({
      fetchResults: [
        createJsonResponse(429, {}, { 'Retry-After': '7' }),
        createJsonResponse(429, {}, { 'Retry-After': '7' }),
      ],
      maxRetries: 2,
    });

    await expect(scraper.get('fixtures')).rejects.toThrowError(FPLRateLimitError);
    expect(sleepMock.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([7000, 7000]);
    expect(scraper.requestCount).toBe(2);
  });

  it('normalizes outgoing URLs to keep the required trailing slash', async () => {
    const { fetchMock, scraper } = createScraper({
      fetchResults: [createJsonResponse(200, {})],
    });

    await scraper.get('/bootstrap-static');

    const [input] = getFetchCall(fetchMock);
    expect(input.toString()).toBe('https://fantasy.premierleague.com/api/bootstrap-static/');
  });

  it('injects auth cookies into authenticated requests', async () => {
    const auth = createAuthStub({ sessionid: 'cookie-123', pl_profile: 'profile-456' });
    const { fetchMock, scraper } = createScraper({
      auth,
      fetchResults: [createJsonResponse(200, { picks: [] })],
    });

    await scraper.get('my-team/1', { requiresAuth: true });

    const [, init] = getFetchCall(fetchMock);
    const headers = new Headers(init?.headers);
    expect(headers.get('Cookie')).toBe('sessionid=cookie-123; pl_profile=profile-456');
    expect(auth.getCookies).toHaveBeenCalledOnce();
  });

  it('increments requestCount for each completed response', async () => {
    const { scraper } = createScraper({
      fetchResults: [
        createJsonResponse(200, []),
        createJsonResponse(200, []),
        createJsonResponse(200, []),
      ],
    });

    await scraper.get('fixtures');
    await scraper.get('fixtures');
    await scraper.get('fixtures');

    expect(scraper.requestCount).toBe(3);
  });
});

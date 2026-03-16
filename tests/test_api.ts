import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupLogging } from '../src/logger.ts';
import { FPLAPI } from '../src/api.ts';

setupLogging('error');

afterEach(() => {
  vi.restoreAllMocks();
});

type ScraperGet = (path: string, options?: { requiresAuth?: boolean; params?: Record<string, unknown> }) => Promise<unknown>;

type ScraperStub = {
  get: ReturnType<typeof vi.fn<ScraperGet>>;
};

function createScraperStub(): ScraperStub {
  return {
    get: vi.fn<ScraperGet>(),
  };
}

describe('src/api.ts', () => {
  it('forwards public endpoint paths to the scraper', async () => {
    const scraper = createScraperStub();
    scraper.get
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ id: 7 })
      .mockResolvedValueOnce({ gw: 12 });
    const api = new FPLAPI(scraper);

    await expect(api.getBootstrapStatic()).resolves.toEqual({ ok: true });
    await expect(api.getElementSummary(7)).resolves.toEqual({ id: 7 });
    await expect(api.getEventLive(12)).resolves.toEqual({ gw: 12 });

    expect(scraper.get.mock.calls).toEqual([
      ['bootstrap-static'],
      ['element-summary/7'],
      ['event/12/live'],
    ]);
  });

  it.each([
    ['getMyTeam', [42], 'my-team/42'],
    ['getEntry', [42], 'entry/42'],
    ['getEntryEventPicks', [42, 9], 'entry/42/event/9/picks'],
  ] as const)('forwards auth-required endpoint %s', async (methodName, args, expectedPath) => {
    const scraper = createScraperStub();
    scraper.get.mockResolvedValue({ ok: true });
    const api = new FPLAPI(scraper);

    const result = await (api[methodName] as (...callArgs: number[]) => Promise<unknown>)(...args);

    expect(result).toEqual({ ok: true });
    expect(scraper.get).toHaveBeenCalledOnce();
    expect(scraper.get).toHaveBeenCalledWith(expectedPath, { requiresAuth: true });
  });

  it('forwards fixture event params and returns list responses unchanged', async () => {
    const scraper = createScraperStub();
    scraper.get.mockResolvedValue([{ id: 1 }]);
    const api = new FPLAPI(scraper);

    await expect(api.getFixtures(5)).resolves.toEqual([{ id: 1 }]);
    expect(scraper.get).toHaveBeenCalledOnce();
    expect(scraper.get).toHaveBeenCalledWith('fixtures', { params: { event: 5 } });
  });

  it('returns an empty list when fixtures responds with a non-list payload', async () => {
    const scraper = createScraperStub();
    scraper.get.mockResolvedValue({ fixtures: [] });
    const api = new FPLAPI(scraper);

    await expect(api.getFixtures()).resolves.toEqual([]);
    expect(scraper.get).toHaveBeenCalledOnce();
    expect(scraper.get).toHaveBeenCalledWith('fixtures');
  });

  it('reports discovery shapes and uses the current gameweek from a second bootstrap probe', async () => {
    const api = new FPLAPI(createScraperStub());
    const bootstrapCalls: number[] = [];
    const liveCalls: number[] = [];

    vi.spyOn(api, 'getBootstrapStatic').mockImplementation(async () => {
      bootstrapCalls.push(bootstrapCalls.length + 1);
      return { events: [{ id: 2, is_current: true }], teams: [] };
    });
    vi.spyOn(api, 'getFixtures').mockImplementation(async (gameweek?: number) => {
      expect(gameweek).toBeUndefined();
      return [{ id: 10, team_h: 1 }];
    });
    vi.spyOn(api, 'getElementSummary').mockImplementation(async (playerId: number) => {
      expect(playerId).toBe(1);
      return { fixtures: [], history: [] };
    });
    vi.spyOn(api, 'getEventLive').mockImplementation(async (gameweek: number) => {
      liveCalls.push(gameweek);
      return { elements: [] };
    });

    await expect(api.discover()).resolves.toEqual({
      'bootstrap-static': { keys: ['events', 'teams'], type: 'dict' },
      fixtures: { length: 1, sample_keys: ['id', 'team_h'], type: 'list' },
      'element-summary/1': { keys: ['fixtures', 'history'], type: 'dict' },
      'event/2/live': { keys: ['elements'], type: 'dict' },
    });
    expect(bootstrapCalls).toHaveLength(2);
    expect(liveCalls).toEqual([2]);
  });

  it('records probe failures without aborting discovery', async () => {
    const api = new FPLAPI(createScraperStub());
    let bootstrapCalls = 0;
    const liveSpy = vi.spyOn(api, 'getEventLive');

    vi.spyOn(api, 'getBootstrapStatic').mockImplementation(async () => {
      bootstrapCalls += 1;
      if (bootstrapCalls === 1) {
        return { events: [{ id: 1, is_current: true }] };
      }
      throw new Error('bootstrap refresh failed');
    });
    vi.spyOn(api, 'getFixtures').mockRejectedValue(new Error('fixtures failed'));
    vi.spyOn(api, 'getElementSummary').mockRejectedValue(new Error('summary failed'));
    liveSpy.mockResolvedValue({ elements: [] });

    await expect(api.discover()).resolves.toEqual({
      'bootstrap-static': { keys: ['events'], type: 'dict' },
      fixtures: { error: 'fixtures failed' },
      'element-summary/1': { error: 'summary failed' },
      'event/live': { error: 'bootstrap refresh failed' },
    });
    expect(liveSpy).not.toHaveBeenCalled();
  });
});

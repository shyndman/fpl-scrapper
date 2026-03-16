import { getLogger } from './logger.ts';
import { FPLScraper } from './scraper.ts';
import type { DiscoveryEntry, DiscoveryResult } from './types.ts';

const logger = getLogger('src.api');

type ScraperLike = Pick<FPLScraper, 'get'>;

type ApiPayload = unknown;
type ApiListPayload = unknown[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarizeDiscoveryValue(data: unknown): DiscoveryEntry | null {
  if (isRecord(data)) {
    return {
      keys: Object.keys(data),
      type: 'dict',
    };
  }

  if (Array.isArray(data)) {
    const firstItem = data[0];
    return {
      length: data.length,
      sample_keys: isRecord(firstItem) ? Object.keys(firstItem) : [],
      type: 'list',
    };
  }

  return null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Keep endpoint knowledge in one thin place so callers depend on stable method
 * names while transport, auth refresh, and retry behavior stay inside FPLScraper.
 */
export class FPLAPI {
  readonly #scraper: ScraperLike;

  constructor(scraper: ScraperLike) {
    this.#scraper = scraper;
  }

  async getBootstrapStatic(): Promise<ApiPayload> {
    logger.debug('Fetching bootstrap-static');
    return await this.#scraper.get('bootstrap-static');
  }

  async getElementSummary(playerId: number): Promise<ApiPayload> {
    logger.debug('Fetching element-summary for player %d', playerId);
    return await this.#scraper.get(`element-summary/${playerId}`);
  }

  async getEventLive(gameweek: number): Promise<ApiPayload> {
    logger.debug('Fetching live stats for GW%d', gameweek);
    return await this.#scraper.get(`event/${gameweek}/live`);
  }

  async getFixtures(gameweek?: number): Promise<ApiListPayload> {
    logger.debug('Fetching fixtures%s', gameweek === undefined ? '' : ` for GW${gameweek}`);
    const result =
      gameweek === undefined
        ? await this.#scraper.get('fixtures')
        : await this.#scraper.get('fixtures', { params: { event: gameweek } });
    return Array.isArray(result) ? result : [];
  }

  async getMyTeam(entryId: number): Promise<ApiPayload> {
    logger.debug('Fetching my-team for entry %d', entryId);
    return await this.#scraper.get(`my-team/${entryId}`, { requiresAuth: true });
  }

  async getEntry(entryId: number): Promise<ApiPayload> {
    logger.debug('Fetching entry %d', entryId);
    return await this.#scraper.get(`entry/${entryId}`, { requiresAuth: true });
  }

  async getEntryEventPicks(entryId: number, gameweek: number): Promise<ApiPayload> {
    logger.debug('Fetching picks for entry %d GW%d', entryId, gameweek);
    return await this.#scraper.get(`entry/${entryId}/event/${gameweek}/picks`, {
      requiresAuth: true,
    });
  }

  async discover(): Promise<DiscoveryResult> {
    const results: DiscoveryResult = {};

    const probe = async (name: string, load: () => Promise<unknown>): Promise<void> => {
      try {
        const summary = summarizeDiscoveryValue(await load());
        if (summary) {
          results[name] = summary;
        }
      } catch (error) {
        results[name] = { error: describeError(error) };
      }
    };

    await probe('bootstrap-static', async () => await this.getBootstrapStatic());
    await probe('fixtures', async () => await this.getFixtures());
    await probe('element-summary/1', async () => await this.getElementSummary(1));

    try {
      const bootstrap = await this.getBootstrapStatic();
      const currentGameweek =
        isRecord(bootstrap) && Array.isArray(bootstrap.events)
          ?
              (bootstrap.events.find(
                (event): event is Record<string, unknown> =>
                  isRecord(event) && event.is_current === true,
              )?.id as number | undefined) ?? 1
          : 1;
      await probe(`event/${currentGameweek}/live`, async () => await this.getEventLive(currentGameweek));
    } catch (error) {
      results['event/live'] = { error: describeError(error) };
    }

    return results;
  }
}

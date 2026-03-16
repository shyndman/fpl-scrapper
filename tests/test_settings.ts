import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS_ENV_KEYS = [
  'DB_PATH',
  'FPL_LOGIN',
  'FPL_PASSWORD',
  'REQUEST_DELAY_MIN',
  'REQUEST_DELAY_MAX',
  'BACKOFF_FACTOR',
  'MAX_RETRIES',
  'MAX_BACKOFF',
  'REQUEST_TIMEOUT',
  'LOG_LEVEL',
] as const;

async function importSettingsModule() {
  vi.resetModules();
  return import('../config/settings.ts');
}

function withCleanSettingsEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): void {
  for (const key of SETTINGS_ENV_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

afterEach(() => {
  withCleanSettingsEnv();
  vi.resetModules();
});

describe('config/settings.ts', () => {
  it('uses environment overrides and uppercases LOG_LEVEL', async () => {
    withCleanSettingsEnv({
      DB_PATH: '/tmp/fpl-test.db',
      FPL_LOGIN: 'user@example.com',
      FPL_PASSWORD: 'secret',
      REQUEST_DELAY_MIN: '0.25',
      REQUEST_DELAY_MAX: '0.75',
      BACKOFF_FACTOR: '1.5',
      MAX_RETRIES: '7',
      MAX_BACKOFF: '45.5',
      REQUEST_TIMEOUT: '12',
      LOG_LEVEL: 'debug',
    });

    const { settings } = await importSettingsModule();

    expect(settings).toMatchObject({
      DB_PATH: '/tmp/fpl-test.db',
      FPL_LOGIN: 'user@example.com',
      FPL_PASSWORD: 'secret',
      REQUEST_DELAY_MIN: 0.25,
      REQUEST_DELAY_MAX: 0.75,
      BACKOFF_FACTOR: 1.5,
      MAX_RETRIES: 7,
      MAX_BACKOFF: 45.5,
      REQUEST_TIMEOUT: 12,
      LOG_LEVEL: 'DEBUG',
    });
  });

  it('falls back to project-root defaults', async () => {
    withCleanSettingsEnv();

    const { settings } = await importSettingsModule();

    expect(settings.DB_PATH).toBe(resolve(PROJECT_ROOT, 'data', 'fpl.db'));
    expect(settings.LOG_FILE).toBe(resolve(PROJECT_ROOT, 'logs', 'fpl_scraper.log'));
    expect(settings.SESSION_FILE).toBe(resolve(PROJECT_ROOT, 'data', '.session.json'));
    expect(settings.REQUEST_DELAY_MIN).toBe(2.0);
    expect(settings.REQUEST_DELAY_MAX).toBe(3.0);
    expect(settings.BACKOFF_FACTOR).toBe(2.0);
    expect(settings.MAX_RETRIES).toBe(5);
    expect(settings.MAX_BACKOFF).toBe(120.0);
    expect(settings.REQUEST_TIMEOUT).toBe(30);
    expect(settings.LOG_LEVEL).toBe('INFO');
  });

  it('throws on invalid numeric values', async () => {
    const { loadSettings } = await importSettingsModule();

    expect(() => loadSettings({ ...process.env, MAX_RETRIES: '7.5' })).toThrow(
      'Invalid numeric value for MAX_RETRIES',
    );
    expect(() => loadSettings({ ...process.env, REQUEST_DELAY_MIN: '' })).toThrow(
      'Invalid numeric value for REQUEST_DELAY_MIN',
    );
  });
});

import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function resolveProjectRoot(): string {
  let currentDirectory = dirname(fileURLToPath(import.meta.url));

  while (!existsSync(resolve(currentDirectory, "package.json"))) {
    const parentDirectory = resolve(currentDirectory, "..");
    if (parentDirectory === currentDirectory) {
      throw new Error("Unable to locate project root from config/settings.ts");
    }

    currentDirectory = parentDirectory;
  }

  return currentDirectory;
}

const PROJECT_ROOT = resolveProjectRoot();

loadDotenv({ path: resolve(PROJECT_ROOT, ".env") });

/** Single source of truth for runtime configuration shared across TS modules. */
export interface Settings {
  DB_PATH: string;
  LOG_FILE: string;
  SESSION_FILE: string;
  FPL_BASE_URL: string;
  FPL_LOGIN_URL: string;
  FPL_LOGIN: string;
  FPL_PASSWORD: string;
  REQUEST_DELAY_MIN: number;
  REQUEST_DELAY_MAX: number;
  BACKOFF_FACTOR: number;
  MAX_RETRIES: number;
  MAX_BACKOFF: number;
  REQUEST_TIMEOUT: number;
  LOG_LEVEL: string;
}

const DATA_DIR = resolve(PROJECT_ROOT, "data");
const LOG_DIR = resolve(PROJECT_ROOT, "logs");

function readString(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): string {
  return env[key] ?? fallback;
}

function readFloat(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): number {
  const rawValue = env[key] ?? fallback;

  if (rawValue.trim() === "") {
    throw new Error(
      `Invalid numeric value for ${key}: ${JSON.stringify(rawValue)}`,
    );
  }

  const parsedValue = Number(rawValue);
  if (Number.isNaN(parsedValue)) {
    throw new Error(
      `Invalid numeric value for ${key}: ${JSON.stringify(rawValue)}`,
    );
  }

  return parsedValue;
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): number {
  const rawValue = env[key] ?? fallback;

  if (!/^[-+]?\d+$/.test(rawValue.trim())) {
    throw new Error(
      `Invalid numeric value for ${key}: ${JSON.stringify(rawValue)}`,
    );
  }

  return Number.parseInt(rawValue, 10);
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    DB_PATH: readString(env, "DB_PATH", resolve(DATA_DIR, "fpl.db")),
    LOG_FILE: resolve(LOG_DIR, "fpl_scraper.log"),
    SESSION_FILE: resolve(DATA_DIR, ".session.json"),
    FPL_BASE_URL: "https://fantasy.premierleague.com/api",
    FPL_LOGIN_URL: "https://users.premierleague.com/accounts/login/",
    FPL_LOGIN: readString(env, "FPL_LOGIN", ""),
    FPL_PASSWORD: readString(env, "FPL_PASSWORD", ""),
    REQUEST_DELAY_MIN: readFloat(env, "REQUEST_DELAY_MIN", "2.0"),
    REQUEST_DELAY_MAX: readFloat(env, "REQUEST_DELAY_MAX", "3.0"),
    BACKOFF_FACTOR: readFloat(env, "BACKOFF_FACTOR", "2.0"),
    MAX_RETRIES: readInt(env, "MAX_RETRIES", "5"),
    MAX_BACKOFF: readFloat(env, "MAX_BACKOFF", "120.0"),
    REQUEST_TIMEOUT: readInt(env, "REQUEST_TIMEOUT", "30"),
    LOG_LEVEL: readString(env, "LOG_LEVEL", "INFO").toUpperCase(),
  };
}

export const settings = loadSettings();

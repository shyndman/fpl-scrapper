import { pathToFileURL } from "node:url";

import type { FastifyInstance } from "fastify";

import { setupLogging } from "../src/logger.ts";
import { createApp } from "./app.ts";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8292;
export const DEFAULT_LOG_LEVEL = "INFO";

export interface LaunchOptions {
  host?: string;
  port?: number;
  logLevel?: string;
}

export const app = createApp();

/** Keep startup testable by accepting an injected server while defaulting to the module-level app. */
export async function launch(
  server: FastifyInstance = app,
  {
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
    logLevel = DEFAULT_LOG_LEVEL,
  }: LaunchOptions = {},
): Promise<string> {
  setupLogging(logLevel);
  return server.listen({ host, port });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await launch();
}

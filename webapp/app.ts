import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import fastifyView from "@fastify/view";
import Fastify, { type FastifyInstance } from "fastify";
import nunjucks, { type Environment } from "nunjucks";

import { getLogger } from "../src/logger.ts";
import * as webappDb from "./db.ts";
import { downloadImages, playerPhotoUrl, teamBadgeUrl } from "./images.ts";
import { apiRoutes } from "./routers/api.ts";
import { pageRoutes } from "./routers/pages.ts";

const logger = getLogger("webapp.app");
const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(HERE, "static");
export const _TEMPLATES_DIR = join(HERE, "templates");
export const _DEFAULT_DB = join(HERE, "..", "data", "fpl.db");

let templates: Environment | null = null;

function formatCost(tenths: number | null | undefined): string {
  return tenths == null ? "£?.?m" : `£${(tenths / 10).toFixed(1)}m`;
}

function positionName(elementType: number | null | undefined): string {
  return { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" }[elementType ?? 0] ?? "?";
}

function positionColor(elementType: number | null | undefined): string {
  return (
    {
      1: "text-yellow-400 bg-yellow-400/10",
      2: "text-green-400 bg-green-400/10",
      3: "text-sky-400 bg-sky-400/10",
      4: "text-red-400 bg-red-400/10",
    }[elementType ?? 0] ?? "text-gray-400 bg-gray-400/10"
  );
}

function statusClass(status: string | null | undefined): string {
  return (
    {
      a: "text-emerald-400",
      d: "text-yellow-400",
      i: "text-red-400",
      s: "text-gray-400",
      u: "text-gray-500",
    }[status ?? ""] ?? "text-gray-400"
  );
}

function statusLabel(status: string | null | undefined): string {
  return (
    {
      a: "Available",
      d: "Doubt",
      i: "Injured",
      s: "Suspended",
      u: "Unavailable",
    }[status ?? ""] ?? "Unknown"
  );
}

function difficultyClass(difficulty: number | null | undefined): string {
  return (
    {
      1: "bg-emerald-500 text-white",
      2: "bg-green-400 text-black",
      3: "bg-gray-400 text-black",
      4: "bg-red-400 text-white",
      5: "bg-red-700 text-white",
    }[difficulty ?? 0] ?? "bg-gray-600 text-white"
  );
}

function configureTemplateEnvironment(environment: Environment): Environment {
  environment.addFilter("format_cost", formatCost);
  environment.addFilter("position_name", positionName);
  environment.addFilter("position_color", positionColor);
  environment.addFilter("status_class", statusClass);
  environment.addFilter("status_label", statusLabel);
  environment.addFilter("difficulty_class", difficultyClass);
  environment.addGlobal("player_photo_url", playerPhotoUrl);
  environment.addGlobal("team_badge_url", teamBadgeUrl);
  return environment;
}

function createTemplateEnvironment(): Environment {
  return configureTemplateEnvironment(
    new nunjucks.Environment(new nunjucks.FileSystemLoader(_TEMPLATES_DIR), {
      autoescape: true,
      throwOnUndefined: false,
    }),
  );
}

function resolveDbPath(dbPath?: string): string {
  return dbPath ?? process.env.FPL_DB_PATH ?? _DEFAULT_DB;
}

function startImageSync(dbPath: string): void {
  void Promise.resolve(downloadImages(dbPath)).catch((error: unknown) => {
    logger.warn(
      "Image download failed: %s",
      error instanceof Error ? error.message : String(error),
    );
  });
}

export function getTemplates(): Environment {
  if (templates === null) {
    throw new Error("Templates not initialised");
  }
  return templates;
}

/** Build the Fastify dashboard shell with shared template helpers, routes, and startup wiring. */
export function createApp(dbPath?: string): FastifyInstance {
  const resolvedDbPath = resolveDbPath(dbPath);
  templates = createTemplateEnvironment();

  const app = Fastify({
    disableRequestLogging: true,
  });

  app.register(fastifyStatic, {
    root: STATIC_DIR,
    prefix: "/static/",
  });

  app.register(fastifyView, {
    engine: { nunjucks },
    root: _TEMPLATES_DIR,
    options: {
      onConfigure(environment: Environment): void {
        configureTemplateEnvironment(environment);
      },
    },
  });

  app.register(pageRoutes);
  app.register(apiRoutes, { prefix: "/api" });

  app.addHook("onReady", async () => {
    logger.info("Configuring database: %s", resolvedDbPath);
    webappDb.configure(resolvedDbPath);
    startImageSync(resolvedDbPath);
  });

  return app;
}

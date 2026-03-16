import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  configure: vi.fn<(dbPath: string) => void>(),
  downloadImages: vi.fn<(dbPath: string) => Promise<void>>(),
  playerPhotoUrl: vi.fn<(code: number | null | undefined) => string>(),
  teamBadgeUrl: vi.fn<(teamId: number | null | undefined) => string>(),
}));

vi.mock("../webapp/db.ts", () => ({
  configure: runtime.configure,
}));

vi.mock("../webapp/images.ts", () => ({
  downloadImages: runtime.downloadImages,
  playerPhotoUrl: runtime.playerPhotoUrl,
  teamBadgeUrl: runtime.teamBadgeUrl,
}));

const APPS: Array<{ close: () => Promise<unknown> }> = [];

async function importAppModule() {
  vi.resetModules();
  return import("../webapp/app.ts");
}

function normalizeTemplateForStandaloneRender(source: string): string {
  return source
    .replace(/\{%-?\s*extends\s+"base\.html"\s*-?%\}\s*/u, "")
    .replaceAll("{% block content %}", "")
    .replaceAll("{% block scripts %}", "")
    .replaceAll("{% endblock %}", "");
}

beforeEach(() => {
  runtime.configure.mockReset();
  runtime.downloadImages.mockReset();
  runtime.playerPhotoUrl.mockReset();
  runtime.teamBadgeUrl.mockReset();

  runtime.downloadImages.mockResolvedValue(undefined);
  runtime.playerPhotoUrl.mockImplementation(
    (code: number | null | undefined) => `/players/${code ?? "missing"}.png`,
  );
  runtime.teamBadgeUrl.mockImplementation(
    (teamId: number | null | undefined) => `/teams/${teamId ?? "missing"}.png`,
  );
});

afterEach(async () => {
  delete process.env.FPL_DB_PATH;
  vi.restoreAllMocks();

  while (APPS.length > 0) {
    await APPS.pop()?.close();
  }
});

describe("webapp/app.ts", () => {
  it("raises until the app factory has initialized template access", async () => {
    const appModule = await importAppModule();

    expect(() => appModule.getTemplates()).toThrow(
      /Templates not initialised/u,
    );
  });

  it("initializes template filters/globals and Fastify view/static support", async () => {
    const appModule = await importAppModule();
    const app = appModule.createApp("/tmp/explicit.db");
    APPS.push(app);

    const templateEnv = appModule.getTemplates() as unknown as {
      getFilter(name: string): (value: unknown) => unknown;
      globals: Record<string, unknown>;
    };

    expect(templateEnv.getFilter("format_cost")(130)).toBe("£13.0m");
    expect(templateEnv.getFilter("format_cost")(null)).toBe("£?.?m");
    expect(templateEnv.getFilter("position_name")(3)).toBe("MID");
    expect(templateEnv.getFilter("position_color")(4)).toBe(
      "text-red-400 bg-red-400/10",
    );
    expect(templateEnv.getFilter("status_class")("i")).toBe("text-red-400");
    expect(templateEnv.getFilter("status_label")("d")).toBe("Doubt");
    expect(templateEnv.getFilter("difficulty_class")(1)).toBe(
      "bg-emerald-500 text-white",
    );
    expect(templateEnv.globals.player_photo_url).toBe(runtime.playerPhotoUrl);
    expect(templateEnv.globals.team_badge_url).toBe(runtime.teamBadgeUrl);

    await app.ready();
    expect(app.hasReplyDecorator("view")).toBe(true);
    expect(app.hasReplyDecorator("sendFile")).toBe(true);

    const routeSummary = app.printRoutes();
    expect(routeSummary).toContain("api/");
    expect(routeSummary).toContain("overview (GET, HEAD)");
    expect(routeSummary).toContain(":fplId (GET, HEAD)");
    expect(routeSummary).toContain("compare (GET, HEAD)");
  });

  it("renders the translated team templates with the configured nunjucks environment", async () => {
    const appModule = await importAppModule();
    const app = appModule.createApp("/tmp/explicit.db");
    APPS.push(app);

    const templateEnv = appModule.getTemplates() as unknown as {
      renderString: (
        source: string,
        context: Record<string, unknown>,
      ) => string;
    };
    const renderTemplate = (
      name: string,
      context: Record<string, unknown>,
    ): string => {
      const source = readFileSync(join(appModule._TEMPLATES_DIR, name), "utf8");
      return templateEnv.renderString(
        normalizeTemplateForStandaloneRender(source),
        context,
      );
    };

    expect(
      renderTemplate("teams.html", {
        teams: [
          {
            fpl_id: 1,
            name: "Arsenal",
            short_name: "ARS",
            wins: 20,
            draws: 3,
            losses: 2,
            strength: 4,
            strength_attack_home: 1200,
            strength_attack_away: 1180,
            strength_defence_home: 1150,
            strength_defence_away: 1140,
            team_xg: 25.4,
            team_xa: 18.7,
            team_xgi: 44.1,
            team_xgp: 1.2,
            team_xap: -0.4,
            team_xgip: 0,
          },
        ],
      }),
    ).toContain("+1.2");

    const teamDetailHtml = renderTemplate("team_detail.html", {
      team: {
        fpl_id: 1,
        name: "Arsenal",
        short_name: "ARS",
        strength_overall_home: 1300,
        strength_overall_away: 1280,
        strength_attack_home: 1260,
        strength_attack_away: 1240,
        strength_defence_home: 1220,
        strength_defence_away: 1210,
      },
      fixtures: [
        {
          gameweek_fpl_id: 30,
          opponent_short: "CHE",
          is_home: true,
          my_difficulty: 2,
        },
      ],
      squad: [
        {
          fpl_id: 11,
          code: 111,
          web_name: "Raya",
          element_type: 1,
          status: "a",
          total_points: 120,
          now_cost: 55,
        },
        {
          fpl_id: 12,
          code: 112,
          web_name: "Gabriel",
          element_type: 2,
          status: "d",
          total_points: 110,
          now_cost: 63,
        },
      ],
    });
    expect(teamDetailHtml).toContain("EASY");
    expect(teamDetailHtml).toContain("status-dot");
    expect(teamDetailHtml).toContain("const team = {");

    expect(renderTemplate("compare.html", {})).toContain(
      "function compareApp()",
    );
  });

  it("keeps the CDN hooks in the base template and serves static assets from Fastify", async () => {
    const appModule = await importAppModule();
    const app = appModule.createApp("/tmp/explicit.db");
    APPS.push(app);

    const baseTemplate = readFileSync(
      join(appModule._TEMPLATES_DIR, "base.html"),
      "utf8",
    );
    expect(baseTemplate).toContain("https://cdn.tailwindcss.com");
    expect(baseTemplate).toContain(
      "https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js",
    );
    expect(baseTemplate).toContain(
      "https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js",
    );
    expect(baseTemplate).toContain("/static/css/app.css");
    expect(baseTemplate).toContain("/static/js/charts.js");

    await app.ready();

    await expect(
      app.inject({ method: "GET", url: "/static/css/app.css" }),
    ).resolves.toMatchObject({
      statusCode: 200,
    });
    await expect(
      app.inject({ method: "GET", url: "/static/js/charts.js" }),
    ).resolves.toMatchObject({
      statusCode: 200,
    });
  });

  it("prefers an explicit db path, then env, then the default path", async () => {
    const appModule = await importAppModule();

    const explicitApp = appModule.createApp("/tmp/explicit.db");
    APPS.push(explicitApp);
    await explicitApp.ready();
    expect(runtime.configure).toHaveBeenNthCalledWith(1, "/tmp/explicit.db");

    process.env.FPL_DB_PATH = "/tmp/from-env.db";
    const envApp = appModule.createApp();
    APPS.push(envApp);
    await envApp.ready();
    expect(runtime.configure).toHaveBeenNthCalledWith(2, "/tmp/from-env.db");

    delete process.env.FPL_DB_PATH;
    const defaultApp = appModule.createApp();
    APPS.push(defaultApp);
    await defaultApp.ready();
    expect(runtime.configure).toHaveBeenNthCalledWith(3, appModule._DEFAULT_DB);
  });

  it("configures the db and starts image sync without blocking startup", async () => {
    const downloadControl = Promise.withResolvers<void>();
    runtime.downloadImages.mockImplementation(
      async () => downloadControl.promise,
    );

    const appModule = await importAppModule();
    const app = appModule.createApp("/tmp/app.db");
    APPS.push(app);

    const readyOutcome = await Promise.race([
      app.ready().then(() => "ready"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);

    expect(readyOutcome).toBe("ready");
    expect(runtime.configure).toHaveBeenCalledWith("/tmp/app.db");
    expect(runtime.downloadImages).toHaveBeenCalledWith("/tmp/app.db");

    downloadControl.resolve();
    await downloadControl.promise;
  });

  it("keeps startup non-fatal when background image sync rejects", async () => {
    runtime.downloadImages.mockRejectedValue(new Error("boom"));

    const appModule = await importAppModule();
    const app = appModule.createApp("/tmp/app.db");
    APPS.push(app);

    await expect(app.ready()).resolves.toBe(app);
    expect(runtime.configure).toHaveBeenCalledWith("/tmp/app.db");
    expect(runtime.downloadImages).toHaveBeenCalledWith("/tmp/app.db");
  });
});

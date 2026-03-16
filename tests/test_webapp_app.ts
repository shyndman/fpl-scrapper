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

    expect(() => appModule.getTemplates()).toThrow(/Templates not initialised/u);
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
    runtime.downloadImages.mockImplementation(async () => downloadControl.promise);

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

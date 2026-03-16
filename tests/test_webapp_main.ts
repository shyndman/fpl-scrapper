import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FastifyInstance } from "fastify";

const runtime = vi.hoisted(() => ({
  createApp: vi.fn<() => FastifyInstance>(),
  setupLogging: vi.fn<(logLevel?: string) => unknown>(),
}));

vi.mock("../webapp/app.ts", () => ({
  createApp: runtime.createApp,
}));

vi.mock("../src/logger.ts", () => ({
  setupLogging: runtime.setupLogging,
}));

type ServerStub = FastifyInstance & {
  listen: ReturnType<
    typeof vi.fn<(options: { host: string; port: number }) => Promise<string>>
  >;
};

function createServerStub(): ServerStub {
  return {
    listen: vi.fn<(options: { host: string; port: number }) => Promise<string>>(),
  } as unknown as ServerStub;
}

async function importServerModule() {
  vi.resetModules();
  return import("../webapp/server.ts");
}

beforeEach(() => {
  runtime.createApp.mockReset();
  runtime.setupLogging.mockReset();
});

describe("webapp/server.ts", () => {
  it("creates the module-level app during import", async () => {
    const sentinelApp = createServerStub();
    runtime.createApp.mockReturnValue(sentinelApp);

    const serverModule = await importServerModule();

    expect(serverModule.app).toBe(sentinelApp);
    expect(runtime.createApp).toHaveBeenCalledTimes(1);
  });

  it("launches the app with the dashboard defaults without opening a real socket", async () => {
    const moduleLevelApp = createServerStub();
    runtime.createApp.mockReturnValue(moduleLevelApp);

    const serverModule = await importServerModule();
    const listenResult = "http://127.0.0.1:8000";
    const injectedServer = createServerStub();
    injectedServer.listen.mockResolvedValue(listenResult);

    await expect(serverModule.launch(injectedServer)).resolves.toBe(listenResult);

    expect(runtime.setupLogging).toHaveBeenCalledWith(serverModule.DEFAULT_LOG_LEVEL);
    expect(injectedServer.listen).toHaveBeenCalledWith({
      host: serverModule.DEFAULT_HOST,
      port: serverModule.DEFAULT_PORT,
    });
    expect(moduleLevelApp.listen).not.toHaveBeenCalled();
  });
});

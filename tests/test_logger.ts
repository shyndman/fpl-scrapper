import { mkdtempSync, readFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transports as winstonTransports } from "winston";

import { getLogger, setupLogging } from "../src/logger.ts";

const TEMP_DIRECTORIES: string[] = [];

function createTempPath(): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), "fpl-logger-"));
  TEMP_DIRECTORIES.push(tempDirectory);
  return tempDirectory;
}

function countTransports(logger: ReturnType<typeof setupLogging>) {
  return {
    console: logger.transports.filter(
      (transport) => transport instanceof winstonTransports.Console,
    ).length,
    file: logger.transports.filter(
      (transport) => transport instanceof winstonTransports.File,
    ).length,
  };
}

async function waitForLogLine(
  logFile: string,
  expectedText: string,
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const logOutput = readFileSync(logFile, "utf8");
      if (logOutput.includes(expectedText)) {
        return logOutput;
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for ${expectedText} in ${logFile}`);
}

afterEach(() => {
  vi.restoreAllMocks();
  setupLogging();

  for (const tempDirectory of TEMP_DIRECTORIES.splice(0)) {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

describe("src/logger.ts", () => {
  it("configures a single console transport without adding a file transport", () => {
    const logger = setupLogging("DEBUG");

    getLogger("tests.logger").debug("hello world");

    expect(logger.level).toBe("debug");
    expect(countTransports(logger)).toEqual({ console: 1, file: 0 });
  });

  it("creates the file transport parent directory and writes formatted output", async () => {
    const tempDirectory = createTempPath();
    const logFile = join(tempDirectory, "nested", "app.log");
    const logger = setupLogging("INFO", logFile);

    getLogger("tests.file").info("file message");

    expect(countTransports(logger)).toEqual({ console: 1, file: 1 });

    const logOutput = await waitForLogLine(logFile, "file message");
    expect(logOutput).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[INFO\s{4}\] tests\.file: file message\n$/,
    );
  });

  it("reinitialization replaces previous transports without duplicates", async () => {
    const tempDirectory = createTempPath();
    const firstLog = join(tempDirectory, "first.log");
    const secondLog = join(tempDirectory, "second.log");

    const firstLogger = setupLogging("INFO", firstLog);
    getLogger("tests.reinit").info("first message");
    const firstTransports = [...firstLogger.transports];

    const secondLogger = setupLogging("WARNING", secondLog);
    getLogger("tests.reinit").warn("second message");

    expect(secondLogger.level).toBe("warn");
    expect(countTransports(secondLogger)).toEqual({ console: 1, file: 1 });
    expect(secondLogger.transports).not.toEqual(firstTransports);
    expect(
      firstTransports.every(
        (transport) => !secondLogger.transports.includes(transport),
      ),
    ).toBe(true);

    const firstLogOutput = await waitForLogLine(firstLog, "first message");
    const secondLogOutput = await waitForLogLine(secondLog, "second message");

    expect(firstLogOutput).toContain("first message");
    expect(firstLogOutput).not.toContain("second message");
    expect(secondLogOutput).not.toContain("first message");
    expect(secondLogOutput).toContain("second message");
  });
});

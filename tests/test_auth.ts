import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FPLAuth } from "../src/auth.ts";
import { FPLAuthError } from "../src/errors.ts";

type StubResponse = Pick<Response, "headers" | "status">;

const TEMP_DIRECTORIES: string[] = [];

function createTempDirectory(): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), "fpl-auth-"));
  TEMP_DIRECTORIES.push(tempDirectory);
  return tempDirectory;
}

function createStubResponse(
  status: number,
  setCookies: string[] = [],
): StubResponse {
  const headers = new Headers() as Headers & { getSetCookie: () => string[] };
  headers.getSetCookie = () => setCookies;
  return { status, headers };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  for (const tempDirectory of TEMP_DIRECTORIES.splice(0)) {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
});

describe("src/auth.ts", () => {
  it("returns cached cookies when the persisted session is still valid", async () => {
    const tempDirectory = createTempDirectory();
    const sessionFile = join(tempDirectory, "session.json");
    writeFileSync(
      sessionFile,
      JSON.stringify({
        cookies: { sessionid: "cached-session", pl_profile: "cached-profile" },
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
      "utf8",
    );

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const auth = new FPLAuth(sessionFile, "user@example.com", "secret");

    await expect(auth.getCookies()).resolves.toEqual({
      sessionid: "cached-session",
      pl_profile: "cached-profile",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats expired or invalid cached sessions as a cache miss and logs in again", async () => {
    const tempDirectory = createTempDirectory();
    const expiredSessionFile = join(tempDirectory, "expired-session.json");
    writeFileSync(
      expiredSessionFile,
      JSON.stringify({
        cookies: { sessionid: "expired-session" },
        expires_at: "not-an-iso-timestamp",
      }),
      "utf8",
    );

    const invalidJsonSessionFile = join(tempDirectory, "invalid-session.json");
    writeFileSync(invalidJsonSessionFile, "{", "utf8");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createStubResponse(200, ["sessionid=fresh-expired; Path=/"]),
      )
      .mockResolvedValueOnce(
        createStubResponse(200, ["sessionid=fresh-invalid; Path=/"]),
      );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const expiredAuth = new FPLAuth(
      expiredSessionFile,
      "user@example.com",
      "secret",
    );
    const invalidJsonAuth = new FPLAuth(
      invalidJsonSessionFile,
      "user@example.com",
      "secret",
    );

    await expect(expiredAuth.getCookies()).resolves.toEqual({
      sessionid: "fresh-expired",
    });
    await expect(invalidJsonAuth.getCookies()).resolves.toEqual({
      sessionid: "fresh-invalid",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails fast when credentials are missing", async () => {
    const sessionFile = join(createTempDirectory(), "session.json");
    const auth = new FPLAuth(sessionFile, "", "secret");

    await expect(auth.getCookies()).rejects.toThrowError(FPLAuthError);
    await expect(auth.getCookies()).rejects.toThrow(
      "FPL credentials not configured. Set FPL_LOGIN and FPL_PASSWORD in your .env file.",
    );
  });

  it("wraps login request failures with FPLAuthError and preserves the cause", async () => {
    const sessionFile = join(createTempDirectory(), "session.json");
    const cause = new Error("boom");
    const fetchMock = vi.fn().mockRejectedValue(cause);
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const auth = new FPLAuth(sessionFile, "user@example.com", "secret");

    await expect(auth.getCookies()).rejects.toMatchObject({
      message: "Login request failed: boom",
      cause,
    });
  });

  it.each([
    {
      name: "rejects unsuccessful login responses",
      response: createStubResponse(401),
      message:
        "Login returned HTTP 401. Check your FPL_LOGIN and FPL_PASSWORD.",
    },
    {
      name: "rejects successful responses that do not return session cookies",
      response: createStubResponse(200),
      message:
        "Login succeeded but no session cookies were returned. FPL may have changed their auth flow.",
    },
  ])("$name", async ({ response, message }) => {
    const sessionFile = join(createTempDirectory(), "session.json");
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const auth = new FPLAuth(sessionFile, "user@example.com", "secret");

    await expect(auth.getCookies()).rejects.toThrowError(FPLAuthError);
    await expect(auth.getCookies()).rejects.toThrow(message);
  });

  it("posts the expected login request, filters cookies, and persists the session with restricted permissions", async () => {
    const tempDirectory = createTempDirectory();
    const sessionFile = join(tempDirectory, "nested", "session.json");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createStubResponse(302, [
          "sessionid=session-cookie; Path=/; HttpOnly",
          "pl_profile=profile-cookie; Path=/",
          "ignored=value; Path=/",
        ]),
      );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const auth = new FPLAuth(sessionFile, "user@example.com", "secret");
    const cookies = await auth.getCookies();

    expect(cookies).toEqual({
      sessionid: "session-cookie",
      pl_profile: "profile-cookie",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://users.premierleague.com/accounts/login/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": expect.stringContaining("Mozilla/5.0"),
        }),
        body: expect.any(URLSearchParams),
        signal: expect.any(AbortSignal),
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0] as [
      string,
      { body: URLSearchParams },
    ];
    expect(requestInit.body.toString()).toBe(
      "login=user%40example.com&password=secret&redirect_uri=https%3A%2F%2Ffantasy.premierleague.com%2F&app=plfpl-web",
    );

    const persistedSession = JSON.parse(readFileSync(sessionFile, "utf8")) as {
      cookies: Record<string, string>;
      expires_at: string;
    };
    expect(persistedSession.cookies).toEqual(cookies);
    expect(Date.parse(persistedSession.expires_at)).toBeGreaterThan(Date.now());
    expect(statSync(sessionFile).mode & 0o777).toBe(0o600);
  });

  it("invalidates the cached session file when present", async () => {
    const tempDirectory = createTempDirectory();
    const sessionFile = join(tempDirectory, "session.json");
    writeFileSync(
      sessionFile,
      JSON.stringify({
        cookies: { sessionid: "cached-session" },
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
      "utf8",
    );

    const auth = new FPLAuth(sessionFile, "user@example.com", "secret");

    await auth.invalidate();

    expect(() => readFileSync(sessionFile, "utf8")).toThrow();
    await expect(auth.invalidate()).resolves.toBeUndefined();
  });
});

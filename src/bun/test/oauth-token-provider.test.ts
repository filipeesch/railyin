/**
 * 9.5 – Unit tests for OAuthTokenProvider (lazy refresh + error handling)
 *
 * Uses a real local Bun.serve() fake OAuth server for the token/refresh
 * endpoint and a mkdtempSync temp directory for the tokens file, following
 * the providers.test.ts HTTP-wire testing pattern.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createFakeOAuthServer, type FakeOAuthServerHandle } from "./support/fake-oauth-server.ts";
import { OAuthTokenProvider } from "../oauth/token-provider.ts";
import { getServerTokens, setServerTokens } from "../oauth/token-store.ts";
import { McpAuthRequiredError } from "../oauth/errors.ts";
import type { OAuthTokenSet } from "../oauth/types.ts";

describe("9.5 OAuthTokenProvider", () => {
  let fakeServer: FakeOAuthServerHandle;
  let tempDir: string;
  let tokensFilePath: string;

  beforeEach(() => {
    fakeServer = createFakeOAuthServer();
    tempDir = mkdtempSync(join(tmpdir(), "railyn-token-provider-test-"));
    tokensFilePath = join(tempDir, "mcp-tokens.json");
  });

  afterEach(() => {
    fakeServer.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function makeTokenSet(overrides: Partial<OAuthTokenSet> = {}): OAuthTokenSet {
    return {
      access_token: "valid-access",
      refresh_token: "valid-refresh",
      // 2 minutes in the future: comfortably past the 30 s safety margin
      expires_at: Date.now() + 120_000,
      token_type: "Bearer",
      issuer: fakeServer.url,
      token_endpoint: `${fakeServer.url}/token`,
      client_id: "client-abc",
      ...overrides,
    };
  }

  function expiredTokenSet(refreshToken: string): OAuthTokenSet {
    return makeTokenSet({
      access_token: "old-access",
      refresh_token: refreshToken,
      expires_at: Date.now() - 1_000, // already in the past
    });
  }

  // ─── Valid non-expired token ───────────────────────────────────────────────

  it("passes through a valid non-expired token without making any network call", async () => {
    setServerTokens(tokensFilePath, "srv", makeTokenSet({ access_token: "my-token" }));
    const provider = new OAuthTokenProvider("srv", tokensFilePath);

    const header = await provider.getAuthHeader();

    expect(header.Authorization).toBe("Bearer my-token");
    expect(fakeServer.refreshCallCount).toBe(0); // no network call was made
  });

  it("token without an expires_at is treated as non-expired (never refreshed)", async () => {
    setServerTokens(tokensFilePath, "srv", makeTokenSet({ access_token: "eternal-token", expires_at: undefined }));
    const provider = new OAuthTokenProvider("srv", tokensFilePath);

    const header = await provider.getAuthHeader();

    expect(header.Authorization).toBe("Bearer eternal-token");
    expect(fakeServer.refreshCallCount).toBe(0);
  });

  // ─── Expired token triggers lazy refresh ──────────────────────────────────

  it("refreshes an expired token and returns the new access token", async () => {
    const oldRefreshToken = "refresh-to-use";
    fakeServer.issuedRefreshTokens.set(oldRefreshToken, "old-access");

    setServerTokens(tokensFilePath, "srv", expiredTokenSet(oldRefreshToken));
    const provider = new OAuthTokenProvider("srv", tokensFilePath);

    const header = await provider.getAuthHeader();

    expect(fakeServer.refreshCallCount).toBe(1);
    expect(header.Authorization).not.toContain("old-access");
    expect(header.Authorization).toMatch(/^Bearer access-/);
  });

  it("persists the refreshed token back to the tokens file", async () => {
    const oldRefreshToken = "my-refresh";
    fakeServer.issuedRefreshTokens.set(oldRefreshToken, "old-access");
    setServerTokens(tokensFilePath, "srv", expiredTokenSet(oldRefreshToken));

    const provider = new OAuthTokenProvider("srv", tokensFilePath);
    await provider.getAuthHeader();

    const stored = getServerTokens(tokensFilePath, "srv");
    expect(stored?.access_token).not.toBe("old-access");
    expect(stored?.access_token).toBeTruthy();
  });

  // ─── Refresh response without a new refresh_token ─────────────────────────

  it("retains the original refresh_token when the refresh response omits a new one", async () => {
    const noRotateServer = createFakeOAuthServer({
      // Override the token response so the refresh_token key is absent from JSON
      onTokenRequest: () => ({ refresh_token: undefined }),
    });

    const oldRefreshToken = "persistent-refresh";
    noRotateServer.issuedRefreshTokens.set(oldRefreshToken, "old-access");

    const noRotatePath = join(tempDir, "no-rotate-tokens.json");
    setServerTokens(noRotatePath, "srv2", {
      access_token: "old-access",
      refresh_token: oldRefreshToken,
      expires_at: Date.now() - 1_000,
      issuer: noRotateServer.url,
      token_endpoint: `${noRotateServer.url}/token`,
      client_id: "client-abc",
    });

    const provider = new OAuthTokenProvider("srv2", noRotatePath);
    await provider.getAuthHeader();

    const stored = getServerTokens(noRotatePath, "srv2");
    expect(stored?.refresh_token).toBe(oldRefreshToken);

    noRotateServer.stop();
  });

  // ─── Refresh failure ───────────────────────────────────────────────────────

  it("clears stored tokens and throws McpAuthRequiredError when the refresh token is invalid (revoked)", async () => {
    // Deliberately NOT adding the refresh token to issuedRefreshTokens
    setServerTokens(tokensFilePath, "srv", expiredTokenSet("invalid-refresh-token"));
    const provider = new OAuthTokenProvider("srv", tokensFilePath);

    await expect(provider.getAuthHeader()).rejects.toBeInstanceOf(McpAuthRequiredError);
    expect(getServerTokens(tokensFilePath, "srv")).toBeUndefined();
  });

  it("clears stored tokens and throws McpAuthRequiredError when the token endpoint returns 4xx", async () => {
    const errorServer = createFakeOAuthServer({ tokenEndpointStatus: 400 });
    const refreshToken = "some-refresh";
    errorServer.issuedRefreshTokens.set(refreshToken, "some-access");

    const errorPath = join(tempDir, "error-tokens.json");
    setServerTokens(errorPath, "srv-err", {
      access_token: "some-access",
      refresh_token: refreshToken,
      expires_at: Date.now() - 1_000,
      issuer: errorServer.url,
      token_endpoint: `${errorServer.url}/token`,
      client_id: "client-abc",
    });

    const provider = new OAuthTokenProvider("srv-err", errorPath);
    await expect(provider.getAuthHeader()).rejects.toBeInstanceOf(McpAuthRequiredError);
    expect(getServerTokens(errorPath, "srv-err")).toBeUndefined();

    errorServer.stop();
  });

  it("clears stored tokens and throws McpAuthRequiredError when expired token has no refresh_token", async () => {
    setServerTokens(tokensFilePath, "srv", makeTokenSet({
      refresh_token: undefined,
      expires_at: Date.now() - 1_000,
    }));

    const provider = new OAuthTokenProvider("srv", tokensFilePath);
    await expect(provider.getAuthHeader()).rejects.toBeInstanceOf(McpAuthRequiredError);
    expect(getServerTokens(tokensFilePath, "srv")).toBeUndefined();
  });

  // ─── No tokens at all ─────────────────────────────────────────────────────

  it("throws McpAuthRequiredError immediately when no tokens are stored for the server", async () => {
    const provider = new OAuthTokenProvider("no-tokens-server", tokensFilePath);
    await expect(provider.getAuthHeader()).rejects.toBeInstanceOf(McpAuthRequiredError);
  });
});

/**
 * 9.6 + 9.7 – McpClientRegistry state machine + authorize/completeAuthorization
 *
 * Uses an injected fake McpClient via the clientFactory seam (Decision 11) and
 * an injected BrowserOpener spy (Decision 12) so no real subprocess or
 * network transport is involved in the state machine tests.
 *
 * Tests that require discovery/token exchange run against a real local
 * Bun.serve() via the shared fake-oauth-server helper.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createFakeOAuthServer, type FakeOAuthServerHandle } from "./support/fake-oauth-server.ts";
import { FakeMcpClient } from "./support/fake-mcp-client.ts";
import { McpClientRegistry } from "../mcp/registry.ts";
import { McpOAuthChallengeError, McpAuthRequiredError } from "../oauth/errors.ts";
import { getServerTokens, getDcrClient } from "../oauth/token-store.ts";
import type { McpServerConfig } from "../mcp/types.ts";
import type { TokenProvider } from "../oauth/types.ts";

// ─── Config helpers ──────────────────────────────────────────────────────────

function httpServer(url: string, name = "test-server"): McpServerConfig {
  return { name, transport: { type: "http", url } };
}

// ─── 9.6 State machine ──────────────────────────────────────────────────────

describe("9.6 McpClientRegistry state machine", () => {
  let tempDir: string;
  let tokensFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "railyn-registry-state-test-"));
    tokensFilePath = join(tempDir, "mcp-tokens.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── Baseline transitions ─────────────────────────────────────────────────

  describe("baseline transitions (no OAuth)", () => {
    it("idle → running (happy path: initialize + listTools succeed)", async () => {
      const registry = new McpClientRegistry(
        { servers: [httpServer("http://localhost/mcp")] },
        {
          clientFactory: () =>
            new FakeMcpClient({
              tools: [{ name: "echo", description: "Echoes input", inputSchema: { type: "object" } }],
            }),
          tokensFilePath,
        },
      );

      await registry.startAll();

      const [status] = registry.getStatus();
      expect(status.state).toBe("running");
      expect(status.tools.map((t) => t.name)).toContain("echo");
    });

    it("starting → error when initialize throws a non-auth exception", async () => {
      const registry = new McpClientRegistry(
        { servers: [httpServer("http://localhost/mcp")] },
        {
          clientFactory: () => new FakeMcpClient({ initializeError: new Error("ECONNREFUSED") }),
          tokensFilePath,
        },
      );

      await registry.startAll();

      const [status] = registry.getStatus();
      expect(status.state).toBe("error");
      expect(status.error).toContain("ECONNREFUSED");
    });

    it("disabled server is never started and stays in disabled state", async () => {
      const registry = new McpClientRegistry(
        { servers: [{ ...httpServer("http://localhost/mcp"), enabled: false }] },
        { clientFactory: () => new FakeMcpClient(), tokensFilePath },
      );

      await registry.startAll();

      expect(registry.getStatus()[0].state).toBe("disabled");
    });

    it("listTools only returns tools from running servers", async () => {
      const registry = new McpClientRegistry(
        {
          servers: [
            httpServer("http://localhost/mcp-a", "server-a"),
            httpServer("http://localhost/mcp-b", "server-b"),
          ],
        },
        {
          clientFactory: (config) => {
            if (config.name === "server-a") {
              return new FakeMcpClient({
                tools: [{ name: "tool-a", inputSchema: { type: "object" } }],
              });
            }
            // server-b fails
            return new FakeMcpClient({ initializeError: new Error("fail") });
          },
          tokensFilePath,
        },
      );

      await registry.startAll();
      const tools = registry.listTools();
      expect(tools.map((t) => t.name)).toContain("tool-a");
      expect(tools.map((t) => t.serverName)).not.toContain("server-b");
    });
  });

  // ─── auth_required transitions ────────────────────────────────────────────

  describe("auth_required transitions", () => {
    let fakeServer: FakeOAuthServerHandle;

    beforeEach(() => {
      fakeServer = createFakeOAuthServer();
    });

    afterEach(() => {
      fakeServer.stop();
    });

    it("McpOAuthChallengeError during initialize → auth_required + discovery populates authContext (DCR happens)", async () => {
      const wwwAuth = `Bearer resource_metadata="${fakeServer.url}/.well-known/oauth-protected-resource"`;
      const registry = new McpClientRegistry(
        { servers: [httpServer(`${fakeServer.url}/mcp`)] },
        {
          clientFactory: () => new FakeMcpClient({ initializeError: new McpOAuthChallengeError(wwwAuth) }),
          tokensFilePath,
          getRedirectUri: () => "http://localhost:9999/callback",
        },
      );

      await registry.startAll();

      const [status] = registry.getStatus();
      expect(status.state).toBe("auth_required");
      expect(status.error).toBeUndefined();
      expect(fakeServer.dcrCallCount).toBe(1);
    });

    it("callTool McpAuthRequiredError → server transitions to auth_required AND original error propagates to caller", async () => {
      const wwwAuth = `Bearer resource_metadata="${fakeServer.url}/.well-known/oauth-protected-resource"`;
      let factoryCallCount = 0;

      const registry = new McpClientRegistry(
        { servers: [httpServer(`${fakeServer.url}/mcp`)] },
        {
          clientFactory: (_config: McpServerConfig, _tp?: TokenProvider) => {
            factoryCallCount++;
            if (factoryCallCount === 1) {
              // First call: succeeds so the server reaches running state
              return new FakeMcpClient({
                callToolError: new McpAuthRequiredError("test-server"),
              });
            }
            // Second call: probe during _enterAuthRequired — return a challenge client
            return new FakeMcpClient({ initializeError: new McpOAuthChallengeError(wwwAuth) });
          },
          tokensFilePath,
          getRedirectUri: () => "http://localhost:9999/callback",
        },
      );

      await registry.startAll();
      expect(registry.getStatus()[0].state).toBe("running");

      // callTool throws McpAuthRequiredError; the registry awaits _enterAuthRequired before re-throwing
      await expect(registry.callTool("test-server", "echo", {})).rejects.toBeInstanceOf(McpAuthRequiredError);

      expect(registry.getStatus()[0].state).toBe("auth_required");
    });

    it("reload() on a server in auth_required re-runs discovery without crashing", async () => {
      const wwwAuth = `Bearer resource_metadata="${fakeServer.url}/.well-known/oauth-protected-resource"`;
      const registry = new McpClientRegistry(
        { servers: [httpServer(`${fakeServer.url}/mcp`)] },
        {
          clientFactory: () => new FakeMcpClient({ initializeError: new McpOAuthChallengeError(wwwAuth) }),
          tokensFilePath,
          getRedirectUri: () => "http://localhost:9999/callback",
        },
      );

      await registry.startAll();
      expect(registry.getStatus()[0].state).toBe("auth_required");
      const dcrAfterFirst = fakeServer.dcrCallCount; // should be 1

      // reload() → _stopServer (clears authContext) → _startServer → discovery again
      await registry.reload("test-server");

      expect(registry.getStatus()[0].state).toBe("auth_required");
      // DCR should be reused from the cache written during the first discovery
      expect(fakeServer.dcrCallCount).toBe(dcrAfterFirst);
    });

    // Regression test for a real-world failure: a cached DCR client registered
    // under an old redirect_uri (e.g. before an app port change, or a
    // redirect_uri hostname fix) must not be silently reused — the
    // authorization server would reject /authorize with a redirect_uri
    // mismatch. The registry should detect the staleness and re-register.
    it("re-registers DCR when the cached client's redirect_uri no longer matches the current one", async () => {
      const wwwAuth = `Bearer resource_metadata="${fakeServer.url}/.well-known/oauth-protected-resource"`;
      let currentRedirectUri = "http://localhost:9999/callback-old-port";

      const registry = new McpClientRegistry(
        { servers: [httpServer(`${fakeServer.url}/mcp`)] },
        {
          clientFactory: () => new FakeMcpClient({ initializeError: new McpOAuthChallengeError(wwwAuth) }),
          tokensFilePath,
          getRedirectUri: () => currentRedirectUri,
        },
      );

      await registry.startAll();
      expect(registry.getStatus()[0].state).toBe("auth_required");
      expect(fakeServer.dcrCallCount).toBe(1);

      // Simulate the app's redirect_uri changing (e.g. a different bound port
      // across a restart) before the next discovery attempt.
      currentRedirectUri = "http://localhost:9999/callback-new-port";

      await registry.reload("test-server");

      expect(registry.getStatus()[0].state).toBe("auth_required");
      // The stale cached client must be discarded and a fresh registration
      // performed against the new redirect_uri, not silently reused.
      expect(fakeServer.dcrCallCount).toBe(2);
    });

    // Regression tests for a real-world failure: Keycloak (and similar
    // authorization servers configured to require an Initial Access Token)
    // reject anonymous DCR with 403. A static `auth.client_id` config
    // override lets the registry skip DCR entirely for that server.
    it("uses a statically-configured client_id and never attempts DCR", async () => {
      const wwwAuth = `Bearer resource_metadata="${fakeServer.url}/.well-known/oauth-protected-resource"`;
      const config: McpServerConfig = {
        name: "test-server",
        transport: { type: "http", url: `${fakeServer.url}/mcp`, auth: { client_id: "preregistered-client" } },
      };
      const registry = new McpClientRegistry(
        { servers: [config] },
        {
          clientFactory: () => new FakeMcpClient({ initializeError: new McpOAuthChallengeError(wwwAuth) }),
          tokensFilePath,
          getRedirectUri: () => "http://localhost:9999/callback",
        },
      );

      await registry.startAll();

      expect(registry.getStatus()[0].state).toBe("auth_required");
      expect(fakeServer.dcrCallCount).toBe(0);
      expect(getDcrClient(tokensFilePath, fakeServer.url)).toBeUndefined();
    });

    it("statically-configured client_id succeeds even when the authorization server's DCR endpoint rejects registration (403)", async () => {
      fakeServer.stop();
      fakeServer = createFakeOAuthServer({ dcrStatus: 403 });
      const wwwAuth = `Bearer resource_metadata="${fakeServer.url}/.well-known/oauth-protected-resource"`;
      const config: McpServerConfig = {
        name: "test-server",
        transport: {
          type: "http",
          url: `${fakeServer.url}/mcp`,
          auth: { client_id: "preregistered-client", client_secret: "preregistered-secret" },
        },
      };
      const registry = new McpClientRegistry(
        { servers: [config] },
        {
          clientFactory: () => new FakeMcpClient({ initializeError: new McpOAuthChallengeError(wwwAuth) }),
          tokensFilePath,
          getRedirectUri: () => "http://localhost:9999/callback",
        },
      );

      await registry.startAll();

      // Discovery succeeds (no OAuthDiscoveryError from a rejected DCR call)
      // because DCR is never attempted for a statically-configured server.
      expect(registry.getStatus()[0].state).toBe("auth_required");
      expect(registry.getStatus()[0].error).toBeUndefined();
      expect(fakeServer.dcrCallCount).toBe(0);
    });
  });
});

// ─── 9.7 authorize() / completeAuthorization() ─────────────────────────────

describe("9.7 McpClientRegistry.authorize() / completeAuthorization()", () => {
  let fakeServer: FakeOAuthServerHandle;
  let tempDir: string;
  let tokensFilePath: string;

  beforeEach(() => {
    fakeServer = createFakeOAuthServer();
    tempDir = mkdtempSync(join(tmpdir(), "railyn-registry-auth-test-"));
    tokensFilePath = join(tempDir, "mcp-tokens.json");
  });

  afterEach(() => {
    fakeServer.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeWwwAuth() {
    return `Bearer resource_metadata="${fakeServer.url}/.well-known/oauth-protected-resource"`;
  }

  /** Starts a registry whose single server immediately needs OAuth, with an injected browser spy. */
  async function setupAuthRequired(openSpy: ReturnType<typeof vi.fn>, serverName = "test-server") {
    const wwwAuth = makeWwwAuth();
    let factoryCallCount = 0;
    const registry = new McpClientRegistry(
      { servers: [httpServer(`${fakeServer.url}/mcp`, serverName)] },
      {
        clientFactory: (_config: McpServerConfig, _tp?: TokenProvider) => {
          factoryCallCount++;
          if (factoryCallCount <= 1) {
            return new FakeMcpClient({ initializeError: new McpOAuthChallengeError(wwwAuth) });
          }
          // subsequent calls (after completeAuthorization) succeed
          return new FakeMcpClient({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });
        },
        tokensFilePath,
        getRedirectUri: () => "http://localhost:9999/callback",
        browserOpener: { open: openSpy },
      },
    );
    await registry.startAll();
    expect(registry.getStatus()[0].state).toBe("auth_required");
    return { registry, factoryCallCount: () => factoryCallCount };
  }

  it("authorize() uses the statically-configured client_id verbatim, bypassing DCR", async () => {
    const wwwAuth = makeWwwAuth();
    const openSpy = vi.fn().mockResolvedValue(undefined);
    const config: McpServerConfig = {
      name: "test-server",
      transport: { type: "http", url: `${fakeServer.url}/mcp`, auth: { client_id: "preregistered-client" } },
    };
    const registry = new McpClientRegistry(
      { servers: [config] },
      {
        clientFactory: () => new FakeMcpClient({ initializeError: new McpOAuthChallengeError(wwwAuth) }),
        tokensFilePath,
        getRedirectUri: () => "http://localhost:9999/callback",
        browserOpener: { open: openSpy },
      },
    );
    await registry.startAll();
    expect(registry.getStatus()[0].state).toBe("auth_required");
    expect(fakeServer.dcrCallCount).toBe(0);

    await registry.authorize("test-server");

    expect(openSpy).toHaveBeenCalledOnce();
    const capturedUrl = new URL(openSpy.mock.calls[0][0] as string);
    expect(capturedUrl.searchParams.get("client_id")).toBe("preregistered-client");
    expect(fakeServer.dcrCallCount).toBe(0);
  });

  it("authorize() opens the browser with correct OAuth 2.1 PKCE parameters", async () => {
    const openSpy = vi.fn().mockResolvedValue(undefined);
    const { registry } = await setupAuthRequired(openSpy);

    await registry.authorize("test-server");

    expect(openSpy).toHaveBeenCalledOnce();
    const capturedUrl = new URL(openSpy.mock.calls[0][0] as string);

    expect(capturedUrl.searchParams.get("response_type")).toBe("code");
    expect(capturedUrl.searchParams.get("client_id")).toBeTruthy();
    expect(capturedUrl.searchParams.get("redirect_uri")).toBe("http://localhost:9999/callback");
    expect(capturedUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(capturedUrl.searchParams.get("state")).toBeTruthy();
    // challenge must be base64url-safe
    const challenge = capturedUrl.searchParams.get("code_challenge")!;
    expect(challenge).toBeTruthy();
    expect(/^[A-Za-z0-9_-]+$/.test(challenge)).toBe(true);
  });

  it("authorize() requests the scope advertised by the resource's Protected Resource Metadata", async () => {
    // Regression test for the real-world Atlassian failure: the resource
    // advertises `scopes_supported` on its RFC9728 metadata, but we never
    // forwarded it as the `scope` param on /authorize — resulting in a token
    // missing the scopes the resource actually requires ("scope does not
    // match" on the first authenticated call).
    fakeServer.stop();
    fakeServer = createFakeOAuthServer({ resourceScopesSupported: ["read:jira-work", "write:jira-work"] });

    const openSpy = vi.fn().mockResolvedValue(undefined);
    const { registry } = await setupAuthRequired(openSpy);

    await registry.authorize("test-server");

    const capturedUrl = new URL(openSpy.mock.calls[0][0] as string);
    expect(capturedUrl.searchParams.get("scope")).toBe("read:jira-work write:jira-work");
  });

  it("authorize() omits the scope param when no source advertises any scope", async () => {
    const openSpy = vi.fn().mockResolvedValue(undefined);
    const { registry } = await setupAuthRequired(openSpy);

    await registry.authorize("test-server");

    const capturedUrl = new URL(openSpy.mock.calls[0][0] as string);
    expect(capturedUrl.searchParams.has("scope")).toBe(false);
  });

  it("authorize() is a no-op when the server is not in auth_required state", async () => {
    const openSpy = vi.fn().mockResolvedValue(undefined);
    const registry = new McpClientRegistry(
      { servers: [httpServer("http://localhost/mcp")] },
      {
        clientFactory: () => new FakeMcpClient(),
        tokensFilePath,
        getRedirectUri: () => "http://localhost:9999/callback",
        browserOpener: { open: openSpy },
      },
    );
    await registry.startAll();
    expect(registry.getStatus()[0].state).toBe("running");

    await registry.authorize("test-server");

    expect(openSpy).not.toHaveBeenCalled();
  });

  it("repeated authorize() calls for the same server invalidate the prior pending entry", async () => {
    const openSpy = vi.fn().mockResolvedValue(undefined);
    const { registry } = await setupAuthRequired(openSpy);

    await registry.authorize("test-server");
    const firstCapturedUrl = new URL(openSpy.mock.calls[0][0] as string);
    const firstState = firstCapturedUrl.searchParams.get("state")!;

    // Second authorize() call — should invalidate the first pending flow
    await registry.authorize("test-server");
    expect(openSpy).toHaveBeenCalledTimes(2);

    // Trying to complete with the first (now-stale) state must fail
    await expect(registry.completeAuthorization(firstState, "any-code")).rejects.toThrow(
      "Unknown or expired OAuth authorization state",
    );
  });

  it("completeAuthorization() exchanges code for tokens, persists them, and transitions to running", async () => {
    const openSpy = vi.fn().mockResolvedValue(undefined);
    let factoryCallCount = 0;
    const registry = new McpClientRegistry(
      { servers: [httpServer(`${fakeServer.url}/mcp`)] },
      {
        clientFactory: (_config: McpServerConfig, _tp?: TokenProvider) => {
          factoryCallCount++;
          if (factoryCallCount === 1) {
            return new FakeMcpClient({ initializeError: new McpOAuthChallengeError(makeWwwAuth()) });
          }
          return new FakeMcpClient({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });
        },
        tokensFilePath,
        getRedirectUri: () => "http://localhost:9999/callback",
        browserOpener: { open: openSpy },
      },
    );

    await registry.startAll();
    expect(registry.getStatus()[0].state).toBe("auth_required");

    await registry.authorize("test-server");
    const capturedAuthUrl = openSpy.mock.calls[0][0] as string;
    const state = new URL(capturedAuthUrl).searchParams.get("state")!;

    // Simulate the browser visiting the authorization URL — fake server issues a code
    // and redirects to redirect_uri.  We follow the redirect ourselves with redirect:manual
    // to extract the code from the Location header without needing the callback server.
    const authResp = await fetch(capturedAuthUrl, { redirect: "manual" });
    const location = authResp.headers.get("Location")!;
    const code = new URL(location).searchParams.get("code")!;
    expect(code).toBeTruthy();

    await registry.completeAuthorization(state, code);

    expect(registry.getStatus()[0].state).toBe("running");
    const stored = getServerTokens(tokensFilePath, "test-server");
    expect(stored?.access_token).toBeTruthy();
    expect(stored?.issuer).toBe(fakeServer.url);
  });

  it("completeAuthorization() with an unknown/expired state throws and does not persist tokens", async () => {
    const openSpy = vi.fn().mockResolvedValue(undefined);
    const { registry } = await setupAuthRequired(openSpy);

    await expect(registry.completeAuthorization("stale-state", "some-code")).rejects.toThrow(
      "Unknown or expired OAuth authorization state",
    );
    expect(getServerTokens(tokensFilePath, "test-server")).toBeUndefined();
  });

  it("concurrent authorize() calls for two different servers do not collide in PendingAuthFlowStore", async () => {
    // Two fake servers to give each registry server its own OAuth issuer
    const fakeServer2 = createFakeOAuthServer();
    const tempDir2 = mkdtempSync(join(tmpdir(), "railyn-registry-auth2-"));
    const tokensFilePath2 = join(tempDir2, "mcp-tokens.json");

    try {
      const openSpy = vi.fn().mockResolvedValue(undefined);
      const wwwAuth1 = `Bearer resource_metadata="${fakeServer.url}/.well-known/oauth-protected-resource"`;
      const wwwAuth2 = `Bearer resource_metadata="${fakeServer2.url}/.well-known/oauth-protected-resource"`;

      const registry = new McpClientRegistry(
        {
          servers: [
            httpServer(`${fakeServer.url}/mcp`, "srv-1"),
            httpServer(`${fakeServer2.url}/mcp`, "srv-2"),
          ],
        },
        {
          clientFactory: (config: McpServerConfig) => {
            const auth = config.name === "srv-1" ? wwwAuth1 : wwwAuth2;
            return new FakeMcpClient({ initializeError: new McpOAuthChallengeError(auth) });
          },
          tokensFilePath: tokensFilePath2, // shared tokens file (distinct issuers → distinct DCR entries)
          getRedirectUri: () => "http://localhost:9999/callback",
          browserOpener: { open: openSpy },
        },
      );

      await registry.startAll();
      expect(registry.getStatus()[0].state).toBe("auth_required");
      expect(registry.getStatus()[1].state).toBe("auth_required");

      await registry.authorize("srv-1");
      await registry.authorize("srv-2");

      // Both calls opened the browser with distinct states
      expect(openSpy).toHaveBeenCalledTimes(2);
      const state1 = new URL(openSpy.mock.calls[0][0] as string).searchParams.get("state")!;
      const state2 = new URL(openSpy.mock.calls[1][0] as string).searchParams.get("state")!;
      expect(state1).not.toBe(state2);
    } finally {
      fakeServer2.stop();
      rmSync(tempDir2, { recursive: true, force: true });
    }
  });
});

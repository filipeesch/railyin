/**
 * mcp-oauth.test.ts — Integration tests for MCP OAuth 2.1 support.
 *
 * Spawns a REAL Bun subprocess (via `startServer({ mcpConfig })`) and a real
 * `FakeOAuthServer` (local HTTP server in this test process) so every HTTP
 * round-trip — discovery, DCR, the `/api/mcp/oauth/callback` route — travels
 * over real sockets with no mocking framework.
 *
 * ## Coverage (tasks 10.1–10.6)
 *
 * | Task | Status  | Notes |
 * |------|---------|-------|
 * | 10.1 | ✅      | server.ts fixture extended; mcpConfig + dataDir |
 * | 10.2 | ✅      | Boot with OAuth-protected MCP → auth_required |
 * | 10.3 | ⛔ BLOCKED | See note below |
 * | 10.4 | ✅      | Bad-callback edge cases (no browser required) |
 * | 10.5 | ✅ partial | DCR reuse assertion via mcp-tokens.json; token isolation assertion requires 10.3 |
 * | 10.6 | ⛔ BLOCKED | Requires running state from 10.3 |
 *
 * ## Why 10.3 and 10.6 are blocked
 *
 * `mcp.authorize` uses the real `open` npm package to open a system browser
 * (`open <url>` on macOS).  There is no env-var or config-file seam in the
 * production code to suppress this — the DI seam (`BrowserOpener` injectable)
 * only works for in-process unit tests, not for a subprocess.
 *
 * Calling `mcp.authorize` against a real subprocess on a developer's macOS
 * machine would open a real browser window (potentially dozens of times in a
 * test run), which is disruptive and unreliable in CI / headless environments.
 *
 * Additionally, the PKCE `state` / `code_verifier` generated internally by the
 * subprocess are not exposed through any RPC, so we cannot construct a valid
 * callback request without having first driven the authorize flow through a
 * real browser.
 *
 * **Recommended fix (for a follow-up change)**: add an env-var seam in
 * `src/bun/mcp/registry-pool.ts` (e.g. `RAILYN_TEST_NO_BROWSER=1`) that
 * replaces the default `BrowserOpener` with a no-op AND additionally exposes
 * the generated authorization URL (e.g. via a temporary in-memory slot or a
 * debug HTTP endpoint) so integration tests can extract `state` and complete
 * the callback without spawning a real browser.  This keeps production code
 * clean (single env-var guard in the composition root only) while unblocking
 * the full happy-path integration test.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, type TestServer } from "./fixtures/server";
import {
    createFakeOAuthServer,
    type FakeOAuthServerHandle,
} from "../../src/bun/test/support/fake-oauth-server";
import type { McpTokensFile } from "../../src/bun/oauth/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Poll `load()` until `predicate` returns true or the timeout elapses. */
async function waitFor<T>(
    load: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeoutMs = 15_000,
    intervalMs = 150,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last = await load();
    while (!predicate(last)) {
        if (Date.now() >= deadline) {
            throw new Error(`waitFor timed out. Last value: ${JSON.stringify(last)}`);
        }
        await new Promise((r) => setTimeout(r, intervalMs));
        last = await load();
    }
    return last;
}

/** Read `mcp-tokens.json` from a data dir. Returns null when the file is absent. */
function readTokensFile(dataDir: string): McpTokensFile | null {
    const path = join(dataDir, "mcp-tokens.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as McpTokensFile;
}

// ─── Shared state per test ────────────────────────────────────────────────────

let fake: FakeOAuthServerHandle | undefined;
let server: TestServer | undefined;

afterEach(async () => {
    // Always clean up even if the test threw.
    if (server) {
        await server.shutdown().catch(() => {});
        server = undefined;
    }
    if (fake) {
        fake.stop();
        fake = undefined;
    }
});

// ─── Task 10.2: auth_required on boot ─────────────────────────────────────────

describe("10.2 — HTTP MCP server boots to auth_required", () => {
    test("server transitions to auth_required when the MCP endpoint responds 401", async () => {
        fake = createFakeOAuthServer();

        server = await startServer({
            mcpConfig: {
                servers: [
                    {
                        name: "oauth-mcp",
                        transport: { type: "http", url: `${fake.url}/mcp` },
                    },
                ],
            },
        });

        // The registry calls startAll() fire-and-forget at boot; poll until settled.
        const statuses = await waitFor(
            () => server!.request("mcp.getStatus", {}),
            (s) => s.some((sv) => sv.state !== "idle" && sv.state !== "starting"),
        );

        const mcp = statuses.find((s) => s.name === "oauth-mcp");
        expect(mcp).toBeDefined();
        expect(mcp!.state).toBe("auth_required");

        // Discovery + DCR happened: fake server should have received one DCR call.
        expect(fake.dcrCallCount).toBeGreaterThanOrEqual(1);

        // Token store must have a DCR client entry (no access-token entry yet).
        const tokens = readTokensFile(server.dataDir);
        expect(tokens).not.toBeNull();
        expect(Object.keys(tokens!.dcrClients)).toHaveLength(1);
        expect(Object.keys(tokens!.tokens)).toHaveLength(0);
    }, 30_000);

    test("disabled MCP server stays in disabled state (not auth_required)", async () => {
        fake = createFakeOAuthServer();

        server = await startServer({
            mcpConfig: {
                servers: [
                    {
                        name: "oauth-mcp",
                        enabled: false,
                        transport: { type: "http", url: `${fake.url}/mcp` },
                    },
                ],
            },
        });

        // Give a small window for any unexpected state changes.
        await new Promise((r) => setTimeout(r, 500));

        const statuses = await server.request("mcp.getStatus", {});
        const mcp = statuses.find((s) => s.name === "oauth-mcp");
        expect(mcp).toBeDefined();
        expect(mcp!.state).toBe("disabled");

        // No network calls to the fake server should have been made.
        expect(fake.dcrCallCount).toBe(0);
    }, 20_000);
});

// ─── Task 10.4: callback edge cases ───────────────────────────────────────────

describe("10.4 — /api/mcp/oauth/callback edge cases", () => {
    beforeEach(async () => {
        fake = createFakeOAuthServer();
        server = await startServer({
            mcpConfig: {
                servers: [
                    {
                        name: "oauth-mcp",
                        transport: { type: "http", url: `${fake.url}/mcp` },
                    },
                ],
            },
        });

        // Wait for auth_required before testing callback edge cases.
        await waitFor(
            () => server!.request("mcp.getStatus", {}),
            (s) => s.some((sv) => sv.state !== "idle" && sv.state !== "starting"),
        );
    }, 30_000);

    async function assertServerStillAuthRequired() {
        const statuses = await server!.request("mcp.getStatus", {});
        const mcp = statuses.find((s) => s.name === "oauth-mcp");
        expect(mcp!.state).toBe("auth_required");
    }

    test("missing state param — returns error HTML, server stays auth_required", async () => {
        const res = await fetch(`${server!.baseUrl}/api/mcp/oauth/callback?code=any-code`);
        expect(res.ok).toBe(true);
        const html = await res.text();
        expect(html).toContain("Missing state");
        await assertServerStillAuthRequired();
    });

    test("error=access_denied param — returns error HTML, server stays auth_required", async () => {
        const res = await fetch(
            `${server!.baseUrl}/api/mcp/oauth/callback?state=some-state&error=access_denied`,
        );
        expect(res.ok).toBe(true);
        const html = await res.text();
        expect(html).toContain("access_denied");
        await assertServerStillAuthRequired();
    });

    test("missing code param — returns error HTML, server stays auth_required", async () => {
        const res = await fetch(
            `${server!.baseUrl}/api/mcp/oauth/callback?state=some-state`,
        );
        expect(res.ok).toBe(true);
        const html = await res.text();
        expect(html).toContain("Missing authorization code");
        await assertServerStillAuthRequired();
    });

    test("unknown/mismatched state — returns error HTML, server stays auth_required", async () => {
        const res = await fetch(
            `${server!.baseUrl}/api/mcp/oauth/callback?state=completely-unknown-state-xyz&code=any-code`,
        );
        expect(res.ok).toBe(true);
        const html = await res.text();
        // completeAuthorization throws "Unknown or expired OAuth authorization state"
        expect(html.toLowerCase()).toContain("unknown or expired");
        await assertServerStillAuthRequired();
    });

    test("bad callbacks do not persist any tokens to mcp-tokens.json", async () => {
        const callbackBase = `${server!.baseUrl}/api/mcp/oauth/callback`;
        await fetch(`${callbackBase}?code=any-code`);
        await fetch(`${callbackBase}?state=s&error=access_denied`);
        await fetch(`${callbackBase}?state=s`);
        await fetch(`${callbackBase}?state=bad-state-xyz&code=any-code`);

        const tokens = readTokensFile(server!.dataDir);
        // File may contain DCR entries but must have NO token entries.
        if (tokens) {
            expect(Object.keys(tokens.tokens)).toHaveLength(0);
        }
    });
});

// ─── Task 10.5: DCR reuse across two servers sharing the same issuer ──────────

describe("10.5 — DCR reuse and per-server token isolation (boot-phase)", () => {
    test("two servers with the same issuer share one DCR client entry in mcp-tokens.json", async () => {
        fake = createFakeOAuthServer();

        server = await startServer({
            mcpConfig: {
                servers: [
                    {
                        name: "server-alpha",
                        transport: { type: "http", url: `${fake.url}/mcp` },
                    },
                    {
                        name: "server-beta",
                        transport: { type: "http", url: `${fake.url}/mcp` },
                    },
                ],
            },
        });

        // Wait until both servers are no longer idle/starting.
        await waitFor(
            () => server!.request("mcp.getStatus", {}),
            (s) => {
                const alpha = s.find((sv) => sv.name === "server-alpha");
                const beta = s.find((sv) => sv.name === "server-beta");
                return (
                    alpha !== undefined &&
                    beta !== undefined &&
                    alpha.state !== "idle" &&
                    alpha.state !== "starting" &&
                    beta.state !== "idle" &&
                    beta.state !== "starting"
                );
            },
        );

        const statuses = await server.request("mcp.getStatus", {});
        const alpha = statuses.find((s) => s.name === "server-alpha");
        const beta = statuses.find((s) => s.name === "server-beta");
        expect(alpha!.state).toBe("auth_required");
        expect(beta!.state).toBe("auth_required");

        // Regardless of whether a concurrent DCR race occurred (dcrCallCount may
        // be 1 or 2 since both servers discover concurrently), the persisted
        // token store must contain exactly ONE DCR client entry for the shared
        // issuer — last-write-wins semantics in setDcrClient() guarantee this.
        const tokens = readTokensFile(server.dataDir);
        expect(tokens).not.toBeNull();
        expect(Object.keys(tokens!.dcrClients)).toHaveLength(1);

        // No access/refresh tokens should exist yet (no authorization completed).
        expect(Object.keys(tokens!.tokens)).toHaveLength(0);

        // The single DCR entry covers the shared issuer URL.
        const issuerUrl = fake.url;
        expect(tokens!.dcrClients[issuerUrl]).toBeDefined();
        expect(typeof tokens!.dcrClients[issuerUrl].client_id).toBe("string");
    }, 30_000);

    test("mcp.reload on auth_required server re-runs discovery from scratch", async () => {
        fake = createFakeOAuthServer();

        server = await startServer({
            mcpConfig: {
                servers: [
                    {
                        name: "oauth-mcp",
                        transport: { type: "http", url: `${fake.url}/mcp` },
                    },
                ],
            },
        });

        // Wait for initial auth_required.
        await waitFor(
            () => server!.request("mcp.getStatus", {}),
            (s) => s.some((sv) => sv.state !== "idle" && sv.state !== "starting"),
        );

        const before = fake.dcrCallCount;

        // Reload triggers a fresh start: discovery + DCR should run again (the
        // existing DCR entry in mcp-tokens.json prevents a new registration, so
        // dcrCallCount stays the same — it reuses the cached client).
        const reloadedStatuses = await server.request("mcp.reload", { serverName: "oauth-mcp" });
        // After reload the server settles back to auth_required (or is still
        // transitioning — wait a moment for it to settle).
        await waitFor(
            () => server!.request("mcp.getStatus", {}),
            (s) => s.some((sv) => sv.state !== "idle" && sv.state !== "starting"),
        );

        const after = await server.request("mcp.getStatus", {});
        const mcp = after.find((s) => s.name === "oauth-mcp");
        expect(mcp!.state).toBe("auth_required");

        // DCR is NOT re-called because the cached client_id is reused.
        expect(fake.dcrCallCount).toBe(before);
    }, 30_000);
});

## Context

`McpClientRegistry` (`src/bun/mcp/registry.ts`) manages server lifecycle (`idle → starting → running | error`, plus `disabled`) for both stdio and HTTP MCP servers. `HttpMcpClient` (`src/bun/mcp/client.ts`) is a thin JSON-RPC-over-HTTP transport that currently only supports static `headers` from config — there is no way to obtain, store, or refresh an OAuth token, and no way to redirect a user through a browser-based authorization flow.

The MCP Authorization spec (2025-06-18) requires HTTP-transport MCP servers that need auth to respond `401` with a `WWW-Authenticate` header pointing at OAuth 2.0 Protected Resource Metadata (RFC9728), which in turn points at an Authorization Server implementing OAuth 2.0 Authorization Server Metadata (RFC8414) and, ideally, Dynamic Client Registration (RFC7591). The actual authorization flow is standard OAuth 2.1 Authorization Code + PKCE.

The app runs as a single local Bun HTTP server bound to `127.0.0.1:<port>` (no Electron/Tauri shell), so the OAuth redirect URI must be served from that same server. This constrains the design to a localhost-only deployment model, which matches how the app runs today.

All decisions below were confirmed via a dedicated decision-gathering session prior to this design (13 decisions locked), plus a follow-up testability exploration session (4 additional decisions locked) covering unit, integration, and Playwright coverage — see conversation history / decision records.

## Goals / Non-Goals

**Goals:**
- Let a user authorize an OAuth 2.1-protected HTTP MCP server by clicking "Sign in" and completing a browser-based flow, with zero new fields required in `mcp.json`.
- Keep `HttpMcpClient` a dumb transport with no OAuth-specific logic (Single Responsibility / Dependency Inversion).
- Keep `McpClientRegistry` focused on lifecycle orchestration; delegate all OAuth mechanics (discovery, PKCE, token storage/refresh) to dedicated, independently testable collaborators injected into the registry — avoiding a god-class.
- Persist tokens and cached DCR client registrations on disk, scoped identically to existing `mcp.json` (global vs. project, project fully overrides global).
- Recover gracefully from token expiry/invalidation by returning to a clear, actionable `auth_required` state rather than a generic error.

**Non-Goals:**
- No support for non-localhost / remote-hosted deployments of the app (redirect URI assumes `http://127.0.0.1:<port>`).
- No UI wizard for manually entering `client_id`/`client_secret`/authorization endpoints — this design only covers the fully-automatic discovery + DCR path.
- No sharing of access/refresh tokens across MCP servers, even when they share an authorization server issuer (each server gets independent tokens; only DCR client registration is shared by issuer).
- No stdio-transport OAuth (per MCP spec, stdio servers should retrieve credentials from the environment, not OAuth).
- No unrelated MCP code cleanup/refactoring bundled into this change (kept strictly additive).

## Decisions

### 1. Automatic OAuth discovery, no new config schema
`HttpMcpClient`/`McpClientRegistry`'s connection attempt detects a `401` with `WWW-Authenticate`, then performs RFC9728 → RFC8414 → RFC7591 discovery automatically. `McpServerConfig`'s `http` transport shape (`url`, optional `headers`) is unchanged.
- *Alternative considered*: explicit `auth: {type: "oauth2", ...}` config block with manual override fields — rejected as extra schema/validation burden when the spec is designed for zero-config discovery; can be revisited later if a non-compliant server is encountered.

### 2. Callback served from the existing Bun server
Add `GET /api/mcp/oauth/callback` to the existing `Bun.serve` fetch handler in `src/bun/index.ts`. Redirect URI is `http://127.0.0.1:<port>/api/mcp/oauth/callback`.
- *Alternative considered*: ephemeral loopback listener per flow (the `gh auth login` pattern) — rejected as unnecessary process/port lifecycle complexity given the app already runs a persistent local server.

### 3. New `auth_required` server state; manual trigger only
`ServerState` gains `auth_required` (`src/bun/mcp/types.ts`). The registry never opens a browser automatically — a new `mcp.authorize(serverName)` RPC (`src/bun/handlers/mcp.ts`) is the only entrypoint that starts the flow, invoked by a "Sign in" button in `McpToolsPopover`.
- *Alternative considered*: auto-open browser on first connect attempt — rejected as intrusive for a background-ish dev tool (unexpected browser tabs on boot/reload).

### 4. Dedicated `PendingAuthFlowStore` for in-flight PKCE/CSRF state
A new small class (`src/bun/oauth/pending-flow-store.ts`) holds `Map<state, {serverName, codeVerifier, authServerMetadata, scope, createdAt}>`. Injected into both the RPC handler that starts a flow and the callback route that completes it.
- *Alternative considered*: storing pending-auth fields directly on the registry's server instance — rejected as responsibility creep that would grow `registry.ts` into a god class over time.

### 5. `TokenProvider` interface injected into `HttpMcpClient`
`HttpMcpClient` accepts an optional `TokenProvider` (`getAuthHeader(): Promise<Record<string,string>>`) constructor collaborator. Non-OAuth servers pass none (fully backward compatible). For OAuth servers, the registry constructs an `OAuthTokenProvider` (`src/bun/oauth/token-provider.ts`) that performs lazy refresh and passes it in.
- *Alternative considered*: `HttpMcpClient` importing OAuth token logic directly — rejected as it couples the transport to OAuth internals and breaks testability/DIP.

### 6. Token + DCR client registration persistence
New scope-mirrored files: `~/.railyn/mcp-tokens.json` (global) and `<project>/.railyn/mcp-tokens.json` (project), keyed by server name for tokens and by authorization-server issuer URL for cached DCR client registrations (`client_id`/`client_secret`), all in the same file. A new `src/bun/oauth/token-store.ts` module owns reading/writing this file, mirroring `config-loader.ts`'s pattern for `mcp.json`.
- *Alternative considered*: SQLite table — rejected as inconsistent with the existing file-based, human-inspectable `mcp.json` scoping convention and unnecessary migration overhead. OS keychain — rejected as inconsistent with the existing plaintext-file trust model already used for other secrets (env vars, headers) in `mcp.json`.

### 7. Lazy refresh; failure drops to `auth_required` with a typed error
Before each `tools/list`/`tools/call`, `OAuthTokenProvider` checks expiry and refreshes silently via the stored refresh token if needed. If refresh itself fails (refresh token invalid/expired), the provider clears the server's cached tokens, the registry transitions that server from `running` back to `auth_required`, and the in-flight call rejects with a typed `McpAuthRequiredError` (clear message, e.g. `MCP server "X" requires re-authentication`) instead of a raw HTTP/network exception.
- *Alternative considered*: reactive refresh only on 401 — rejected as it wastes a round-trip on every expired-token call and is harder to reason about under concurrent in-flight requests.

### 8. Independent per-server tokens; shared-by-issuer DCR only
Even if two MCP servers resolve to the same authorization server issuer, each performs and stores its own independent access/refresh token (avoids OAuth resource/audience mismatches per RFC8707). Only the DCR `client_id`/`client_secret` is cached and reused per issuer.

### 9. Browser launch via `open` npm package
New dependency `open` is used directly (no hand-rolled `src/bun/utils/browser.ts` OS-detection, despite the `workspace.ts` precedent for shelling out) — chosen for broader edge-case coverage (WSL, sandboxed Linux) with negligible dependency cost.

### 10. UI: new `auth_required` visual state + "Sign in" action
`McpToolsPopover.vue`'s server-dot color scheme gains an `auth_required` variant (distinct from `error`), and the per-server reload button is replaced by a "Sign in" button (calling `mcp.authorize`) specifically for servers in that state.

### 11. Injectable MCP client factory on `McpClientRegistry`
`McpClientRegistry` gains an optional constructor parameter (e.g. `clientFactory: (config: McpServerConfig) => McpClient`, defaulting to today's real `StdioMcpClient`/`HttpMcpClient` construction), mirroring the `McpRegistryFactory` pattern `McpRegistryPool` already uses one level up. This is the only seam that allows the server lifecycle state machine — including the new `auth_required` transitions — to be unit-tested deterministically with fake `McpClient` implementations, without spawning real subprocesses or making real HTTP calls. As a side effect, it also finally enables baseline test coverage of the pre-existing (currently untested) `idle`/`starting`/`running`/`error` transitions.
- *Alternative considered*: keep `_createClient` private and test only through real local `Bun.serve()` fakes for the HTTP path — rejected because it leaves the `stdio` transport and the registry's branching logic permanently untestable in isolation.

### 12. Injectable `BrowserOpener` collaborator for the authorize flow
Whatever owns `authorize()` (`McpClientRegistry`) accepts an injected `BrowserOpener` (`{ open(url: string): Promise<void> }`) collaborator, defaulting to the real `open`-package-backed implementation. Tests inject a spy/no-op implementation to assert on the generated authorization URL and PKCE parameters without ever invoking a real OS browser.
- *Alternative considered*: keep `openInBrowser` as a plain module-level import and gate it behind an env var (e.g. `RAILYN_TEST_NO_BROWSER=1`) — rejected as it embeds test-awareness into production code via an if-branch, rather than using DI as preferred throughout this design.

## Risks / Trade-offs

- **[Risk]** Redirect URI hardcodes `127.0.0.1:<port>`; if the app's port changes between DCR registration and token use (unlikely, but possible across restarts with `--port=`), redirect URI mismatch could break a stored client registration. → **Mitigation**: DCR registration is cached but not the redirect URI's validity guarantee; if the authorization server rejects a redirect URI mismatch, treat it like any other DCR failure and re-register on next `mcp.authorize` call.
- **[Risk]** Plaintext token storage in `mcp-tokens.json` matches the existing trust model but is a real exposure if the machine/repo is shared. → **Mitigation**: explicitly out of scope per decision to mirror existing `mcp.json` secret-handling conventions; document this in the file's directory (`.railyn/` is already gitignored-by-convention for secrets).
- **[Risk]** Some MCP OAuth servers may not support DCR (RFC7591 is a SHOULD, not MUST). → **Mitigation**: out of scope for this change (manual client registration path explicitly deferred); document as a known limitation and candidate follow-up.
- **[Trade-off]** No cross-server token sharing means a user with N servers behind the same auth server must sign in N times. → Accepted trade-off for correctness (avoiding resource/audience mismatches) over convenience.

## Testing Strategy

No new code was written to support testing beyond the two DI seams in Decisions 11–12 above — those seams are real architectural improvements (matching the existing `McpRegistryFactory` pattern and DIP generally), not test-only scaffolding.

| Layer | Target | Approach |
|---|---|---|
| Unit | `discovery.ts` (RFC9728/8414/7591 + DCR) | Shared fake-OAuth-server helper (`src/bun/test/support/fake-oauth-server.ts`), a local `Bun.serve()` exposing configurable metadata/DCR/token endpoints with failure-simulation hooks — following the existing `providers.test.ts` precedent of mocking HTTP wire formats with a real local server instead of a mocking framework |
| Unit | `pkce.ts` | Pure function tests (verifier/challenge/state generation), no I/O |
| Unit | `token-store.ts` | Temp-dir file I/O tests, mirroring `mcp-config-loader.test.ts`'s style |
| Unit | `OAuthTokenProvider` (lazy refresh, clear-on-failure) | Fake OAuth server's token/refresh endpoints, asserting refresh-before-expiry and `McpAuthRequiredError` on invalid refresh token |
| Unit | `McpClientRegistry` state machine incl. `auth_required` | Injected fake `McpClient` via the new client-factory seam (Decision 11) |
| Unit | `McpClientRegistry.authorize()` / `completeAuthorization()` | Injected fake `BrowserOpener` (Decision 12) + real `PendingAuthFlowStore`, asserting the generated authorization URL and PKCE state without a real browser |
| Unit | `mcp.authorize` RPC handler | Object-literal fakes for `registryPool`, matching the existing `handlers.test.ts` style for `mcp.getProjectConfig`/`saveProjectConfig` |
| Integration (in-memory DB) | Full flow via the real Bun subprocess fixture (`e2e/api/fixtures/server.ts`, `--memory-db`) | Point a test MCP server config at the shared fake OAuth server; exercise the real `/api/mcp/oauth/callback` route end-to-end: connect → `auth_required` → `mcp.authorize` → callback → `running` → tool call |
| Playwright | `auth_required` UI, "Sign in" button, polling-to-running | Extend `e2e/ui/mcp-tools.spec.ts` using the existing generic `ApiMock` (no mock-infrastructure changes needed once `mcp.authorize` is added to `rpc-types.ts`); simulate polling by returning `auth_required` for the first N `mcp.getStatus` calls, then `running` |

### Test scenario extrapolation (beyond the specs' literal scenarios)

- **Discovery**: metadata fetch returns malformed JSON; `authorization_servers` array is empty; Authorization Server Metadata is missing required fields (e.g. no `token_endpoint`); DCR endpoint returns `4xx` (server doesn't support DCR — should surface as `auth_required` with a discovery error, not crash).
- **PKCE/state**: two concurrent `authorize()` calls for two different servers don't collide in `PendingAuthFlowStore`; an expired/stale pending flow entry is rejected by the callback even with a structurally valid `state`.
- **Callback route**: missing `code` param; missing/mismatched `state` param; authorization server returns an `error` query param (user denied consent) — server should return to `auth_required`, not `error`.
- **Token store**: concurrent writes to the same scope's `mcp-tokens.json` (two servers under one project completing auth around the same time) don't clobber each other's entries; corrupt/malformed existing token file is handled like `config-loader.ts` handles malformed `mcp.json`.
- **Lazy refresh**: token expiring exactly at the boundary (near-expiry threshold); refresh succeeding but returning no new `refresh_token` (some servers rotate, some don't) — old refresh token must remain valid for reuse in that case.
- **Cross-server isolation**: two servers sharing an issuer — confirm DCR `client_id` is reused but access/refresh tokens are stored and refreshed completely independently, including independent failure (one server's refresh failing doesn't affect the other's `running` state).
- **Registry state machine**: `reload(serverName)` called on a server in `auth_required` — should re-run discovery from scratch rather than assume prior discovery results are still valid.
- **UI**: popover opened while a server is mid-poll-cycle in `auth_required`; popover closed and reopened while a flow is pending (polling must not leak across popover instances); "Sign in" clicked twice in a row before the first flow completes (second click should not silently orphan the first `PendingAuthFlowStore` entry).

## Migration Plan

- Purely additive: no existing `mcp.json` entries or behavior change for stdio or already-working HTTP (non-OAuth) servers.
- No DB migration required (token storage is file-based, not SQLite).
- Rollout is a single deployable change; no feature flag needed since the new code paths only activate when a server responds `401` with `WWW-Authenticate`.
- Rollback: revert the change; any `mcp-tokens.json` files left on disk are inert and can be deleted manually if desired.

## Open Questions

- None outstanding — all key decisions (13 initial + 4 testability follow-up) were resolved during the pre-proposal exploration/decision sessions referenced above.

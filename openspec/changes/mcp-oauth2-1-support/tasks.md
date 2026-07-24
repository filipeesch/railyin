## 1. Dependencies & Types

- [x] 1.1 Add `open` npm package dependency
- [x] 1.2 Extend `ServerState` in `src/bun/mcp/types.ts` with `"auth_required"`
- [x] 1.3 Add `McpAuthRequiredError` typed error class (new `src/bun/oauth/errors.ts`)
- [x] 1.4 Define OAuth-related types: `OAuthTokenSet`, `DcrClientRegistration`, `AuthorizationServerMetadata`, `ProtectedResourceMetadata`, `PendingAuthFlow` (new `src/bun/oauth/types.ts`)

## 2. OAuth Discovery & PKCE

- [x] 2.1 Implement PKCE helpers (`generateCodeVerifier`, `generateCodeChallenge`, `generateState`) in `src/bun/oauth/pkce.ts`
- [x] 2.2 Implement Protected Resource Metadata discovery (RFC9728) — parse `WWW-Authenticate` to locate the metadata URL, fetch and validate `authorization_servers` in `src/bun/oauth/discovery.ts`
- [x] 2.3 Implement Authorization Server Metadata discovery (RFC8414) in `src/bun/oauth/discovery.ts`
- [x] 2.4 Implement Dynamic Client Registration (RFC7591) request/response handling in `src/bun/oauth/discovery.ts`

## 3. Token Storage

- [x] 3.1 Implement `src/bun/oauth/token-store.ts`: read/write `mcp-tokens.json` (global `~/.railyn/` and project `<project>/.railyn/`), mirroring `config-loader.ts`'s load pattern
- [x] 3.2 Store DCR client registrations keyed by issuer URL in the same file
- [x] 3.3 Store per-server access/refresh tokens keyed by server name in the same file (no cross-server sharing)
- [x] 3.4 Add helper to clear a single server's cached tokens (used on refresh failure)

## 4. Pending Auth Flow & Token Provider

- [x] 4.1 Implement `PendingAuthFlowStore` (`src/bun/oauth/pending-flow-store.ts`) — in-memory `Map<state, PendingAuthFlow>` with create/consume/expire operations; superseding a prior pending entry for the same server invalidates it
- [x] 4.2 Implement `OAuthTokenProvider` (`src/bun/oauth/token-provider.ts`) implementing a `TokenProvider` interface: `getAuthHeader()` with lazy expiry check + refresh-token exchange
- [x] 4.3 On refresh failure, `OAuthTokenProvider` clears stored tokens for that server and surfaces `McpAuthRequiredError`
- [x] 4.4 Implement `src/bun/utils/browser.ts` thin wrapper around the `open` package (single `openInBrowser(url)` function), and a `BrowserOpener` interface it implements

## 5. HttpMcpClient & Registry Integration

- [x] 5.1 Add optional `TokenProvider` constructor param to `HttpMcpClient`; attach `Authorization: Bearer <token>` header from provider when present (`src/bun/mcp/client.ts`)
- [x] 5.2 On `401` + `WWW-Authenticate` during `HttpMcpClient.initialize()`, surface a distinguishable error/signal the registry can catch to trigger discovery instead of a generic connection failure
- [x] 5.3 Add an injectable client-factory constructor param to `McpClientRegistry` (`clientFactory: (config: McpServerConfig) => McpClient`, defaulting to real `StdioMcpClient`/`HttpMcpClient` construction), replacing the hardcoded private `_createClient` call sites
- [x] 5.4 Add an injectable `BrowserOpener` constructor param to `McpClientRegistry`, defaulting to the real `open`-package-backed implementation from `browser.ts`
- [x] 5.5 Update `McpClientRegistry._startServer` to catch the auth-required signal, run discovery (RFC9728 → RFC8414 → RFC7591 DCR via `discovery.ts`), and transition the server to `auth_required` instead of `error` (`src/bun/mcp/registry.ts`)
- [x] 5.6 Add `authorize(serverName)` method to `McpClientRegistry`: generates PKCE + state via `pkce.ts`, stores pending flow in `PendingAuthFlowStore`, builds the authorization URL, and calls the injected `BrowserOpener`
- [x] 5.7 Add `completeAuthorization(state, code)` method to `McpClientRegistry`: consumes the pending flow, exchanges the code for tokens, persists via `token-store.ts`, constructs an `OAuthTokenProvider`, reconnects the `HttpMcpClient` with it, and transitions the server to `running`
- [x] 5.8 Wire lazy refresh + `auth_required` fallback into `McpClientRegistry.callTool`/tool listing paths so refresh failures downgrade `running` → `auth_required` per spec
- [x] 5.9 `reload(serverName)` on a server in `auth_required` re-runs discovery from scratch rather than reusing cached discovery results

## 6. RPC & HTTP Routes

- [x] 6.1 Add `mcp.authorize` to `src/shared/rpc-types.ts` (`params: { serverName: string }`, `response: McpServerStatus[]` or similar)
- [x] 6.2 Implement `mcp.authorize` handler in `src/bun/handlers/mcp.ts`, delegating to `registry.authorize(serverName)`
- [x] 6.3 Add `GET /api/mcp/oauth/callback` route to the `Bun.serve` fetch handler in `src/bun/index.ts`, parsing `code`/`state`/`error` query params and delegating to the registry's `completeAuthorization`, returning a simple "you can close this tab" HTML response; handle missing `code`, `error` (user denied), and unknown/expired `state` distinctly
- [x] 6.4 Extend `McpServerStatus`/`ServerState` shared types to include `"auth_required"` (`src/shared/rpc-types.ts` or wherever `McpServerStatus` is re-exported)

## 7. Frontend UI

- [x] 7.1 Add `auth_required` dot color/icon variant in `McpToolsPopover.vue` styles
- [x] 7.2 Replace the reload button with a "Sign in" button for servers in `auth_required` state, calling `mcp.authorize`
- [x] 7.3 Implement interval-based polling of `mcp.getStatus` while the popover is open and any server is `auth_required`; stop polling when no server is `auth_required` or the popover closes, and ensure closing/reopening the popover never leaves more than one polling loop active

## 8. Wiring & Boot

- [x] 8.1 Ensure `McpRegistryPool`/`McpClientRegistry` construction passes through the new OAuth collaborators (`PendingAuthFlowStore`, token store paths per scope, client factory, `BrowserOpener`) via constructor injection, not module-level singletons
- [x] 8.2 Confirm global vs. project registry instances each resolve their own scoped `mcp-tokens.json` path consistent with existing `mcp.json` scoping in `registry-pool.ts`

## 9. Unit Tests

- [x] 9.1 Build shared fake-OAuth-server test helper (`src/bun/test/support/fake-oauth-server.ts`): local `Bun.serve()` with configurable Protected Resource Metadata, Authorization Server Metadata, DCR, authorization, and token endpoints, plus hooks to simulate failures (malformed metadata, missing `authorization_servers`, incomplete AS metadata, DCR rejection, invalid/rotated refresh token, consent denial)
- [x] 9.2 Unit test `pkce.ts` — verifier/challenge/state generation (pure functions, no I/O)
- [x] 9.3 Unit test `discovery.ts` against the fake OAuth server — happy path plus each failure mode from 9.1
- [x] 9.4 Unit test `token-store.ts` — global/project scoping, per-server token keys, issuer-keyed DCR cache, malformed existing file handling, concurrent writes for two servers in the same scope
- [x] 9.5 Unit test `OAuthTokenProvider` — valid token passthrough, expired-token refresh, refresh response without a new `refresh_token`, refresh failure clearing tokens and raising `McpAuthRequiredError`
- [x] 9.6 Unit test `McpClientRegistry` state machine using the injected client-factory seam — idle/starting/running/error transitions (baseline, currently uncovered) plus new `auth_required` transitions and refresh-failure downgrade from `running`
- [x] 9.7 Unit test `McpClientRegistry.authorize()`/`completeAuthorization()` using the injected `BrowserOpener` and a real `PendingAuthFlowStore` — generated URL/PKCE params, concurrent authorize calls for different servers, repeated authorize calls for the same server invalidating the prior pending entry
- [x] 9.8 Unit test `mcp.authorize` RPC handler with object-literal fakes for `registryPool`, matching the existing `handlers.test.ts` style

## 10. Integration Tests (in-memory DB)

- [x] 10.1 Extend `e2e/api` fixtures/tests to configure a test MCP server pointed at the shared fake OAuth server
- [x] 10.2 Integration test: connect → `401` → discovery → `auth_required`, verified via `mcp.getStatus`
- [ ] 10.3 Integration test: `mcp.authorize` → real `/api/mcp/oauth/callback` round trip (using the fake OAuth server's authorization/token endpoints) → `running` → a real tool call succeeds

  > **Not automated (decision recorded):** the real subprocess calls the real `open` npm package with no seam to suppress/intercept the browser launch, and the PKCE `state`/`code_verifier` are generated internally with no RPC exposing them, so this exact real-subprocess round trip cannot be driven safely in CI. The equivalent flow IS covered at the unit-test layer (9.7, `mcp-registry-oauth.test.ts`) via the injected `BrowserOpener`/`clientFactory` seams, plus scenarios 10.2/10.4/10.5 cover everything up to and including `auth_required` + discovery + DCR against the real subprocess. Remaining gap is closed by manual verification (12.1).
- [x] 10.4 Integration test: callback with missing `code`, mismatched `state`, and `error=access_denied` all leave the server in `auth_required` without persisting tokens
- [x] 10.5 Integration test: two servers sharing the fake OAuth server's issuer — independent tokens persisted, shared DCR client registration confirmed via the token store file contents
- [ ] 10.6 Integration test: forcing an invalid refresh token drops a `running` server back to `auth_required` and the next tool call fails with the typed re-authentication error

  > **Not automated:** reaching a real `running` state via the real subprocess requires completing 10.3's browser-driven flow first (same blocker). The refresh-failure→`auth_required` downgrade itself IS covered at the unit-test layer (9.5 `oauth-token-provider.test.ts`, 9.6 `mcp-registry-oauth.test.ts`). Remaining gap is closed by manual verification (12.2).

## 11. Playwright Tests

- [x] 11.1 Extend `e2e/ui/mcp-tools.spec.ts`: `auth_required` server renders the distinct dot/icon and "Sign in" button instead of reload
- [x] 11.2 Clicking "Sign in" calls `mcp.authorize` with the correct `serverName` (via `ApiMock.capture`)
- [x] 11.3 Simulate out-of-band completion: mock `mcp.getStatus` to return `auth_required` for the first N calls then `running`, and assert the popover updates without a manual reload click
- [x] 11.4 Closing the popover while `auth_required` stops further polling (assert no additional `mcp.getStatus` calls after close, via call-count assertions on the mock)
- [x] 11.5 Reopening the popover after close while still `auth_required` results in exactly one active poll loop, not a duplicate

## 12. Manual Verification

- [ ] 12.1 Manually verify end-to-end flow against a real OAuth-protected MCP HTTP server: connect → `auth_required` → sign in → browser flow → callback → `running` → tool call succeeds
- [ ] 12.2 Manually verify refresh-failure path against a real server: force an invalid refresh token and confirm the server drops to `auth_required` with a clear error surfaced to the user
- [ ] 12.3 Manually verify two real servers sharing an authorization server issuer each get independent tokens but share cached DCR client registration


## Why

MCP servers exposed over HTTP increasingly require OAuth 2.1 authorization (per the MCP Authorization spec). Today, `HttpMcpClient` sends only static `headers` from config, so any OAuth-protected MCP server fails to connect and there is no way to obtain, store, or refresh a bearer token. Users need a way to sign in to such servers directly from the app, with the browser-based auth flow handled automatically once they opt in.

## What Changes

- Add OAuth 2.1 discovery to the HTTP MCP connection flow: on a `401` with `WWW-Authenticate`, the registry discovers the Protected Resource Metadata (RFC9728), Authorization Server Metadata (RFC8414), and performs Dynamic Client Registration (RFC7591) automatically — no new `mcp.json` schema fields required.
- Add a new `auth_required` server lifecycle state to `McpClientRegistry`, distinct from `error`, reached when a server needs user authorization.
- Add a manual-trigger authorization flow: a new `mcp.authorize(serverName)` RPC starts an Authorization Code + PKCE flow, opens the user's system default browser (via the `open` npm package), and completes via a new `GET /api/mcp/oauth/callback` route on the existing Bun server.
- Add persistence for OAuth tokens and cached DCR client registrations in scope-appropriate `mcp-tokens.json` files (`~/.railyn/mcp-tokens.json` global, `<project>/.railyn/mcp-tokens.json` project), mirroring the existing `mcp.json` scoping convention.
- Add lazy access-token refresh: before each `tools/list`/`tools/call`, a `TokenProvider` refreshes an expired access token using the stored refresh token; if refresh fails, the server drops back to `auth_required` and in-flight calls fail with a clear, typed re-authentication error.
- `HttpMcpClient` gains an optional injected `TokenProvider` collaborator to attach a live `Authorization: Bearer <token>` header, without any OAuth-specific logic living in the transport class itself.
- Update `McpToolsPopover` to show a distinct visual treatment for `auth_required` servers and a "Sign in" action in place of the reload button for that state.
- OAuth tokens are always scoped per MCP server (no cross-server token sharing), even when two servers share the same authorization server issuer; only DCR client registration is cached/reused per issuer.

## Capabilities

### New Capabilities
- `mcp-oauth`: OAuth 2.1 discovery, Dynamic Client Registration, Authorization Code + PKCE flow, token persistence, and lazy refresh for HTTP MCP servers.

### Modified Capabilities
- `mcp-client-registry`: Adds the `auth_required` server state, the `mcp.authorize` trigger, and token-refresh-driven state transitions to the existing lifecycle state machine.
- `mcp-ui`: `McpToolsPopover` gains an `auth_required` visual state and "Sign in" action per server.

## Impact

- **Backend**: `src/bun/mcp/client.ts` (optional `TokenProvider` param on `HttpMcpClient`), `src/bun/mcp/registry.ts` (new state, authorize entrypoint), `src/bun/mcp/types.ts` (new state/type additions), new `src/bun/oauth/*` modules (discovery, PKCE, pending-flow store, token store, token provider), new `src/bun/utils/browser.ts`, `src/bun/handlers/mcp.ts` (new `mcp.authorize` RPC), `src/bun/index.ts` (new `/api/mcp/oauth/callback` route wiring).
- **Frontend**: `src/mainview/components/McpToolsPopover.vue` (new state UI + action).
- **Shared**: `src/shared/rpc-types.ts` (new `mcp.authorize` method, `McpServerStatus.state` union extended).
- **Dependencies**: new `open` npm package.
- **Config/storage**: new `mcp-tokens.json` files under `~/.railyn/` and `<project>/.railyn/`, no changes to existing `mcp.json` schema.

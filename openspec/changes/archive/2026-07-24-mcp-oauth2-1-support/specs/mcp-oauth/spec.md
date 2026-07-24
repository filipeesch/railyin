## ADDED Requirements

### Requirement: OAuth discovery on 401
When connecting to an HTTP-transport MCP server, if the server responds `401 Unauthorized` with a `WWW-Authenticate` header, the system SHALL perform OAuth 2.0 Protected Resource Metadata (RFC9728) discovery followed by OAuth 2.0 Authorization Server Metadata (RFC8414) discovery, without requiring any additional fields in the server's `mcp.json` entry.

#### Scenario: 401 triggers discovery
- **WHEN** an HTTP MCP server responds `401` with a `WWW-Authenticate` header during connection
- **THEN** the system fetches the Protected Resource Metadata document referenced by that header, then the Authorization Server Metadata for the discovered issuer

#### Scenario: No new config fields required
- **WHEN** a server's `mcp.json` entry only has `type: "http"`, `url`, and optional `headers`
- **THEN** OAuth discovery and authorization proceed without any additional auth-related config keys

#### Scenario: Protected Resource Metadata fetch fails
- **WHEN** the Protected Resource Metadata document cannot be fetched or returns malformed JSON
- **THEN** the server transitions to `auth_required` with a discovery error recorded, rather than crashing the connection attempt or reporting a generic `error` state

#### Scenario: No authorization servers advertised
- **WHEN** the Protected Resource Metadata document's `authorization_servers` field is missing or empty
- **THEN** the server transitions to `auth_required` with an error indicating no authorization server was advertised

#### Scenario: Authorization Server Metadata missing required endpoints
- **WHEN** the discovered Authorization Server Metadata document is missing a required endpoint (e.g. `token_endpoint` or `authorization_endpoint`)
- **THEN** the server transitions to `auth_required` with an error indicating the authorization server metadata is incomplete

### Requirement: Dynamic Client Registration
The system SHALL attempt OAuth 2.0 Dynamic Client Registration (RFC7591) against the discovered authorization server when no cached client registration exists for that issuer, and SHALL cache the resulting `client_id` (and `client_secret` if issued) keyed by issuer URL for reuse across MCP servers sharing that issuer.

#### Scenario: First-time registration
- **WHEN** no cached client registration exists for a discovered authorization server issuer
- **THEN** the system performs Dynamic Client Registration and persists the returned `client_id`/`client_secret` keyed by issuer URL

#### Scenario: Registration reused across servers
- **WHEN** a second MCP server discovers the same authorization server issuer as a previously registered one
- **THEN** the cached `client_id`/`client_secret` is reused without a new registration request

#### Scenario: Dynamic Client Registration not supported
- **WHEN** the discovered authorization server's Dynamic Client Registration endpoint returns an error or is not advertised
- **THEN** the server transitions to `auth_required` with an error indicating registration failed, rather than crashing the connection attempt

### Requirement: Manual authorization trigger
The system SHALL NOT open a browser automatically when a server requires authorization. Authorization SHALL only begin when explicitly triggered via the `mcp.authorize(serverName)` RPC.

#### Scenario: Explicit sign-in required
- **WHEN** a server transitions to `auth_required` state
- **THEN** no browser is opened until the user explicitly triggers `mcp.authorize` for that server

#### Scenario: Authorize opens system browser
- **WHEN** `mcp.authorize(serverName)` is called for a server in `auth_required` state
- **THEN** the system generates a PKCE code verifier/challenge and CSRF `state`, stores them keyed by `state` in a pending-flow store, and opens the system default browser at the authorization server's authorization endpoint

#### Scenario: Concurrent authorize calls for different servers do not collide
- **WHEN** `mcp.authorize` is called for two different servers before either flow completes
- **THEN** each flow's PKCE verifier and `state` are stored as distinct pending-flow entries, and completing one does not affect the other

#### Scenario: Repeated authorize calls for the same server before completion
- **WHEN** `mcp.authorize(serverName)` is called a second time for the same server while an earlier flow for that server is still pending
- **THEN** a new pending-flow entry is created for the new attempt and the prior pending entry for that server is invalidated, so a stale authorization code cannot complete an abandoned flow

### Requirement: OAuth callback completes the flow
The system SHALL expose `GET /api/mcp/oauth/callback` on the existing local HTTP server to receive the authorization redirect, exchange the authorization code for tokens using the stored PKCE verifier, and persist the resulting tokens.

#### Scenario: Successful callback
- **WHEN** the authorization server redirects to `/api/mcp/oauth/callback` with a valid `code` and matching `state`
- **THEN** the system exchanges the code for an access/refresh token pair using the corresponding PKCE code verifier, persists the tokens for that server, and the server transitions to `running`

#### Scenario: State mismatch or unknown state
- **WHEN** the callback is invoked with a `state` value not present in the pending-flow store (e.g. expired, replayed, or forged)
- **THEN** the system rejects the callback with an error and does not persist any tokens

#### Scenario: Missing authorization code
- **WHEN** the callback is invoked with a valid known `state` but no `code` query parameter
- **THEN** the system rejects the callback with an error, does not persist any tokens, and the server remains in `auth_required`

#### Scenario: User denies consent
- **WHEN** the authorization server redirects to the callback with an `error` query parameter (e.g. `access_denied`) instead of a `code`
- **THEN** the system does not treat this as a connection failure; the server remains in `auth_required` so the user can retry

#### Scenario: Expired pending flow
- **WHEN** the callback is invoked with a `state` that matches a pending-flow entry created longer ago than the flow's expiry window
- **THEN** the system rejects the callback with an error indicating the flow expired, and does not persist any tokens

### Requirement: Per-server token persistence
The system SHALL persist OAuth access and refresh tokens in a file scoped identically to `mcp.json` (`~/.railyn/mcp-tokens.json` for global servers, `<project>/.railyn/mcp-tokens.json` for project servers), keyed by server name. Tokens SHALL NOT be shared between different MCP servers, even when those servers share the same authorization server issuer.

#### Scenario: Global server token storage
- **WHEN** a global-scope MCP server (no project override) completes authorization
- **THEN** its tokens are written to `~/.railyn/mcp-tokens.json` keyed by that server's name

#### Scenario: Project server token storage
- **WHEN** a project-scope MCP server completes authorization
- **THEN** its tokens are written to `<project>/.railyn/mcp-tokens.json` keyed by that server's name

#### Scenario: No token sharing across servers with same issuer
- **WHEN** two MCP servers discover the same authorization server issuer and both complete authorization
- **THEN** each server has its own independently stored access/refresh token pair; neither reuses the other's token

#### Scenario: Concurrent token writes for different servers in the same scope
- **WHEN** two servers in the same scope (e.g. both project-level) complete authorization around the same time
- **THEN** both servers' tokens end up correctly persisted in the shared `mcp-tokens.json` file without either write clobbering the other

#### Scenario: Malformed existing token file
- **WHEN** the scope's `mcp-tokens.json` file exists but contains malformed JSON
- **THEN** the system handles this the same way `config-loader.ts` handles a malformed `mcp.json` — a clear, contained error rather than a silent data loss or process crash

### Requirement: Lazy token refresh
Before each `tools/list` or `tools/call` request to an OAuth-protected server, the system SHALL check whether the stored access token is expired or near-expiry and, if so, silently exchange the stored refresh token for a new access token before proceeding.

#### Scenario: Valid token, no refresh
- **WHEN** a tool call is made and the stored access token is not expired
- **THEN** the system uses the existing access token without attempting a refresh

#### Scenario: Expired token, successful refresh
- **WHEN** a tool call is made and the stored access token is expired
- **THEN** the system exchanges the refresh token for a new access token, persists it, and proceeds with the call using the new token

#### Scenario: Refresh response omits a new refresh token
- **WHEN** a refresh exchange succeeds but the authorization server's response does not include a new `refresh_token` (some servers do not rotate refresh tokens)
- **THEN** the system retains the existing refresh token for future use, only replacing the access token

### Requirement: Refresh failure recovery
If a refresh token exchange fails (refresh token invalid, revoked, or expired), the system SHALL clear the server's cached tokens, transition the server from `running` to `auth_required`, and reject the in-flight request with a typed re-authentication error rather than a raw HTTP or network exception.

#### Scenario: Refresh token invalid
- **WHEN** a stored refresh token is rejected by the authorization server during a refresh attempt
- **THEN** the server's cached tokens are cleared, its state transitions to `auth_required`, and the pending tool call fails with an error indicating the server requires re-authentication

#### Scenario: Subsequent calls fail fast until re-authorized
- **WHEN** a server is in `auth_required` state due to refresh failure
- **THEN** subsequent `tools/list`/`tools/call` requests to that server fail immediately with the same typed re-authentication error until `mcp.authorize` is called again

#### Scenario: Reload re-runs discovery rather than reusing stale results
- **WHEN** `reload(serverName)` is called on a server in `auth_required` state
- **THEN** the system re-runs OAuth discovery from scratch rather than assuming previously discovered metadata or DCR results are still valid


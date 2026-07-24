## MODIFIED Requirements

### Requirement: Server lifecycle state machine
The registry SHALL maintain a state for each configured server: `idle`, `starting`, `running`, `auth_required`, or `error`. On registry init, all servers start in `idle`. Connecting transitions through `starting` to `running`, `auth_required`, or `error`.

#### Scenario: Successful connection
- **WHEN** a server is started and the MCP initialize handshake completes successfully
- **THEN** the server transitions to `running` and its tool list is available

#### Scenario: Connection failure
- **WHEN** a server fails to start (process error, HTTP unreachable, or initialize timeout)
- **THEN** the server transitions to `error` with an error message stored

#### Scenario: Reload running server
- **WHEN** `reload(serverName)` is called on a server in any state
- **THEN** the server's existing connection is terminated, state resets to `idle`, and the server reconnects

#### Scenario: OAuth authorization required
- **WHEN** an HTTP server's connection attempt receives a `401` with `WWW-Authenticate` and no valid stored token is available
- **THEN** the server transitions to `auth_required` instead of `error`, and its tool list remains unavailable until authorization completes

#### Scenario: Token refresh failure drops server to auth_required
- **WHEN** a `running` OAuth-protected server's lazy token refresh fails
- **THEN** the server transitions from `running` to `auth_required`, its cached tokens are cleared, and any in-flight tool call fails with a typed re-authentication error

## ADDED Requirements

### Requirement: Authorization trigger entrypoint
The registry SHALL expose a method to begin the OAuth authorization flow for a specific server currently in `auth_required` state, delegating PKCE/state generation, browser launch, and token exchange to dedicated OAuth collaborators rather than implementing OAuth mechanics inline.

#### Scenario: Authorize a server in auth_required state
- **WHEN** the authorize entrypoint is called for a server in `auth_required` state
- **THEN** the registry delegates to the OAuth flow collaborators to generate PKCE parameters, open the browser, and await the callback, without itself performing HTTP OAuth requests

#### Scenario: Authorize is a no-op for servers not requiring auth
- **WHEN** the authorize entrypoint is called for a server not in `auth_required` state
- **THEN** the registry does not start a new authorization flow

### Requirement: Injectable MCP client factory
The registry SHALL accept an injected client factory collaborator responsible for constructing the underlying `McpClient` transport for a given server config, defaulting to the real stdio/HTTP client construction. The registry SHALL NOT hardcode client construction in a way that prevents substituting a fake client for testing.

#### Scenario: Default factory constructs real clients
- **WHEN** the registry is constructed without an explicit client factory
- **THEN** it uses the real `StdioMcpClient`/`HttpMcpClient` construction, matching prior behavior exactly

#### Scenario: Injected factory drives state transitions deterministically
- **WHEN** the registry is constructed with a factory that returns a fake `McpClient`
- **THEN** the registry's lifecycle state transitions (`idle`/`starting`/`running`/`auth_required`/`error`) are driven entirely by that fake client's behavior, with no real subprocess or network call made

### Requirement: Injectable browser opener for authorization
The authorize entrypoint SHALL delegate opening the system browser to an injected `BrowserOpener` collaborator, defaulting to a real implementation backed by the system's default browser launcher. The registry SHALL NOT hardcode a direct call to the browser-launching mechanism in a way that prevents substituting a fake opener for testing.

#### Scenario: Default opener launches the real system browser
- **WHEN** the registry is constructed without an explicit `BrowserOpener`
- **THEN** calling authorize opens the user's actual default system browser at the generated authorization URL

#### Scenario: Injected opener captures the authorization URL without launching a browser
- **WHEN** the registry is constructed with a fake `BrowserOpener`
- **THEN** calling authorize invokes the fake opener with the generated authorization URL and PKCE-derived parameters, and no real browser process is launched


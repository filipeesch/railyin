## MODIFIED Requirements

### Requirement: Registry lifetime and lookup
A `McpRegistryPool` service SHALL manage per-project and global `McpClientRegistry` instances. The pool SHALL be constructed once at application boot, injected into the app context, and consumed by execution builders — replacing the module-level `getMcpRegistry()` singleton pattern.

#### Scenario: Global registry initialized at boot
- **WHEN** the application starts
- **THEN** `McpRegistryPool` initializes a global registry from `~/.railyn/mcp.json` (if present)

#### Scenario: Project registry lazily initialized
- **WHEN** an execution starts for a project whose registry has not yet been loaded
- **THEN** `McpRegistryPool.getRegistry(projectPath)` initializes and caches a new `McpClientRegistry` for that project

#### Scenario: Registry reused for subsequent executions
- **WHEN** a second execution starts for the same project path
- **THEN** the cached registry is returned without re-initialization

#### Scenario: Session execution uses global registry
- **WHEN** a standalone chat session execution starts (no project_key)
- **THEN** the global registry is used

## MODIFIED Requirements

### Requirement: Server lifecycle state machine
The registry SHALL maintain a state for each configured server: `idle`, `starting`, `running`, or `error`. On registry init, all servers start in `idle`. Connecting transitions through `starting` to `running` or `error`.

#### Scenario: Successful connection
- **WHEN** a server is started and the MCP initialize handshake completes successfully
- **THEN** the server transitions to `running` and its tool list is available

#### Scenario: Connection failure
- **WHEN** a server fails to start (process error, HTTP unreachable, or initialize timeout)
- **THEN** the server transitions to `error` with an error message stored

#### Scenario: Reload running server
- **WHEN** `reload(serverName)` is called on a server in any state
- **THEN** the server's existing connection is terminated, state resets to `idle`, and the server reconnects

## ADDED Requirements

### Requirement: Idempotent start helper (ensureStarted)
The `McpClientRegistry` SHALL expose an `ensureStarted()` method that starts every enabled server in `idle` state exactly once per registry lifetime. Concurrent calls SHALL share the same in-flight start operation rather than starting servers twice. Once every enabled server is terminal (`running`, `error`, `auth_required`, or `disabled`), `ensureStarted()` SHALL resolve immediately without re-starting. Servers in `error` or `auth_required` SHALL NOT be retried by `ensureStarted()` — the only retry path is `reload(serverName?)`.

#### Scenario: Concurrent calls share one start
- **WHEN** `ensureStarted()` is called concurrently before the first start completes
- **THEN** a single start operation runs and every caller resolves with the same completed start

#### Scenario: Already-terminal registry is a no-op
- **WHEN** `ensureStarted()` is called and every enabled server is `running`, `error`, `auth_required`, or `disabled`
- **THEN** it resolves immediately without starting any server

#### Scenario: Errored servers are not retried
- **WHEN** `ensureStarted()` is called again after a server reached `error`
- **THEN** it resolves without restarting that server; `reload()` is the only way to reconnect it

## MODIFIED Requirements

### Requirement: Registry lifetime and lookup
A `McpRegistryPool` service SHALL manage one global `McpClientRegistry` plus a lazily-initialized `McpClientRegistry` per project path. The pool SHALL expose `getGlobalRegistry()` and `getForProject(projectPath)`. On first creation of a project registry, the pool SHALL fire `ensureStarted()` asynchronously (non-blocking) so project-scoped servers transition `idle` → `starting` → `running` before the execution's discovery tools operate. Subsequent lookups for the same project path SHALL return the cached registry without re-initializing or re-starting.

#### Scenario: Global registry initialized at boot
- **WHEN** the application starts
- **THEN** `McpRegistryPool` initializes a global registry from the global `mcp.json` (if present) and starts it

#### Scenario: Project registry lazily initialized and started on first use
- **WHEN** an execution starts for a project whose registry has not been loaded
- **THEN** `getForProject(projectPath)` initializes a new `McpClientRegistry` from `<projectPath>/.railyn/mcp.json`, caches it, and fires `ensureStarted()` so servers reach `running` before the execution's MCP tools are used

#### Scenario: Registry reused for subsequent executions
- **WHEN** a second execution starts for the same project path
- **THEN** the cached registry is returned without re-initialization or re-start

#### Scenario: Session execution uses global registry
- **WHEN** a standalone chat session execution starts (no `project_key`)
- **THEN** the global registry is used

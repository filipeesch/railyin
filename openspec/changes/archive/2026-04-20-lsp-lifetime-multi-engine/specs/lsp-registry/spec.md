## ADDED Requirements

### Requirement: TaskLSPRegistry manages task-scoped LSP server managers
The system SHALL maintain a module-level `TaskLSPRegistry` singleton at `src/bun/lsp/registry.ts` that holds a `Map<taskId, { manager: LSPServerManager | null, idleTimer: Timer | null }>`. The registry SHALL expose `getManager(taskId, serverConfigs, worktreePath): LSPServerManager` and `releaseTask(taskId): Promise<void>` as its public API.

#### Scenario: First request for a task creates a manager entry
- **WHEN** `getManager(taskId, ...)` is called for a task with no existing entry
- **THEN** a new `LSPServerManager` is created and stored under `taskId`, and the idle timer is started

#### Scenario: Subsequent requests for the same task return the same manager
- **WHEN** `getManager(taskId, ...)` is called again for the same task
- **THEN** the existing `LSPServerManager` instance is returned without creating a new one

### Requirement: LSP manager uses lazy initialization — server processes start on first tool call
The system SHALL NOT spawn any LSP server process when `getManager()` is called. The `LSPServerManager` SHALL remain in `idle` state until the first `request()` call, at which point it starts the server transparently. The calling model waits during server startup (up to 30s timeout).

#### Scenario: No process spawned on registry entry creation
- **WHEN** `getManager(taskId, ...)` is called for the first time
- **THEN** no child process is spawned; the manager is in `idle` state

#### Scenario: Server starts on first LSP tool use
- **WHEN** the model calls `lsp(goToDefinition, ...)` for the first time in a task
- **THEN** the LSP server process starts, `initialize` handshake completes, and the result is returned — the model waits transparently

### Requirement: Idle timer shuts down inactive LSP managers after 10 minutes
The registry SHALL reset a 10-minute idle timer on every `getManager()` call. When the timer fires, the registry SHALL call `manager.shutdown()` and set the entry's manager to `null` (preserving the entry for lazy re-creation). The next `getManager()` call after expiry SHALL create a fresh `LSPServerManager`.

#### Scenario: Timer resets on each use
- **WHEN** `getManager(taskId, ...)` is called while the idle timer is running
- **THEN** the timer is cleared and restarted for another 10 minutes

#### Scenario: Manager shuts down after 10 minutes of inactivity
- **WHEN** no `getManager(taskId, ...)` call occurs for 10 minutes
- **THEN** `manager.shutdown()` is called and the manager reference is set to `null`

#### Scenario: Cold-start after idle expiry
- **WHEN** `getManager(taskId, ...)` is called after the idle timer has fired
- **THEN** a new `LSPServerManager` is created and the idle timer is restarted

### Requirement: Task release shuts down the manager and clears the entry
The system SHALL call `registry.releaseTask(taskId)` when a task reaches a terminal execution state (done, failed, or archived). `releaseTask` SHALL cancel the idle timer, call `manager.shutdown()` if a manager exists, and delete the entry from the map.

#### Scenario: Release cleans up running manager
- **WHEN** `releaseTask(taskId)` is called while a manager is running
- **THEN** the idle timer is cancelled, `manager.shutdown()` is awaited, and the entry is removed

#### Scenario: Release is safe when no manager exists
- **WHEN** `releaseTask(taskId)` is called for a task with no registry entry or a null manager
- **THEN** the call completes without error

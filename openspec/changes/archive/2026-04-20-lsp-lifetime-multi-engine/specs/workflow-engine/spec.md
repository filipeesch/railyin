## MODIFIED Requirements

### Requirement: runExecution uses task-scoped LSP registry
The system SHALL obtain `lspManager` from `TaskLSPRegistry` instead of constructing a new `LSPServerManager` directly. The `finally` block SHALL call `registry.getManager()` to reset the idle timer rather than shutting down the manager. Shutdown is delegated entirely to the registry (idle timeout or `releaseTask()`).

#### Scenario: LSP manager persists across executions for the same task
- **WHEN** a task runs two executions sequentially (e.g., retry or human turn)
- **THEN** the same `LSPServerManager` instance is reused for both executions without cold-starting

#### Scenario: LSP manager shuts down after task terminal state
- **WHEN** a task transitions to done or failed
- **THEN** `registry.releaseTask(taskId)` is called, shutting down the manager

### Requirement: runSubAgent shares parent execution's LSP manager
The system SHALL pass the parent execution's `lspManager` into `runSubAgent()` as a parameter instead of creating a new `LSPServerManager` inside the sub-agent. The sub-agent SHALL use the parent's manager in its `toolCtx`. No sub-agent shutdown call is needed.

#### Scenario: Sub-agent uses parent LSP manager
- **WHEN** `runSubAgent()` is called from within an execution that has an active LSP manager
- **THEN** the sub-agent's tool context contains the same manager instance as the parent

#### Scenario: Sub-agent LSP calls do not require extra cold-start
- **WHEN** the LSP server is already running for the parent execution and a sub-agent calls `lsp`
- **THEN** the request completes without a server startup delay

### Requirement: runSubAgent wraps LSP lifecycle in try/finally
The system SHALL wrap the entire `runSubAgent()` execution body (from manager assignment through return) in a `try/finally` block. Previously, exceptions between manager creation and the explicit `shutdown()` calls left the LSP subprocess running. Since sub-agents now use the parent's manager (no owned manager), the `finally` block ensures any sub-agent-specific cleanup always runs regardless of exception path.

#### Scenario: Exception during sub-agent execution does not leak resources
- **WHEN** an unhandled exception is thrown during `runSubAgent()` (e.g., API error, abort signal)
- **THEN** the `finally` block executes and no subprocess is leaked

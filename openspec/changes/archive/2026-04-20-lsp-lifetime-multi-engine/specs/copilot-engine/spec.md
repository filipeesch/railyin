## ADDED Requirements

### Requirement: Copilot engine wires lspManager into tool context
The system SHALL obtain a `LSPServerManager` from `TaskLSPRegistry` for the current task and pass it as `lspManager` in the `CommonToolContext` provided to `buildCopilotTools()`. The manager SHALL be obtained lazily (registry creates it on first access) and the registry entry SHALL persist across executions for the same task.

#### Scenario: LSP tool available when lsp configured
- **WHEN** a column's tools include `lsp` and the Copilot engine runs an execution
- **THEN** `buildCopilotTools()` registers the `lsp` tool with a live `lspManager` in context

#### Scenario: LSP tool returns error when lsp not configured
- **WHEN** the Copilot engine runs and `workspace.yaml` has no `lsp.servers`
- **THEN** calling the `lsp` tool returns "Error: LSP is not configured. Add lsp.servers to workspace.yaml."

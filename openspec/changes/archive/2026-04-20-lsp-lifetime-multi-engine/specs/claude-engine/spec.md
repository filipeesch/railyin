## ADDED Requirements

### Requirement: Claude engine exposes LSP via stdio MCP adapter
The system SHALL implement `src/bun/lsp/mcp-lsp-adapter.ts` as a standalone stdio MCP server process. The Claude engine's adapter SHALL register it in `mcpServers` with `worktreePath` and LSP server configs passed as CLI arguments. The MCP adapter SHALL create its own `LSPServerManager` (not from `TaskLSPRegistry`) and expose the full set of `lsp` tool operations through the MCP protocol.

#### Scenario: LSP operations available to Claude engine
- **WHEN** the Claude engine runs an execution and `workspace.yaml` has `lsp.servers` configured
- **THEN** the MCP LSP adapter is registered and the model can call `lsp` tool operations

#### Scenario: MCP adapter lifetime tied to Claude session
- **WHEN** the Claude session ends (done, cancelled, or error)
- **THEN** the MCP adapter process is terminated, shutting down its `LSPServerManager`

#### Scenario: LSP operations return same format as native engine
- **WHEN** the model calls `lsp(goToDefinition, ...)` via the Claude engine
- **THEN** the result uses the same text format as the native engine's `lsp` tool response

## Why

LSP servers cold-start on every agent execution (1–5s for TypeScript), sub-agent LSP processes leak on exceptions, and the Copilot and Claude engines have zero LSP support — meaning `lsp` tool calls silently fail for non-native engines. Additionally, the LSP operation set is limited to read-only navigation; high-value mutating operations (rename, format) that language servers already support are not exposed.

## What Changes

- **New `TaskLSPRegistry`** — task-scoped singleton map replacing per-execution `new LSPServerManager()`. Lazy initialization on first use, 10-minute idle timeout, explicit release on task terminal state.
- **Fix sub-agent LSP leak** — wrap `runSubAgent()` LSP manager in `try/finally`; pass parent manager to sub-agents (shared, no extra cold-start).
- **Unify LSP into `common-tools`** — move LSP tool definition and execution into `engine/common-tools.ts` and `engine/lsp-tool-definition.ts` so all engines get it from one source of truth.
- **Copilot engine LSP support** — wire `lspManager` from `TaskLSPRegistry` into `buildCopilotTools()` via `CommonToolContext`.
- **Claude engine LSP support via MCP bridge** — new stdio MCP adapter process (`src/bun/lsp/mcp-lsp-adapter.ts`) registered in Claude engine's `mcpServers`. Receives worktree path + config via CLI args.
- **New LSP operations** — `rename` (cross-file scope-aware symbol rename), `format` (whole-file formatting), `typeDefinition` (go to type of a value). All mutating ops share a new `applyWorkspaceEdit()` utility.
- **Rewritten LSP tool description** — behavioral ALWAYS/NEVER guidance replacing mechanical documentation.

## Capabilities

### New Capabilities

- `lsp-registry`: Task-scoped LSP server manager registry with lazy init and idle timeout
- `lsp-tool`: LSP tool exposed as a common tool across all engines, with full operation set including mutating ops

### Modified Capabilities

- `engine-common-tools`: LSP tool added to `COMMON_TOOL_DEFINITIONS` and `executeCommonTool()`; `CommonToolContext` gains optional `lspManager` field
- `copilot-engine`: `buildCopilotTools()` wired with `lspManager` from registry
- `claude-engine`: MCP LSP adapter added to `mcpServers` configuration
- `workflow-engine`: `runExecution()` and `runSubAgent()` use registry instead of ad-hoc `LSPServerManager` construction; sub-agent shares parent manager

## Impact

- `src/bun/lsp/registry.ts` — new file
- `src/bun/lsp/mcp-lsp-adapter.ts` — new file
- `src/bun/engine/lsp-tool-definition.ts` — new file
- `src/bun/engine/common-tools.ts` — LSP tool added
- `src/bun/engine/types.ts` — `CommonToolContext.lspManager` added
- `src/bun/engine/copilot/engine.ts` — registry wired in
- `src/bun/engine/copilot/tools.ts` — LSP tool registered
- `src/bun/engine/claude/adapter.ts` — MCP LSP adapter registered
- `src/bun/workflow/engine.ts` — registry usage, sub-agent fix
- `src/bun/workflow/tools.ts` — LSP description updated, new operations added
- `src/bun/lsp/manager.ts` — idle timeout support added
- No database schema changes. No breaking API changes.

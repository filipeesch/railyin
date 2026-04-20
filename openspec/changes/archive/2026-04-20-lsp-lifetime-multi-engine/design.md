## Context

The native engine (`workflow/engine.ts`) creates a fresh `LSPServerManager` at the start of every `runExecution()` call and shuts it down in the `finally` block — paying a 1–5s TypeScript server cold-start on every execution. `runSubAgent()` creates its own manager without `try/finally`, leaking the subprocess on exceptions. The Copilot and Claude engines have no LSP awareness at all; if a user configures `lsp` in column tools and runs either engine, the tool call silently fails.

The LSP operation set is also limited to read-only navigation. The language servers already support `rename`, `format`, and `typeDefinition` — we just haven't wired them up, including the `applyWorkspaceEdit()` layer needed to write results back to disk.

## Goals / Non-Goals

**Goals:**
- Eliminate per-execution LSP cold-start via task-scoped registry with lazy init and idle timeout
- Fix sub-agent LSP subprocess leak (`try/finally`)
- Expose LSP as a common tool available to all engines (native, Copilot, Claude)
- Add `rename`, `format`, `typeDefinition` operations
- Rewrite LSP tool description with behavioral ALWAYS/NEVER guidance

**Non-Goals:**
- LSP `codeAction` / `signatureHelp` (tracked in task #108, LSP v2)
- LSP `diagnostics` (push-based protocol, deferred)
- Per-language-server idle timeout configuration (global 10 min is sufficient for v1)

## Decisions

### D1: Task-scoped LSP registry (over workspace-scoped or per-execution)

A `TaskLSPRegistry` (`src/bun/lsp/registry.ts`) holds a `Map<taskId, { manager, idleTimer }>`. On first request for a task, the manager is created (lazy). On each request, the idle timer resets to 10 minutes. On timer expiry, `manager.shutdown()` is called and the entry is cleared — next use cold-starts again. On explicit `release(taskId)` (task terminal state), the timer is cancelled and the manager is shut down immediately.

**Why task-scoped over workspace-scoped:** Each task has its own worktree. A workspace singleton would require tracking which tasks share a worktree, complicate shutdown ordering, and risk cross-task LSP state contamination (file-open tracking, error state).

**Why task-scoped over per-execution:** The whole point of this change is to survive across executions for the same task (retry, human turn, follow-up). Task scope is the natural boundary.

**Why 10 minutes:** TypeScript server indexes the project on startup (expensive). 10 minutes covers typical human think-time between executions. Configurable per-server is a v2 concern.

### D2: Lazy initialization — server starts on first `request()` call

`LSPServerManager` already implements this (state machine: `idle → starting → running`). The registry wraps it: creating an entry does NOT spawn the process. The first tool call triggers `startServer()` internally; the model waits (up to 30s timeout already in `LSPClient`). No pre-warming.

**Why no pre-warming:** We don't know which files the model will touch until it calls `lsp`. Pre-warming would start servers for languages never used in a given execution.

### D3: Unify LSP into `engine/common-tools.ts` (Option A — full unification)

LSP tool definition moves to `src/bun/engine/lsp-tool-definition.ts` (mirrors `interview-tool-definition.ts`). `COMMON_TOOL_DEFINITIONS` gains `LSP_TOOL_DEFINITION`. `executeCommonTool()` gains the `case "lsp"` handler. `CommonToolContext` gains `lspManager?: LSPServerManager`.

The native engine's `workflow/tools.ts` keeps its own `case "lsp"` for now but imports `LSP_TOOL_DEFINITION` for the schema, eliminating duplication of the tool schema. The execution handler in `tools.ts` delegates to the same formatters. In a future cleanup the native `case "lsp"` can be removed once `executeTool()` delegates to `executeCommonTool()` — but that refactor is out of scope here.

**Why full unification over "extend only for SDK engines":** LSP description, parameter schema, and formatters are duplicated across `tools.ts` and `common-tools.ts` if we don't unify. With unification, one change to `lsp-tool-definition.ts` propagates everywhere.

### D4: Sub-agents share parent's `LSPServerManager`

`runSubAgent()` currently creates `subLspManager = new LSPServerManager(...)`. After this change, the parent's `lspManager` (from the registry) is passed into `runSubAgent()` as a parameter. The sub-agent uses it directly via `toolCtx`. No sub-agent shutdown call needed — the parent owns the lifecycle.

**Why shared over isolated:** Sub-agents operate on the same worktree as the parent. Sharing avoids an extra cold-start per sub-agent call and eliminates the leak risk entirely by removing sub-agent-owned manager state.

**Risk:** If a sub-agent triggers LSP server failure, the parent also loses LSP for the rest of the execution. Mitigation: `LSPServerManager` already handles `error` state with retry up to 3 consecutive failures — a single bad request doesn't kill the server.

### D5: Claude engine gets LSP via stdio MCP adapter

A new `src/bun/lsp/mcp-lsp-adapter.ts` process implements the MCP stdio transport, wrapping a `LSPServerManager`. The Claude engine's adapter registers it in `mcpServers` with `worktreePath` and LSP server config passed via CLI args.

The MCP adapter does NOT use `TaskLSPRegistry` — it's a separate process and can't share memory. It creates its own `LSPServerManager` that lives for the duration of the Claude session. This is fine: the Claude Agent SDK manages the MCP server process lifecycle per session, so LSP lifetime naturally aligns with session lifetime.

**Why not skip Claude LSP:** The user chose feature parity across engines as a requirement ("LSP should be at common tools for all engines").

**Why MCP over native tool injection:** Claude Agent SDK exposes tools exclusively via `mcpServers`. There is no mechanism to inject native tool handlers the way the native engine does.

### D6: `applyWorkspaceEdit()` — shared utility for all mutating ops

New function in `src/bun/workflow/tools.ts` (or `src/bun/lsp/apply-edits.ts`):

```
applyWorkspaceEdit(edit: WorkspaceEdit, worktreePath: string): ApplyResult
  → reads each file
  → applies TextEdits in reverse order (by range start, to preserve offsets)
  → writes each file back
  → returns { filesChanged: string[], summary: string } | { error: string }
```

LSP `WorkspaceEdit` uses `{ changes: { uri: TextEdit[] } }` or the newer `documentChanges` format. We support both. TextEdit ranges are zero-based (line, character); file reads use UTF-8.

### D7: New operations added to `lsp` tool

| Operation | LSP method | Returns |
|---|---|---|
| `typeDefinition` | `textDocument/typeDefinition` | Same formatter as `goToDefinition` |
| `rename` | `textDocument/rename` | Apply WorkspaceEdit, return files changed or error |
| `format` | `textDocument/formatting` | Apply TextEdit[], return "Formatted X lines" or error |

`prepareRename` is called before `rename` to validate the position and get the current name — fail fast with a clear message if the server rejects it.

## Risks / Trade-offs

- **[Risk] LSP server holds stale file state after external edits** → `LSPServerManager.ensureFileOpen()` already handles this via mtime tracking — re-opens stale files before requests. No new risk.

- **[Risk] 10-min idle timeout too short for long human-think pauses** → Manager cold-starts on next use. Cost is 1–5s delay, model waits transparently. Acceptable.

- **[Risk] MCP adapter process adds latency to Claude engine LSP calls** → stdio MCP transport adds ~1ms round-trip overhead. Negligible vs. LSP operation latency (50–500ms typical).

- **[Risk] `applyWorkspaceEdit()` offset errors on multi-byte characters** → Apply edits in reverse range order (last range first) to preserve character offsets. Use `Buffer.from(content, 'utf-8')` for byte-accurate slicing. Test with non-ASCII identifiers.

- **[Trade-off] Native engine keeps duplicate `case "lsp"` in `tools.ts`** → Accepted for v1 scope. The definition/schema is unified via `lsp-tool-definition.ts`; the handler duplication is a cleanup task for later.

## Migration Plan

No database changes. No API contract changes. Existing `lsp` tool calls continue to work identically — the registry is transparent to callers.

Deployment steps:
1. Deploy with `TaskLSPRegistry` in place — native engine picks it up automatically
2. No config changes required; `workspace.yaml` `lsp.servers` config is unchanged
3. Copilot and Claude engine LSP support is additive — no existing behavior breaks

Rollback: revert to per-execution `new LSPServerManager()` in `runExecution()` — one-line change.

## Open Questions

- Should `format` respect `.editorconfig` / prettier config, or purely use language server formatting? (LSP `textDocument/formatting` uses server defaults; prettier integration is out of scope for v1.)
- Should the MCP LSP adapter re-use the same port/process if two Claude sessions run on the same worktree? (No — each session gets its own MCP process. Shared-process optimization is v2.)

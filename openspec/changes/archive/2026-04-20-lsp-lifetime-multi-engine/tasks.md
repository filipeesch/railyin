## 1. Fix sub-agent LSP leak (try/finally)

- [x] 1.1 Wrap `runSubAgent()` body in `try/finally` in `src/bun/workflow/engine.ts`
- [x] 1.2 Remove the two explicit `subLspManager.shutdown()` calls (lines ~1039 and ~1115) — cleanup moves to `finally`

## 2. TaskLSPRegistry

- [x] 2.1 Create `src/bun/lsp/task-registry.ts` with `TaskLSPRegistry` class: `Map<taskId, { manager: LSPServerManager | null, idleTimer: Timer | null }>`
- [x] 2.2 Implement `getManager(taskId, serverConfigs, worktreePath)`: lazy create, reset 10-min idle timer, return manager
- [x] 2.3 Implement `releaseTask(taskId)`: cancel timer, shutdown manager, delete entry
- [x] 2.4 Export a module-level singleton `taskLspRegistry`

## 3. Migrate native engine to registry

- [x] 3.1 In `runExecution()`, replace `new LSPServerManager(...)` with `taskLspRegistry.getManager(taskId, ...)`
- [x] 3.2 Remove `lspManager?.shutdown()` from `runExecution()` `finally` block — registry owns lifetime
- [x] 3.3 In `runSubAgent()`, remove `new LSPServerManager(...)` and use `taskLspRegistry.getManager(taskId, ...)` when taskId is available
- [x] 3.4 Sub-agents share the parent's task-scoped manager via `taskLspRegistry`
- [ ] 3.5 Hook `registry.releaseTask(taskId)` into task terminal state transitions (done, failed)

## 4. LSP tool definition unification

- [x] 4.1 Create `src/bun/engine/lsp-tool-definition.ts` with `LSP_TOOL_DEFINITION` — full schema with ALWAYS/NEVER behavioral description and updated operation enum (add `typeDefinition`, `rename`, `format`)
- [x] 4.2 Update `src/bun/workflow/tools.ts` to import `LSP_TOOL_DEFINITION` instead of inline schema
- [x] 4.3 Add `LSP_TOOL_DEFINITION` to `COMMON_TOOL_DEFINITIONS` in `src/bun/engine/common-tools.ts`

## 5. applyWorkspaceEdit utility

- [x] 5.1 Implement `applyWorkspaceEdit(edit: WorkspaceEdit, worktreePath: string)` in `src/bun/lsp/apply-edits.ts` — handles both `changes` and `documentChanges` formats, applies TextEdits in reverse range order, returns `{ filesChanged, summary }` or `{ error }`

## 6. New LSP operations in native engine

- [x] 6.1 Add `typeDefinition` case to `executeLspTool()` in `src/bun/workflow/tools.ts` — `textDocument/typeDefinition` + `formatDefinition` formatter
- [x] 6.2 Add `rename` case: `prepareRename` validation → `textDocument/rename` → `applyWorkspaceEdit()`
- [x] 6.3 Add `format` case: `textDocument/formatting` → `applyWorkspaceEdit()`
- [x] 6.4 Add LSP types for `WorkspaceEdit`, `TextEdit`, `PrepareRenameResult` to `src/bun/lsp/types.ts`

## 7. CommonToolContext LSP + executeCommonTool

- [x] 7.1 Add `lspManager?: LSPServerManager` and `worktreePath?: string` to `CommonToolContext` in `src/bun/engine/types.ts`
- [x] 7.2 Add `case "lsp"` to `executeCommonTool()` in `src/bun/engine/common-tools.ts` — delegates to `executeLspTool()`

## 8. Copilot engine LSP wiring

- [x] 8.1 In `CopilotEngine._run()`, obtain `lspManager` from `taskLspRegistry.getManager(taskId, ...)` and add to `toolContext`
- [x] 8.2 `buildCopilotTools()` receives `CommonToolContext` with `lspManager` and `worktreePath`

## 9. Claude engine LSP wiring

- [x] 9.1 Claude LSP delivered via `COMMON_TOOL_DEFINITIONS` → `executeCommonTool` → `executeLspTool` path (same as Copilot). No separate MCP adapter needed.
- [x] 9.2 Claude engine wires `lspManager` + `worktreePath` into `commonToolContext` via `taskLspRegistry`

## 10. Tests

- [x] 10.1 Unit test `TaskLSPRegistry`: lazy init, idle timer reset, release cleanup, safe no-op release (`src/bun/test/lsp.test.ts`)
- [x] 10.2 Unit test `applyWorkspaceEdit`: single-file, multi-file, reverse-order edits, no-op, error cases (`src/bun/test/lsp.test.ts`)
- [ ] 10.3 Integration test: `rename` operation end-to-end (deferred — requires real LSP server process)

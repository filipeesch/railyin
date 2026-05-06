## Context

The `lsp` tool in `src/bun/engine/lsp-tool-definition.ts` is a single tool with an `operation` enum (11 variants) and 6 parameters — most of which are irrelevant to any given operation. This Swiss-knife interface creates decision overhead that discourages LLM use. The executor in `src/bun/workflow/tools/lsp-tools.ts` dispatches via a big switch statement, and all LSP operations share a single 100k-char result limit. The tool group `TOOL_GROUPS["lsp"]` maps to `["lsp"]`. All three engines (Pi, Claude, Copilot) consume it via `COMMON_TOOL_DEFINITIONS` in `common-tools.ts`.

`lsp_rename` is the only LSP operation that writes files. Pi already tracks file writes for undo via `UndoStack` in `pi/harness/undo-stack.ts`, with `WriteSnapshot` snapshots pushed before each write. The diff visualization for file writes flows via `details.writtenFiles: FileDiffPayload[]` from tool results through `event-translator.ts` → `EngineEvent.tool_result.writtenFiles` → `stream-processor.ts` → UI. The Myers diff implementation lives in `pi/tools/write.ts` alongside the Pi-specific write tools.

## Goals / Non-Goals

**Goals:**
- Replace the single `lsp` tool with 10 focused tools, each with only the parameters it needs
- Enable per-tool result limits and pagination on high-cardinality operations
- Integrate `lsp_rename` with Pi undo stack and diff visualization using existing mechanisms
- Keep workflow YAML untouched — `TOOL_GROUPS["lsp"]` expands in code

**Non-Goals:**
- Testing infrastructure (addressed separately)
- `lsp_apply_code_action` or `lsp_format` (documented as future; `applyWorkspaceEdit` already handles them)
- Frontend changes
- Workflow YAML changes

## Decisions

### 1. Naming: `lsp_` prefix + snake_case
All 10 tools use `lsp_` prefix with snake_case: `lsp_go_to_definition`, `lsp_find_references`, `lsp_document_symbols`, `lsp_workspace_symbols`, `lsp_hover`, `lsp_rename`, `lsp_incoming_calls`, `lsp_outgoing_calls`, `lsp_diagnostics`, `lsp_type_definition`.

*Why*: Consistent with all other common tool names. The LSP spec uses camelCase (`goToDefinition`) but that would be an outlier in this codebase. The `lsp_` prefix groups them visually and in YAML.

### 2. `prepareCallHierarchy` stays internal
`lsp_incoming_calls` and `lsp_outgoing_calls` call `prepareCallHierarchy` internally. It is not exposed as a standalone tool.

*Why*: It has no value on its own — models always need the follow-up step. Exposing it only adds noise.

### 3. Per-tool result limits
```
lsp_go_to_definition   → 100k
lsp_find_references    → 100k
lsp_document_symbols   → 100k
lsp_workspace_symbols  → 100k
lsp_hover              → 10k
lsp_rename             → 2k
lsp_incoming_calls     → 100k
lsp_outgoing_calls     → 100k
lsp_diagnostics        → 100k
lsp_type_definition    → 100k
```

*Why*: Rename returns a short summary. Hover is context-dense but compact. All others can return large result sets.

### 4. Pagination on high-cardinality tools
`lsp_find_references` and `lsp_workspace_symbols` accept `limit` (default 50/20) and `offset`. LSP servers don't guarantee stable ordering between calls — this caveat is documented in each tool's description.

*Why*: Large codebases can return hundreds of references. Without pagination, result truncation silently discards results.

### 5. `ToolExecutionResult` extended for file mutations
`ToolExecutionResult` (in `common-tools.ts`) gains:
```ts
writtenFiles?: FileDiffPayload[]     // for UI diff display
beforeFiles?: Record<string, string | null>  // for undo (null = file was new)
```
`applyWorkspaceEdit` in `src/bun/lsp/apply-edits.ts` is extended to capture `beforeContents` before writing and to compute `diffs` using a shared `computeFileDiff` utility.

*Why*: This follows the exact same mechanism Pi write tools already use. No new callback contracts, no coupling of LSP tools to Pi internals. The diff pipeline (`event-translator` → `stream-processor` → UI) works for free.

### 6. Myers diff extracted to `src/bun/utils/diff.ts`
The `myersDiff` and `buildFileDiff` functions move from `pi/tools/write.ts` to `src/bun/utils/diff.ts`. Both `write.ts` and the new `apply-edits.ts` path import from there.

*Why*: The diff algorithm is a general utility. Having it in Pi-land is an accident of history. Extracting it removes the only reason `applyWorkspaceEdit` (shared code) would need to import from Pi (engine code).

### 7. Pi undo integration via `pi/tools/common.ts`
`buildCommonTools` in `pi/tools/common.ts` is the only Pi-side bridge to common tools. After executing any common tool, it checks `result.beforeFiles`. If present, it pushes a `WriteSnapshot` to `undoStack` and appends the returned `op:XXXX` to the result text.

*Why*: Undo is Pi-specific. Doing the undo push in `pi/tools/common.ts` (already Pi-land) avoids coupling the shared `lsp-tools.ts` to `UndoStack`. Claude and Copilot engines ignore `beforeFiles` naturally — they don't pass a harness context.

### 8. `WriteSnapshot` extended with `lsp_rename` type
```ts
type WriteSnapshot =
  | { type: "write_file" | "patch_file" | "delete_file"; operationId: string; path: string; beforeContent: string | null }
  | { type: "rename_file"; operationId: string; path: string; toPath: string }
  | { type: "lsp_rename"; operationId: string; beforeFiles: Record<string, string | null> }
```
`undo_write` gains a `case "lsp_rename"` that iterates `beforeFiles` and restores each entry.

*Why*: `lsp_rename` is multi-file and atomic. It needs its own snapshot shape. Reusing the existing `WriteSnapshot` union keeps the undo stack homogeneous.

## Risks / Trade-offs

- **LSP offset instability** → Documented in tool description; pagination is best-effort. Acceptable for the use case.
- **Myers diff extraction** → `write.ts` is tested indirectly through write tool tests; extracting to utils requires verifying no behavior change. Mitigated: pure function, no side effects.
- **Multi-file undo atomicity** → `undo_write` for `lsp_rename` restores all files. If one file write fails mid-restore, others may have already been written. Mitigated: failures surface as error text; risk is low since these are in-worktree files under git.
- **`ToolExecutionResult` widening** → Adding optional fields is backward-compatible. All existing callers that check `result.type === "result"` and use `result.text` continue to work unchanged.

## Migration Plan

1. Extract `computeFileDiff` / `myersDiff` to `src/bun/utils/diff.ts`; update `write.ts` import
2. Extend `ApplyResult` in `apply-edits.ts`; extend `ToolExecutionResult` in `common-tools.ts`
3. Create `lsp-tool-definitions.ts`; refactor `lsp-tools.ts` into 10 executors
4. Wire into `common-tools.ts` (definitions + dispatch + display)
5. Update `registry.ts` and `context.ts`
6. Extend `undo-stack.ts` and `undo.ts`
7. Update `pi/tools/common.ts` to use `beforeFiles` and `writtenFiles`

Each step is independently deployable. The old `lsp` tool is removed in step 4 — no parallel period needed since this is a single-repo change.

## Open Questions

None — all decisions were made during the exploration phase.

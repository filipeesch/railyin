## Why

The current `lsp` tool exposes all LSP operations through a single entry point with an `operation` enum and 6 parameters — a Swiss-knife interface that models rarely use because the decision overhead is too high. Splitting it into ~10 focused tools with only the parameters each operation needs dramatically reduces that overhead and makes LLM adoption reliable.

## What Changes

- **BREAKING**: Remove the `lsp` tool definition and replace it with 10 focused tools: `lsp_go_to_definition`, `lsp_find_references`, `lsp_document_symbols`, `lsp_workspace_symbols`, `lsp_hover`, `lsp_rename`, `lsp_incoming_calls`, `lsp_outgoing_calls`, `lsp_diagnostics`, `lsp_type_definition`
- `lsp_find_references` and `lsp_workspace_symbols` gain `limit` and `offset` parameters for pagination
- Each tool gets its own entry in `TOOL_RESULT_LIMITS` (navigation/refs/symbols=100k, hover=10k, rename=2k)
- `TOOL_GROUPS["lsp"]` expands from `["lsp"]` to the 10 new tool names — no workflow YAML changes required
- `lsp_rename` integrates with the Pi undo stack via `writtenFiles`/`beforeFiles` on `ToolExecutionResult` — same mechanism already used by Pi write tools
- A `computeFileDiff` utility is extracted from `pi/tools/write.ts` to `src/bun/utils/diff.ts` so it can be used by `applyWorkspaceEdit` for LSP-originated diffs
- `prepareCallHierarchy` remains an internal implementation detail inside `lsp_incoming_calls` / `lsp_outgoing_calls`

## Capabilities

### New Capabilities
- `lsp-tools`: The 10 focused LSP tools — their names, parameters, result limits, pagination contract, and group membership in workflow config

### Modified Capabilities
- `engine-common-tools`: `ToolExecutionResult` gains optional `writtenFiles?: FileDiffPayload[]` and `beforeFiles?: Record<string, string | null>` fields; `applyWorkspaceEdit` in `src/bun/lsp/apply-edits.ts` gains `beforeContents` and `diffs` in its `ApplyResult` return type
- `write-undo-stack`: `WriteSnapshot` gains a new `type: "lsp_rename"` variant with a `beforeFiles: Record<string, string | null>` field; `undo_write` gains a `case "lsp_rename"` restore path that restores all files in `beforeFiles`

## Impact

- `src/bun/engine/lsp-tool-definition.ts` → renamed to `lsp-tool-definitions.ts`, exports array of 10 definitions
- `src/bun/engine/common-tools.ts` — 10 tool entries, 10 switch cases, 10 display entries; `ToolExecutionResult` extended
- `src/bun/workflow/tools/lsp-tools.ts` — 10 focused executor functions
- `src/bun/workflow/tools/registry.ts` — TOOL_GROUPS, TOOL_DESCRIPTIONS, TOOL_GROUP_LABELS
- `src/bun/conversation/context.ts` — TOOL_RESULT_LIMITS
- `src/bun/lsp/apply-edits.ts` — `ApplyResult` extended with `beforeContents` + `diffs`
- `src/bun/utils/diff.ts` — new file (Myers diff extracted from `write.ts`)
- `src/bun/engine/pi/tools/write.ts` — imports `computeFileDiff` from `utils/diff.ts`
- `src/bun/engine/pi/tools/common.ts` — uses `beforeFiles` for undo push, `writtenFiles` for `details`
- `src/bun/engine/pi/harness/undo-stack.ts` — new `WriteSnapshot` variant
- `src/bun/engine/pi/tools/undo.ts` — `case "lsp_rename"` restore logic
- No changes to workflow YAML files or frontend

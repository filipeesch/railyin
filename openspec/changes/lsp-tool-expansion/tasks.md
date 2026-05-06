## 1. Diff Utility Extraction

- [ ] 1.1 Create `src/bun/utils/diff.ts` by extracting `myersDiff`, `buildFileDiff`, and supporting types (`Hunk`, `HunkLine`) from `src/bun/engine/pi/tools/write.ts`; export `computeFileDiff(before: string, after: string, relPath: string, operation?: FileDiffPayload["operation"]): FileDiffPayload`
- [ ] 1.2 Update `src/bun/engine/pi/tools/write.ts` to import `computeFileDiff` / `myersDiff` from `src/bun/utils/diff.ts` and remove the local implementations

## 2. applyWorkspaceEdit Extension

- [ ] 2.1 Extend `ApplyResult` in `src/bun/lsp/apply-edits.ts` with `beforeContents: Record<string, string | null>` (absolute paths → prior content; `null` for new files) and `diffs: FileDiffPayload[]`
- [ ] 2.2 Update `applyWorkspaceEdit` to capture each file's content before writing (for `beforeContents`) and call `computeFileDiff` after writing (for `diffs`)

## 3. ToolExecutionResult Extension

- [ ] 3.1 Add optional `writtenFiles?: FileDiffPayload[]` and `beforeFiles?: Record<string, string | null>` fields to the `{ type: "result" }` branch of `ToolExecutionResult` in `src/bun/engine/common-tools.ts`

## 4. LSP Tool Definitions

- [ ] 4.1 Create `src/bun/engine/lsp-tool-definitions.ts` exporting an array of 10 focused tool definitions (`lsp_go_to_definition`, `lsp_find_references`, `lsp_document_symbols`, `lsp_workspace_symbols`, `lsp_hover`, `lsp_rename`, `lsp_incoming_calls`, `lsp_outgoing_calls`, `lsp_diagnostics`, `lsp_type_definition`) — each with only the parameters its operation needs; `lsp_find_references` and `lsp_workspace_symbols` include `limit` and `offset`
- [ ] 4.2 Delete `src/bun/engine/lsp-tool-definition.ts` (the old single-tool definition file)

## 5. LSP Tool Executors

- [ ] 5.1 Refactor `src/bun/workflow/tools/lsp-tools.ts` into 10 exported executor functions (one per tool); remove the monolithic `executeLspTool` switch; `lsp_rename` uses the extended `ApplyResult` to populate `writtenFiles` and `beforeFiles` on its `ToolExecutionResult`

## 6. Common Tools Wiring

- [ ] 6.1 In `src/bun/engine/common-tools.ts`: replace the single `LSP_TOOL_DEFINITION` import with the array from `lsp-tool-definitions.ts`; spread all 10 into `COMMON_TOOL_DEFINITIONS`
- [ ] 6.2 In `executeCommonToolText` / `executeCommonTool`: replace the single `case "lsp"` with 10 individual cases, each calling its dedicated executor
- [ ] 6.3 In `buildCommonToolDisplay`: add display entries for all 10 `lsp_*` tool names (label + icon)

## 7. Registry and Limits

- [ ] 7.1 Update `TOOL_GROUPS["lsp"]` in `src/bun/workflow/tools/registry.ts` to map to the array of all 10 `lsp_*` tool names
- [ ] 7.2 Add `TOOL_DESCRIPTIONS` entries for all 10 tools and update `TOOL_GROUP_LABELS["lsp"]` to `"LSP tools"`
- [ ] 7.3 Replace the single `["lsp", 100_000]` entry in `TOOL_RESULT_LIMITS` (`src/bun/conversation/context.ts`) with 10 per-tool entries (nav/refs/symbols=100k, hover=10k, rename=2k)

## 8. Pi Undo Stack Extension

- [ ] 8.1 Add `{ type: "lsp_rename"; operationId: string; beforeFiles: Record<string, string | null> }` variant to the `WriteSnapshot` union in `src/bun/engine/pi/harness/undo-stack.ts`
- [ ] 8.2 Add `case "lsp_rename"` restore logic to `undo_write` in `src/bun/engine/pi/tools/undo.ts`: iterate `beforeFiles`, write/delete each file appropriately, return `"OK: reverted lsp_rename [op:XXXX] — restored N files"`

## 9. Pi Common Tools Bridge

- [ ] 9.1 Update `buildCommonTools` in `src/bun/engine/pi/tools/common.ts` to accept an optional `harnessCtx` parameter; after each tool execution, if `result.beforeFiles` is present, push an `lsp_rename` snapshot to `undoStack` and append `[op:XXXX]` to `result.text`; always pass `result.writtenFiles` into `details.writtenFiles` when present
- [ ] 9.2 Update the call site in `src/bun/engine/pi/engine.ts` to pass `harnessCtx` to `buildCommonTools`

<!-- Tests are covered in the separate lsp-tool-expansion-tests change -->

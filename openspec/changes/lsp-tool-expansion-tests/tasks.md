## 1. Myers Diff Unit Tests

- [ ] 1.1 Create `src/bun/test/myers-diff.test.ts` with MD-1 through MD-6: import `computeFileDiff` from `src/bun/utils/diff.ts`; test identical content (empty diff), single line add, single line remove, single line replace, two non-adjacent changes (two hunks), empty-before/new-file case

## 2. applyWorkspaceEdit Extension Tests

- [ ] 2.1 Add AE-1 through AE-4 to the existing `describe("applyWorkspaceEdit")` block in `src/bun/test/lsp.test.ts`: test that `result.beforeContents[absPath]` captures the original content before edit, that new files get `null` in `beforeContents`, that `result.diffs` contains a correct `FileDiffPayload` (added/removed/hunks), and that an empty workspace edit yields `{}` / `[]`

## 3. LSP Executor Unit Tests

- [ ] 3.1 Update the existing `describe("executeLspTool")` block in `src/bun/test/lsp.test.ts`: replace the `lsp`/`executeCommonTool` dispatch test with `lsp_hover` as the new routing check; replace `executeLspTool` direct-import tests with per-executor function imports
- [ ] 3.2 Add ET-1 through ET-4 in `src/bun/test/lsp.test.ts`: path-outside-worktree error, 1→0-based coordinate conversion, `executeCommonTool` routing for `lsp_hover`, and missing `lspManager` error for any lsp_ tool
- [ ] 3.3 Add ET-5 through ET-7: `lsp_find_references` default limit=50, limit+offset slicing, `lsp_workspace_symbols` default limit=20 — all using `vi.fn()` mock returning arrays of the required size
- [ ] 3.4 Add ET-8 through ET-9: `lsp_rename` writes files to disk (verify `readFileSync` after call), result carries `writtenFiles` with one `FileDiffPayload`, `beforeFiles` has original content; empty WorkspaceEdit returns "No changes needed"
- [ ] 3.5 Add ET-10 through ET-12: `lsp_incoming_calls` internal `prepareCallHierarchy` call order, `lsp_diagnostics` formatted output, `lsp_document_symbols` nested symbol formatting

## 4. UndoStack lsp_rename Tests

- [ ] 4.1 Add US-10 through US-13 to `src/bun/test/pi-harness.test.ts`: push `lsp_rename` snapshot returns `op:XXXX`, `undoById` retrieves it with correct `beforeFiles`, `popByPath` returns `undefined` for a path that only appears in `lsp_rename.beforeFiles` keys, stack cap respected with mixed snapshot types

## 5. undo_write End-to-End Tests

- [ ] 5.1 Create `src/bun/test/undo-write.test.ts` with UW-1 through UW-7: no-args error, `write_file` restore by operationId (real temp files), unknown operationId error, `write_file` restore by path, `lsp_rename` restore all N files by operationId, `lsp_rename` with `null` entry deletes that file, path lookup does not find `lsp_rename` snapshot

## 6. Pi buildCommonTools Bridge Tests

- [ ] 6.1 Create `src/bun/test/pi-common-tools-bridge.test.ts` with PCB-1 through PCB-4: without `harnessCtx` → undo not pushed; with `harnessCtx` + `beforeFiles` → stack size becomes 1 and result text has `op:XXXX`; `writtenFiles` pass-through to `details.writtenFiles`; read-only tool (`lsp_hover`) → undo not pushed. Use mock `lspManager` injected via `ctx.runtime.lspManager` to return controlled `ToolExecutionResult` shapes

## 7. Registry and Limits Tests

- [ ] 7.1 Add TG-1 through TG-7 to `src/bun/test/tools.test.ts`: `TOOL_GROUPS["lsp"]` has exactly 10 `lsp_` names, `resolveToolsForColumn` resolves 10 tools, no `"lsp"` tool in `COMMON_TOOL_DEFINITIONS`, no `"lsp"` key in `TOOL_RESULT_LIMITS`, `lsp_hover`=10k, `lsp_rename`=2k, remaining 8 tools=100k

## 8. Common Tools Registration Tests

- [ ] 8.1 Add CR-1 through CR-4 to `src/bun/test/common-tools-registration.test.ts`: no `"lsp"` tool in definitions, exactly 10 `lsp_` entries, Copilot engine registers all 10, Claude engine registers all 10

## 9. Playwright Scenario

- [ ] 9.1 Add S-26 to `e2e/ui/tool-rendering.spec.ts`: construct a `tool_call` + `tool_result` pair where function name is `"lsp_rename"` and `result.writtenFiles` contains one `FileDiffPayload`; assert the UI renders a diff block with the expected added/removed stat badges (mirror the existing S-25 test structure)

## ADDED Requirements

### Requirement: Myers diff utility is directly tested
The extracted `computeFileDiff` function in `src/bun/utils/diff.ts` SHALL be tested as a pure function covering identity, single-line changes, multi-hunk changes, and new-file cases.

#### Scenario: MD-1 identical content produces empty diff
- **WHEN** `computeFileDiff` is called with identical before and after content
- **THEN** the result has `added=0`, `removed=0`, and `hunks=[]`

#### Scenario: MD-2 adding a line is reflected in hunks
- **WHEN** `computeFileDiff` is called where after has one more line than before
- **THEN** the result has `added=1`, `removed=0`, and one hunk with one `added` line entry

#### Scenario: MD-3 removing a line is reflected in hunks
- **WHEN** `computeFileDiff` is called where after has one fewer line than before
- **THEN** the result has `added=0`, `removed=1`, and one hunk with one `removed` line entry

#### Scenario: MD-4 replacing a line yields both added and removed
- **WHEN** `computeFileDiff` is called where one line is changed
- **THEN** the result has `added=1`, `removed=1`, and one hunk with both line types

#### Scenario: MD-5 non-adjacent changes produce two hunks
- **WHEN** `computeFileDiff` is called where two changes are separated by many unchanged lines
- **THEN** the result has two distinct hunks, each with its own `old_start`/`new_start`

#### Scenario: MD-6 empty before content marks file as new
- **WHEN** `computeFileDiff` is called with empty string as before and non-empty after
- **THEN** `is_new` is true OR `removed=0` and `added` equals the number of lines in after

---

### Requirement: undo_write execute logic is fully tested
The `undo_write` tool builder in `src/bun/engine/pi/tools/undo.ts` SHALL be tested end-to-end using real temp files and a minimal injected `HarnessContext`.

#### Scenario: UW-1 no args returns error
- **WHEN** `undo_write` is executed with neither `operationId` nor `path`
- **THEN** the result is an error containing "provide either operationId or path"

#### Scenario: UW-2 operationId of write_file snapshot restores file content
- **WHEN** a `write_file` snapshot is pushed to the undo stack and `undo_write` is called with its `operationId`
- **THEN** the file on disk is restored to its before content and the result contains "reverted"

#### Scenario: UW-3 unknown operationId returns error
- **WHEN** `undo_write` is called with an `operationId` that is not in the stack
- **THEN** the result is an error containing "no longer in undo history"

#### Scenario: UW-4 path lookup restores most recent write to that path
- **WHEN** a `write_file` snapshot for a path is in the stack and `undo_write` is called with that path
- **THEN** the file is restored to its before content

#### Scenario: UW-5 lsp_rename restore by operationId restores all files
- **WHEN** an `lsp_rename` snapshot with N `beforeFiles` entries is in the stack and `undo_write` is called with its `operationId`
- **THEN** all N files are written back to their before content on disk and the result text mentions the restored count

#### Scenario: UW-6 lsp_rename with null beforeFiles entry deletes that file
- **WHEN** an `lsp_rename` snapshot has a `beforeFiles` entry with `null` (file was newly created) and `undo_write` is called with its `operationId`
- **THEN** the newly created file is deleted from disk

#### Scenario: UW-7 path lookup does not match lsp_rename snapshot
- **WHEN** an `lsp_rename` snapshot is the only item in the stack whose `beforeFiles` keys include a given path and `undo_write` is called with that path
- **THEN** the result is an error containing "no more undo history" (path lookup does not traverse `beforeFiles`)

---

### Requirement: UndoStack handles lsp_rename variant correctly
The `UndoStack` class SHALL correctly push, retrieve, and manage snapshots of type `lsp_rename` alongside existing variants.

#### Scenario: US-10 push lsp_rename snapshot returns operationId
- **WHEN** an `lsp_rename` snapshot (with `beforeFiles`) is pushed to the stack
- **THEN** `push()` returns an `op:XXXX` string

#### Scenario: US-11 undoById retrieves lsp_rename snapshot
- **WHEN** an `lsp_rename` snapshot is pushed and `undoById` is called with its id
- **THEN** the returned snapshot has `type: "lsp_rename"` and the correct `beforeFiles`

#### Scenario: US-12 popByPath does not match lsp_rename snapshot
- **WHEN** an `lsp_rename` snapshot is the only item in the stack and `popByPath` is called with a path that appears in its `beforeFiles` keys
- **THEN** `popByPath` returns `undefined` (lsp_rename snapshots have no `.path` field)

#### Scenario: US-13 stack cap respected with mixed snapshot types
- **WHEN** lsp_rename and write_file snapshots are pushed beyond `maxSize`
- **THEN** the oldest entries are evicted regardless of type, and `size` never exceeds `maxSize`

---

### Requirement: Pi buildCommonTools bridge is tested for undo and writtenFiles passthrough
The `buildCommonTools` function in `src/bun/engine/pi/tools/common.ts` SHALL be tested to verify that `beforeFiles` on a tool result triggers an undo push and that `writtenFiles` is passed through to `details`.

#### Scenario: PCB-1 lsp_rename result without harnessCtx does not push undo
- **WHEN** `buildCommonTools` is called without `harnessCtx` and `lsp_rename` executes producing `beforeFiles`
- **THEN** no undo stack push occurs and `undoStack.size` remains 0

#### Scenario: PCB-2 lsp_rename result with harnessCtx pushes undo entry
- **WHEN** `buildCommonTools` is called with `harnessCtx` and `lsp_rename` executes producing `beforeFiles`
- **THEN** `undoStack.size` becomes 1 and the result text contains `op:XXXX`

#### Scenario: PCB-3 writtenFiles on result are passed through to details
- **WHEN** `buildCommonTools` is called with `harnessCtx` and a tool result contains `writtenFiles`
- **THEN** `details.writtenFiles` on the AgentTool result equals the `writtenFiles` from the tool result

#### Scenario: PCB-4 read-only lsp tool does not push undo
- **WHEN** `buildCommonTools` is called with `harnessCtx` and `lsp_hover` executes (no `beforeFiles` on result)
- **THEN** `undoStack.size` remains 0

---

### Requirement: applyWorkspaceEdit captures beforeContents and computes diffs
The `applyWorkspaceEdit` function SHALL be tested to verify the extended `ApplyResult` fields introduced in `lsp-tool-expansion`.

#### Scenario: AE-1 beforeContents captures original file content
- **WHEN** `applyWorkspaceEdit` edits a file with existing content
- **THEN** `result.beforeContents[absPath]` equals the original file content before the edit

#### Scenario: AE-2 beforeContents is null for newly created files
- **WHEN** `applyWorkspaceEdit` receives an edit that creates a new file (via `is_new` or empty range)
- **THEN** `result.beforeContents[absPath]` is `null`

#### Scenario: AE-3 diffs reflect actual changes as FileDiffPayload
- **WHEN** `applyWorkspaceEdit` edits a file replacing one word
- **THEN** `result.diffs` contains one `FileDiffPayload` with `added=1`, `removed=1`, and a non-empty `hunks` array

#### Scenario: AE-4 no-op edit yields empty beforeContents and diffs
- **WHEN** `applyWorkspaceEdit` is called with an empty workspace edit `{}`
- **THEN** `result.beforeContents` is `{}` and `result.diffs` is `[]`

---

### Requirement: LSP executor functions are unit tested for all 10 tools
Each of the 10 new `executeLsp*` functions SHALL be tested with a mock `lspManager` verifying path safety, coordinate conversion, correct LSP method call, and result formatting.

#### Scenario: ET-1 path outside worktree returns error for all executors
- **WHEN** any `executeLsp*` function is called with `file_path` outside the `worktreePath`
- **THEN** the result contains "Error: file_path is outside the worktree"

#### Scenario: ET-2 1-based coordinates are converted to 0-based for LSP requests
- **WHEN** an executor with `line=5, character=10` is called
- **THEN** `lspManager.request` is called with `position: { line: 4, character: 9 }`

#### Scenario: ET-3 executeCommonTool routes to each lsp_ tool correctly
- **WHEN** `executeCommonTool("lsp_hover", params, ctx)` is called with a mock `lspManager` in `ctx.runtime`
- **THEN** the mock `lspManager.request` is called with `"textDocument/hover"`

#### Scenario: ET-4 executeCommonTool returns error when lspManager absent for lsp_ tools
- **WHEN** `executeCommonTool("lsp_hover", params, ctx)` is called and `ctx.runtime.lspManager` is absent
- **THEN** the result text contains "Error: LSP is not configured"

#### Scenario: ET-5 lsp_find_references default limit slices to 50 items
- **WHEN** `executeLspFindReferences` is called without `limit` and the mock returns 100 locations
- **THEN** the formatted result contains exactly 50 location entries

#### Scenario: ET-6 lsp_find_references with limit and offset slices correctly
- **WHEN** `executeLspFindReferences` is called with `limit=5, offset=10`
- **THEN** the formatted result contains items 10 through 14 from the mock result

#### Scenario: ET-7 lsp_workspace_symbols default limit slices to 20 items
- **WHEN** `executeLspWorkspaceSymbols` is called without `limit` and the mock returns 50 symbols
- **THEN** the formatted result contains exactly 20 symbol entries

#### Scenario: ET-8 lsp_rename writes files to disk and returns writtenFiles
- **WHEN** `executeLspRename` is called and the mock `lspManager` returns a `WorkspaceEdit` changing one file
- **THEN** the file on disk is modified, the result carries `writtenFiles` with one `FileDiffPayload`, and `beforeFiles` contains the original content

#### Scenario: ET-9 lsp_rename with empty WorkspaceEdit returns no-change message
- **WHEN** `executeLspRename` is called and the mock returns an empty `WorkspaceEdit`
- **THEN** the result text contains "No changes needed" and `writtenFiles` is absent or empty

#### Scenario: ET-10 lsp_incoming_calls calls prepareCallHierarchy internally
- **WHEN** `executeLspIncomingCalls` is called
- **THEN** `lspManager.request` is called first with `"callHierarchy/prepare"` then with `"callHierarchy/incomingCalls"`

#### Scenario: ET-11 lsp_diagnostics formats diagnostic list from mock response
- **WHEN** `executeLspDiagnostics` is called and the mock returns two diagnostics
- **THEN** the result text contains both diagnostic messages formatted with severity and line

#### Scenario: ET-12 lsp_document_symbols formats nested symbol tree
- **WHEN** `executeLspDocumentSymbols` is called and the mock returns a nested symbol hierarchy
- **THEN** the result text reflects the tree structure with child symbols indented under parent

---

### Requirement: TOOL_GROUPS and TOOL_RESULT_LIMITS are verified for all 10 lsp_ tools
The registry and limits configuration SHALL be tested to confirm the lsp group expands to exactly 10 names and each tool has the correct result limit.

#### Scenario: TG-1 TOOL_GROUPS lsp expands to 10 names
- **WHEN** `TOOL_GROUPS["lsp"]` is read
- **THEN** it contains exactly 10 entries all starting with `lsp_`

#### Scenario: TG-2 resolveToolsForColumn with lsp group resolves 10 tools
- **WHEN** a workflow column lists `lsp` as a tool group and `resolveToolsForColumn` is called
- **THEN** exactly 10 lsp_ tools are in the resolved set

#### Scenario: TG-3 no tool named lsp exists
- **WHEN** `COMMON_TOOL_DEFINITIONS` is inspected
- **THEN** no entry with `name: "lsp"` exists

#### Scenario: TG-4 TOOL_RESULT_LIMITS has no lsp entry
- **WHEN** `TOOL_RESULT_LIMITS` is inspected
- **THEN** no entry with key `"lsp"` exists

#### Scenario: TG-5 lsp_hover has 10k result limit
- **WHEN** `TOOL_RESULT_LIMITS["lsp_hover"]` is read
- **THEN** the value is 10_000

#### Scenario: TG-6 lsp_rename has 2k result limit
- **WHEN** `TOOL_RESULT_LIMITS["lsp_rename"]` is read
- **THEN** the value is 2_000

#### Scenario: TG-7 all other lsp_ tools have 100k result limit
- **WHEN** each of the 8 remaining lsp_ tools is looked up in `TOOL_RESULT_LIMITS`
- **THEN** each value is 100_000

---

### Requirement: All 10 lsp_ tools are registered in all engines
The tool registration test SHALL verify that `COMMON_TOOL_DEFINITIONS` contains all 10 lsp_ entries and that each engine sees them.

#### Scenario: CR-1 COMMON_TOOL_DEFINITIONS has no entry named lsp
- **WHEN** `COMMON_TOOL_DEFINITIONS` is inspected
- **THEN** no tool with `name: "lsp"` exists

#### Scenario: CR-2 COMMON_TOOL_DEFINITIONS has exactly 10 lsp_ entries
- **WHEN** `COMMON_TOOL_DEFINITIONS` is filtered to names starting with `lsp_`
- **THEN** exactly 10 entries are returned

#### Scenario: CR-3 Copilot engine registers all 10 lsp_ tools
- **WHEN** the Copilot engine is initialized with a context that has `lspManager`
- **THEN** all 10 lsp_ tool names appear in the engine's registered tool set

#### Scenario: CR-4 Claude engine registers all 10 lsp_ tools
- **WHEN** the Claude engine is initialized with a context that has `lspManager`
- **THEN** all 10 lsp_ tool names appear in the engine's registered tool set

---

### Requirement: lsp_rename diff rendering is verified in Playwright
The Playwright test suite SHALL include a scenario that verifies `lsp_rename` tool results with `writtenFiles` render as file diffs in the conversation UI.

#### Scenario: S-26 lsp_rename tool result with writtenFiles renders diff
- **WHEN** the conversation contains a `tool_result` message for `lsp_rename` with a `writtenFiles` payload containing one `FileDiffPayload`
- **THEN** the UI renders a file diff block showing the added and removed line counts and the diff hunks

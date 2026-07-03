## Why

The Cursor engine's tool call rendering is broken: collapsible headers show no tool name, no file path, and no command. When expanded, shell output is truncated and edit/write results show no diff preview. This happens because the Cursor SDK sends lowercase tool names (`"read"`, `"shell"`, `"edit"`) but the display builder checks PascalCase (`"Read"`, `"Shell"`, `"Edit"`), so zero matches occur. Additionally, structured result data (`stdout`, `diffString`) is flattened to plain strings, preventing the frontend from rendering rich content.

## What Changes

- **FIX**: `buildCursorToolDisplay` matches lowercase SDK tool names (`read`, `shell`, `write`, `edit`, `delete`, `glob`, `grep`) so display metadata is always emitted
- **ENHANCE**: `normalizeCursorToolResult` extracts `stdout` from shell results into `detailedResult` (mirrors Copilot's approach)
- **ENHANCE**: Edit/write results with `diffString` are parsed into `writtenFiles` with hunks for file-diff rendering
- **ENHANCE**: `tool_result` events carry `display`, `detailedResult`, `contentBlocks`, and `writtenFiles` from translation time (not post-hoc)
- **REFACTOR**: Extract `translateCursorMessage`, `normalizeCursorToolResult`, `unwrapCursorToolName`, and `buildCursorToolDisplay` into a shared `translate-events.ts` module to eliminate duplication between `events.ts` and `worker.mjs`
- **REFACTOR**: Create shared `src/bun/engine/diff-utils.ts` with `parseUnifiedDiff()` — used by both Copilot and Cursor engines
- **REFACTOR**: Add `toolStartWithDisplay()` and `toolResultWithStructuredData()` step builders to `MockCursorSdkAdapter` in `mocks.ts`
- **REMOVE**: Engine `_run()` display fallback for `tool_start` (no longer needed; display is built at translation time)

## Capabilities

### New Capabilities
- `cursor-rendering`: Tool call display metadata, structured result extraction (stdout, diffs), and deduplicated translation module

### Modified Capabilities
- `cursor-sdk`: Enhanced streaming event translation — `tool_start` events MUST include `display` metadata; `tool_result` events MUST include `detailedResult` for shell stdout and `writtenFiles` with hunks for edit/write diffString

## Impact

- **Files changed**: `src/bun/engine/cursor/translate-events.ts` (new), `src/bun/engine/cursor/translate-events.test.ts` (new), `src/bun/engine/cursor/events.ts` (rewrite to delegate to shared module), `src/bun/engine/cursor/worker.mjs` (use shared translation), `src/bun/engine/cursor/engine.ts` (remove display fallback), `src/bun/engine/diff-utils.ts` (new), `src/bun/engine/cursor/mocks.ts` (add step builders), `src/bun/engine/cursor/translate-consistency.test.ts` (new), `src/bun/test/support/shared-rpc-scenarios.ts` (add cursor-specific variants), `src/bun/test/cursor/rpc-scenarios.test.ts` (add cursor tool scenarios)
- **No API or schema changes** — EngineEvent and StreamEvent types already support `display`, `detailedResult`, `contentBlocks`, and `writtenFiles`
- **No frontend changes** — the UI already renders all these fields
- **No breaking changes** — all changes are additive or fix incorrect silent behavior

## Test Scenarios

### Unit Tests (4 test files — 3 new, 1 existing extended)

#### `translate-events.test.ts` (NEW)

**`buildCursorToolDisplay` — lowercase matching (15 scenarios)**
| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| 1 | `read` with `path` | `"read", {path:"/repo/src/foo.ts"}` | `{label:"read", subject:"src/foo.ts", contentType:"file"}` |
| 2 | `read` with `file_path` | `"read", {file_path:"/repo/src/bar.ts"}` | `{label:"read", subject:"src/bar.ts"}` |
| 3 | `shell` with `command` | `"shell", {command:"ls -la"}` | `{label:"bash", subject:"ls -la", contentType:"terminal"}` |
| 4 | `shell` with `cmd` | `"shell", {cmd:"echo hi"}` | `{label:"bash", subject:"echo hi"}` |
| 5 | `edit` with `path` | `"edit", {path:"/repo/src/baz.ts"}` | `{label:"edit", subject:"src/baz.ts", contentType:"file"}` |
| 6 | `MultEdit` → edit | `"MultEdit", {path:"/repo/src/baz.ts"}` | `{label:"edit", subject:"src/baz.ts"}` |
| 7 | `write` with `path` | `"write", {path:"/repo/src/new.ts"}` | `{label:"write", subject:"src/new.ts"}` |
| 8 | `delete` with `path` | `"delete", {path:"/repo/src/old.ts"}` | `{label:"delete", subject:"src/old.ts"}` |
| 9 | `glob` with `pattern` | `"glob", {pattern:"src/**/*.ts"}` | `{label:"glob", subject:"src/**/*.ts"}` |
| 10 | `grep` with `query` | `"grep", {query:"TODO"}` | `{label:"grep", subject:"TODO"}` |
| 11 | `grep` with `pattern` | `"grep", {pattern:"TODO"}` | `{label:"grep", subject:"TODO"}` |
| 12 | Unknown tool → humanized | `"unknown_tool", {}` | `{label:"unknown tool"}` |
| 13 | `railyin_shell` → bash | `"railyin_shell", {command:"ls"}` | `{label:"bash", subject:"ls", contentType:"terminal"}` |
| 14 | `railyin_read` → read | `"railyin_read", {path:"/repo/f.ts"}` | `{label:"read", subject:"f.ts", contentType:"file"}` |
| 15 | `mcp` envelope unwrapping | `"mcp", {toolName:"read", args:{path:"/repo/f.ts"}}` | `{label:"read", subject:"f.ts"}` |

**`extractStructuredResult` — structured data extraction (7 scenarios)**
| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| 1 | Shell stdout → detailedResult | `{value:{exitCode:0, stdout:"hello"}}` | `{detailedResult:"hello"}` |
| 2 | Shell stdout + stderr → detailedResult | `{value:{stdout:"out", stderr:"err"}}` | `{detailedResult:"out\nerr"}` |
| 3 | Edit diffString → writtenFiles with hunks | `{value:{linesAdded:1,linesRemoved:1,diffString:"--- ...\n..."}}` | `{writtenFiles:[{path:"src/foo.ts",operation:"edit_file",hunks:[...]}]}` |
| 4 | Write diffString → writtenFiles | `{value:{linesAdded:5,linesRemoved:0,diffString:"--- /dev/null\n..."}}` | `{writtenFiles:[{operation:"write_file",hunks:[...]}]}` |
| 5 | Delete empty value → "(file deleted)" | `{value:{}}` | `{detailedResult:"(file deleted)"}` |
| 6 | Read content → detailedResult | `{value:{content:"file content"}}` | `{detailedResult:"file content"}` |
| 7 | Unknown → JSON stringify fallback | `{value:{message:"error"}}` | `{detailedResult:"{...}"}` |

**`translateCursorMessage` — end-to-end event shapes (6 scenarios)**
| # | Scenario | SDK Input | EngineEvent Expected |
|---|----------|-----------|---------------------|
| 1 | Shell running → tool_start with display | `{name:"shell",status:"running",args:{command:"ls"}}` | `{type:"tool_start",display:{label:"bash",subject:"ls",contentType:"terminal"}}` |
| 2 | Shell completed → tool_result with detailedResult | `{name:"shell",status:"completed",result:{value:{stdout:"out"}}}` | `{type:"tool_result",detailedResult:"out"}` |
| 3 | Edit completed → tool_result with writtenFiles | `{name:"edit",status:"completed",result:{value:{diffString:"--- ...\n..."}}}` | `{type:"tool_result",writtenFiles:[{path:"src/foo.ts",hunks:[...]}]}` |
| 4 | Delete completed → tool_result empty handled | `{name:"delete",status:"completed",result:{value:{}}}` | `{type:"tool_result"}` |
| 5 | Read completed → tool_result with content | `{name:"read",status:"completed",result:{value:{content:"hello"}}}` | `{type:"tool_result"}` |
| 6 | MCP envelope unwrapping | `{name:"mcp",args:{toolName:"updateTodos"},status:"running"}` | `{type:"tool_start",name:"updateTodos",display:{label:"update todos"}}` |

#### `translate-consistency.test.ts` (NEW)

| # | Scenario | What |
|---|----------|------|
| 1 | Bun vs Node tool_start for shell | Shared module and worker.mjs produce identical events |
| 2 | Bun vs Node tool_result for edit | detailedResult and writtenFiles match exactly |

#### `mocks.ts` extension

Step builders added: `toolStartWithDisplay(callId, name, args, display)`, `toolResultWithStructuredData(callId, result, detailedResult?, writtenFiles?)`

### Integration Tests (2 new scenarios in existing test files)

**`shared-rpc-scenarios.ts` — add:**
| # | Scenario | What it validates |
|---|----------|-------------------|
| 1 | `runCursorShellToolScenario` | tool_call has `display.label === "bash"`, tool_result has `detailedResult` with stdout |
| 2 | `runCursorEditToolScenario` | tool_call has `display.label === "edit"`, tool_result has `writtenFiles` with parsed hunks, file_diff stream event emitted |

**`cursor/rpc-scenarios.test.ts` — add:**
| # | Scenario | What it validates |
|---|----------|-------------------|
| 1 | Shell tool with stdout extraction | End-to-end via MockCursorSdkAdapter → CursorEngine |
| 2 | Edit tool with diff parsing | End-to-end via MockCursorSdkAdapter → CursorEngine |

### Playwright Tests (6 new scenarios)

**`cursor.spec.ts` — add:**
| # | ID | Scenario | What |
|---|----|----------|------|
| 1 | CU-3.1 | Shell tool shows command in collapsible | `.tc__tool-name` contains "bash", `.tc__primary-arg` contains "ls -la" |
| 2 | CU-3.2 | Read tool shows file path | `.tc__primary-arg` contains "foo.ts" |

**`tool-rendering.spec.ts` — add:**
| # | ID | Scenario | What |
|---|----|----------|------|
| 3 | S-29 | Cursor shell command in subject | Mocked tool_call renders command in collapsible header |
| 4 | S-30 | Cursor read file in subject | Mocked tool_call renders file path in collapsible header |
| 5 | S-31 | Cursor edit diff renders stat badges | `writtenFiles` with hunks → +N/-N badges on collapsible |
| 6 | S-32 | Cursor write diff renders stat badges | Same as S-31 for write operation |
| 7 | S-33 | Cursor delete shows "(file deleted)" | Empty result → text shown when expanded |

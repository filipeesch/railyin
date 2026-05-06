## Context

`lsp-tool-expansion` introduces 10 new tool executors, extends `applyWorkspaceEdit`, extracts the Myers diff utility, adds an `lsp_rename` variant to Pi's `WriteSnapshot` union, and adds a `buildCommonTools` bridge for undo tracking. None of the new production components have dedicated tests today — the existing `lsp.test.ts` covers formatters and the legacy dispatcher, `undo.ts` has zero test coverage, and the Myers diff implementation has never been tested in isolation.

All components are already written with dependency injection: executor functions take `lspManager` + `worktreePath` params, `applyWorkspaceEdit` takes a `workspacePath`, `undo_write` takes a `HarnessContext`, and `buildCommonTools` takes an optional `harnessCtx`. No production code changes are required for testability.

The test suite runs entirely with `bun test src/bun/test --timeout 20000` (unit/integration, using `initDb()` for in-memory SQLite where needed) and `bun run build && npx playwright test e2e/ui` (Playwright, using mock API fixtures).

## Goals / Non-Goals

**Goals:**
- Cover all 10 new lsp_ executor functions with unit tests (path safety, 1-based→0-based conversion, correct LSP method, result formatting)
- Cover `lsp_rename` specifically: files written to disk, `writtenFiles` payload populated, `beforeContents` captured
- Cover `applyWorkspaceEdit` extensions: `beforeContents` correct for existing/new files, `diffs` match actual changes
- Cover `computeFileDiff` (extracted Myers diff) as a pure function
- Cover `undo_write` execute logic end-to-end including the new `lsp_rename` restore path
- Cover `UndoStack` with `lsp_rename` variant snapshots
- Cover the Pi `buildCommonTools` bridge: undo push, `writtenFiles` passthrough, no-op for read-only tools
- Cover TOOL_GROUPS, TOOL_RESULT_LIMITS, and tool registration for all 10 tools
- Cover `lsp_rename` diff rendering in Playwright (S-26)

**Non-Goals:**
- Testing against a real LSP server (all tests use `mockManager` with `vi.fn()`)
- Mutation testing
- Performance benchmarks for the Myers diff algorithm
- Testing the UI components for tool rendering (only the pipeline integration via existing mock API fixture)

## Decisions

### 1. No new production code for testability — DI is already in place

All components accept their dependencies via parameters. Tests construct minimal mock objects inline (`{ request: vi.fn(), shutdown: () => {} }` for `lspManager`; `{ undoStack: new UndoStack(), hashCache: { invalidate: vi.fn() }, worktreePath: dir }` for `HarnessContext`). No `vi.mock()` module-level patching needed anywhere in this test suite.

*Why*: Consistent with the codebase's existing injection pattern. Module-level mocking is fragile and obscures the test's intent.

### 2. `undo.ts` gets its own test file (`undo-write.test.ts`)

`undo_write` is a standalone tool builder that takes `HarnessContext` and returns an `AgentTool`. Its `execute` function can be exercised directly with a real `UndoStack` + real temp files — no orchestrator needed. This is the natural place to verify the `lsp_rename` restore path (UW-5 through UW-7).

*Why*: `pi-harness.test.ts` tests `UndoStack` as a data structure. `undo-write.test.ts` tests the full `undo_write` execute path including file system effects. These are different concerns.

### 3. `buildCommonTools` bridge gets its own test file (`pi-common-tools-bridge.test.ts`)

The bridge in `pi/tools/common.ts` wraps `executeCommonTool`. Testing it requires stubbing `executeCommonTool` or injecting a controlled result. Since the bridge calls `executeCommonTool` internally, the test constructs a minimal context with a mock `lspManager` that returns a controlled result — exercising the actual bridge logic without invoking a real LSP server.

*Why*: `common-tools-registration.test.ts` only checks that tools are declared. The bridge test checks that `beforeFiles` on the result causes an undo push, and that `writtenFiles` flows through to `details`. Different concern, separate file.

### 4. `applyWorkspaceEdit` tests extended in existing `lsp.test.ts`

The existing `describe("applyWorkspaceEdit")` block in `lsp.test.ts` has 6 solid cases. The 4 new cases (AE-1 through AE-4) test the extended `ApplyResult` fields. Adding them to the existing block keeps all `applyWorkspaceEdit` coverage co-located.

*Why*: No reason to split these into a new file — they test the same function.

### 5. `computeFileDiff` gets its own test file (`myers-diff.test.ts`)

Once extracted to `src/bun/utils/diff.ts`, the function is a pure utility with no dependencies. Six cases (MD-1 through MD-6) verify the diff algorithm's output structure. These are fast, deterministic, and completely isolated.

*Why*: The diff algorithm has never been directly tested. The extraction is the natural trigger to add direct coverage.

### 6. Playwright: S-26 added to `tool-rendering.spec.ts`

The existing S-25 scenario tests `edit_file` + `writtenFiles` → diff rendered. S-26 is identical structure but uses `lsp_rename` as the tool name. This verifies the pipeline works when `writtenFiles` originates from an LSP tool rather than a Pi write tool. The mock fixture already handles `writtenFiles` in tool_result content.

*Why*: Visual regression on the diff rendering for the new tool. Costs one scenario, catches any display-layer breakage.

## Risks / Trade-offs

- **Test ordering within `lsp.test.ts`** — The file is already long. The 12 new executor tests and 4 new `applyWorkspaceEdit` tests will lengthen it further. If it becomes unwieldy, executor tests can be split into `lsp-executors.test.ts` — but that's a future refactor, not a requirement here.
- **`undo_write` tests use real temp files** — Same pattern as existing `lsp.test.ts`. `mkdtempSync` + `rmSync` in `beforeEach/afterEach`. Already proven reliable in the test suite.
- **`buildCommonTools` bridge test stub** — The bridge calls `executeCommonTool` from `common-tools.ts`. Stubbing this requires either a real context with a mock `lspManager` or a `vi.mock`. Prefer the real-context approach (inject mock `lspManager` via `ctx.runtime.lspManager`) to avoid module-level mocking. This is consistent with existing executor tests.
- **LSP offset instability caveat** — Pagination tests (`ET-ref-pagination`) use a deterministic mock that returns a fixed ordered array. Real LSP servers don't guarantee order, but the mock does. This is acceptable — the caveat is documented in the tool description, not enforced in tests.

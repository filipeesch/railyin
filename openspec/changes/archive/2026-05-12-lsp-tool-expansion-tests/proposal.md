## Why

The `lsp-tool-expansion` change splits the monolithic `lsp` tool into 10 focused tools, extends `ToolExecutionResult` with `writtenFiles`/`beforeFiles`, extracts the Myers diff utility, and adds an `lsp_rename` undo path to Pi's `WriteSnapshot` union. None of these components have direct unit tests today — the existing `lsp.test.ts` covers formatters and the legacy dispatcher but has no executor-level tests, `undo.ts` is completely untested, and the Myers diff in `write.ts` has never been tested in isolation.

This change adds the full test suite for `lsp-tool-expansion`: unit tests for each new executor function, `applyWorkspaceEdit` extensions, Myers diff utility, undo stack variants, the Pi common tools bridge, registry wiring, and a Playwright scenario for `lsp_rename` diff rendering.

## What Changes

- New unit test file: `src/bun/test/myers-diff.test.ts` — tests the extracted `computeFileDiff` pure function (MD-1 through MD-6)
- New unit test file: `src/bun/test/undo-write.test.ts` — tests `undo_write` execute logic end-to-end, including the new `lsp_rename` restore path (UW-1 through UW-7)
- New unit test file: `src/bun/test/pi-common-tools-bridge.test.ts` — tests `buildCommonTools` bridge: undo push on `beforeFiles`, passthrough of `writtenFiles`, no-op for read-only tools (PCB-1 through PCB-4)
- Extended: `src/bun/test/lsp.test.ts` — updated dispatcher tests + new executor tests for all 10 tools including pagination and `writtenFiles` on `lsp_rename` (ET-1 through ET-12)
- Extended: `src/bun/test/lsp.test.ts` — `applyWorkspaceEdit` cases for `beforeContents` capture and `diffs` output (AE-1 through AE-4)
- Extended: `src/bun/test/pi-harness.test.ts` — `UndoStack` scenarios for the new `lsp_rename` variant (US-10 through US-13)
- Extended: `src/bun/test/tools.test.ts` — TOOL_GROUPS and TOOL_RESULT_LIMITS assertions for 10 lsp_ tools (TG-1 through TG-7)
- Extended: `src/bun/test/common-tools-registration.test.ts` — verifies all 10 lsp_ tools are registered across all engines (CR-1 through CR-4)
- Extended: `e2e/ui/tool-rendering.spec.ts` — new scenario S-26: `lsp_rename` tool result with `writtenFiles` renders as file diff

## Capabilities

### New Capabilities
- `lsp-tool-expansion-tests`: All test scenarios covering the 10 new lsp_ executor functions, `applyWorkspaceEdit` extensions, Myers diff extraction, Pi undo stack `lsp_rename` variant, `buildCommonTools` bridge, registry wiring, and Playwright diff rendering

## Impact

- `src/bun/test/myers-diff.test.ts` — new file
- `src/bun/test/undo-write.test.ts` — new file
- `src/bun/test/pi-common-tools-bridge.test.ts` — new file
- `src/bun/test/lsp.test.ts` — extended (dispatcher update + 16 new cases)
- `src/bun/test/pi-harness.test.ts` — extended (4 new UndoStack cases)
- `src/bun/test/tools.test.ts` — extended (7 new assertions)
- `src/bun/test/common-tools-registration.test.ts` — extended (4 new assertions)
- `e2e/ui/tool-rendering.spec.ts` — extended (1 new scenario)
- Depends on: `lsp-tool-expansion` (all production code must be in place before tests can run)

## Why

The `fix-note-tools-on-pi` change fixes note tool availability on Pi engine and adds an `update_note` empty-content guard — but there are no dedicated tests for note tool execution, `NoteRepository` CRUD, or the `buildToolAllowlist()` helper being introduced. Without tests, the bug could silently regress and the new validation behavior has no coverage. This change introduces the full test suite to lock in correctness.

## What Changes

- **New `note-repository.test.ts`**: Unit tests for `NoteRepository` CRUD with in-memory DB — create, list, update, delete, and scoping.
- **New `note-tools.test.ts`**: Unit tests for `executeCommonTool` dispatching `create_note`, `list_notes`, and `update_note`, including all validation paths.
- **Extend `common-tools-registration.test.ts`**: Add structure assertions for note tool definitions (required parameters, presence in `COMMON_TOOL_NAMES`).
- **Extend `pi-session-tools-integration.test.ts`**: Add `buildToolAllowlist()` unit tests and Pi SDK session tests verifying note tool names appear in the active tool set.

## Capabilities

### New Capabilities

_(none — test coverage only)_

### Modified Capabilities

- `pi-engine-tests`: Add `buildToolAllowlist` unit tests and Pi SDK session note tool allowlist assertions.
- `task-note-tools`: Add `NoteRepository` CRUD tests and `executeCommonTool` dispatch tests for all three note tools including validation paths.

## Impact

- **`src/bun/test/note-repository.test.ts`** (new): 8 scenarios for `NoteRepository`.
- **`src/bun/test/note-tools.test.ts`** (new): ~12 scenarios for `executeCommonTool` note dispatch.
- **`src/bun/test/common-tools-registration.test.ts`** (extended): 4 note tool definition structure assertions.
- **`src/bun/test/pi-session-tools-integration.test.ts`** (extended): 4 `buildToolAllowlist` unit tests + 3 Pi SDK session note tool allowlist tests.
- No production code changes. All tests use in-memory DB via `initDb()` or faux provider — no network calls.

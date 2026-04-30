## Why

The `boards-management-tab-refactor` change introduces backend handlers (`boards.update`, `boards.delete`), a board store with new actions (`updateBoard`, `deleteBoard`), and two new frontend components (`BoardDetailDialog.vue`, `BoardSetupTab.vue`). None of this code has automated test coverage. This change adds the full test suite: backend unit tests with in-memory SQLite, store unit tests with a mocked RPC layer, and Playwright UI tests with the existing mock-api intercept infrastructure.

## What Changes

- **`src/bun/test/boards.test.ts`** (NEW): Backend handler unit tests for `boards.list` (with taskCount), `boards.create` (regression), `boards.update` (all field combinations, validation), `boards.delete` (empty board, board with tasks, count in error message)
- **`src/mainview/stores/board.test.ts`** (NEW): Pinia store unit tests for `updateBoard` and `deleteBoard` actions — API call verification, optimistic state management, error propagation
- **`e2e/ui/board-setup.spec.ts`** (NEW): Playwright UI tests covering the full board lifecycle in the Setup view — list rendering, add dialog, edit dialog, workflow-change warning, delete (toast for boards with tasks, confirm dialog for empty boards), error handling
- **`e2e/ui/fixtures/setup-helpers.ts`** (NEW): Shared `goToSetup()` helper extracted from `workspace-settings.spec.ts`; re-imported there to eliminate duplication
- **`e2e/ui/fixtures/mock-data.ts`** (MODIFIED): `makeBoard()` updated to include `taskCount: 0` as default; used in `makeBoard({ taskCount: 3 })` patterns for task-presence scenarios
- **`e2e/ui/workspace-settings.spec.ts`** (MODIFIED): Import `goToSetup` from `setup-helpers.ts` instead of defining it locally

## Capabilities

### New Capabilities

- `board-management-tests`: Test coverage for the board management UI and backend — backend handler tests, store tests, and Playwright UI tests for all board CRUD scenarios

### Modified Capabilities

_(none — existing specs are not changed by adding tests)_

## Impact

- **Test files only** — no production code changes
- Depends on `boards-management-tab-refactor` being implemented first (tests verify that implementation)
- `e2e/ui/workspace-settings.spec.ts` gets a minor non-behavioral refactor (import extraction)
- `e2e/ui/fixtures/mock-data.ts` gets `taskCount` added to `makeBoard()` — additive, no existing tests break

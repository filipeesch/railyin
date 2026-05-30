## Why

The `keep-last-workspace` feature (workspace + board persistence and board-header workflow editor) has no automated test coverage. Without tests, regressions in localStorage restore logic, cross-workspace fallback guards, and the pencil button flow would go undetected.

## What Changes

- **Unit tests for `readStorage<T>` utility**: Verify parse, fallback, and missing-localStorage guard.
- **Unit tests for workspace store persistence**: Verify init-from-storage, watch-based write-back, and stale-key fallback.
- **Unit tests for board store persistence**: Verify init-from-storage, watch-based write-back, stale-id fallback, and cross-workspace validation inside `loadBoards(workspaceKey?)`.
- **Playwright E2E tests for selection persistence**: Seed localStorage via `page.addInitScript`, reload page, verify workspace and board are restored; verify fallback scenarios.
- **Playwright E2E tests for board-header workflow edit button**: Verify pencil visibility, overlay open with correct YAML, auto-close on save, and board reload.
- **Extend `board-workspace-nav.spec.ts`**: Add test verifying workspace tab click persists key to localStorage.

## Capabilities

### New Capabilities

- `read-storage-unit-tests`: Unit tests for the shared `readStorage<T>` utility in `src/mainview/utils/storage.ts`.
- `workspace-persistence-unit-tests`: Unit tests for `workspace.ts` localStorage init and watch-based persistence.
- `board-persistence-unit-tests`: Unit tests for `board.ts` localStorage init, watch, stale-id fallback, and cross-workspace guard inside `loadBoards(workspaceKey?)`.
- `selection-persistence-e2e-tests`: Playwright tests for end-to-end workspace + board selection persistence across page reloads.
- `board-header-workflow-edit-e2e-tests`: Playwright tests for the pencil button visibility, overlay open/close, and board reload after save.

### Modified Capabilities

## Impact

- `src/mainview/utils/storage.test.ts` — new unit test file
- `src/mainview/stores/workspace.test.ts` — new unit test file
- `src/mainview/stores/board.test.ts` — extended with persistence suites
- `e2e/ui/board-selection-persistence.spec.ts` — new Playwright spec
- `e2e/ui/board-header-workflow-edit.spec.ts` — new Playwright spec
- `e2e/ui/board-workspace-nav.spec.ts` — extended with persistence assertion
- `e2e/ui/fixtures/index.ts` — no change needed (workflow.getYaml not in baseline; tests register it locally)

## Why

The `workflow-setup-and-seeding` change introduces the Workflows setup tab, server-enforced delete guards, fresh-install seeding, and removal of the ghost-workflow fallback — but ships no automated coverage of its own. Those behaviors (delete guards, copy-if-absent seeding, the minimal fallback, the no-phantom invariant) are easy to regress silently. This change adds a dedicated, layered test suite that locks them down.

## What Changes

- Add backend unit tests for the new `src/bun/config/workflows.ts` module: `getBundledWorkflowsDir`, `seedWorkflows` (all copy/fallback branches via the injected `sourceDir`), `createWorkflowFile`, `listWorkflowFiles`, `resolveWorkflowFilePath`, and the pure `evaluateDeletable`.
- Extend backend handler tests for `workflow.list`/`create`/`delete`, including the referenced-by-board and last-remaining guards and the `notifyReloaded` callback.
- Add a config-loader integration test asserting the in-memory delivery fallback is gone — no phantom `delivery` template and every loaded workflow is file-backed.
- Add `e2e/api` smoke tests exercising `workflow.list`/`create`/`delete` against a real spawned server, focused on the server-side delete-guard rejections.
- Add a Playwright UI suite (`e2e/ui/workflow-setup.spec.ts`) covering the Workflows tab: list rendering, disabled-delete guards, confirmed deletion, name-only add, the editor overlay lifecycle, the `workflow.reloaded` refresh, and the board header no longer showing the workflow pencil.
- Use `RAILYN_BUNDLED_WORKFLOWS_DIR` and the `seedWorkflows` `sourceDir` parameter to keep seeding deterministic in tests; no production code is added solely for testing.

## Capabilities

### New Capabilities
- `workflow-seeding-tests`: Unit and config-integration coverage for workflow file discovery, bundled-source resolution, copy-if-absent seeding, the minimal fallback, and the no-phantom-fallback invariant.
- `workflow-management-tests`: Backend handler and `e2e/api` coverage for `workflow.list`/`create`/`delete` and the server-enforced delete guards.
- `workflow-setup-playwright-coverage`: Playwright UI coverage for the Workflows setup tab, the editor overlay lifecycle, and the removed board-header pencil.

### Modified Capabilities
- None.

## Impact

- **Depends on** the `workflow-setup-and-seeding` change being implemented first (the module, RPCs, tab, and the `seedWorkflows` `sourceDir` param / `RAILYN_BUNDLED_WORKFLOWS_DIR` env tier it relies on).
- **New test files**: `src/bun/test/workflows.test.ts`; extensions to `src/bun/test/workflow-handlers.test.ts` and a config-loader test; `e2e/api/smoke.test.ts` (or a new `e2e/api/workflow.test.ts`); `e2e/ui/workflow-setup.spec.ts`.
- **Test fixtures**: `src/bun/test/helpers.ts` (`setupTestConfig`) and `e2e/api/fixtures/server.ts` set `RAILYN_BUNDLED_WORKFLOWS_DIR` for deterministic seeding; `e2e/ui/fixtures/index.ts` may gain a `workflow.list` baseline response.
- **No application code** is modified by this change.

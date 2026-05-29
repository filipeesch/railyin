## Context

The `keep-last-workspace` change adds localStorage persistence to `workspace.ts` and `board.ts`, restores the workflow editor pencil button in `BoardView.vue`, and extracts a shared `readStorage<T>` utility. Without tests, the restore logic (init-from-storage + watch-based write-back), fallback guards (stale key/id, cross-workspace mismatch), and the pencil button flow have no regression protection.

Existing test patterns in the codebase set clear precedents:
- **Pinia unit tests**: `vitest` + `createPinia()` + `vi.mock("../rpc")`. `localStorage` is available via jsdom — no mocking needed. Isolation via `localStorage.clear()` in `beforeEach`.
- **Playwright E2E tests**: `page.addInitScript(() => localStorage.setItem(...))` seeds state before app JS runs. `page.evaluate(() => localStorage.getItem(...))` reads back persisted values. `ApiMock.returns()` / `ApiMock.capture()` stub all RPC calls.
- `workflow-setup.spec.ts` already exercises `workflow.getYaml` / `workflow.saveYaml` via `api.returns` — exact same stub approach applies here.

## Goals / Non-Goals

**Goals:**
- Unit-test `readStorage<T>` in isolation (parse, fallback, undefined-guard)
- Unit-test workspace store localStorage init + watch + stale-key fallback
- Unit-test board store localStorage init + watch + stale-id fallback + cross-workspace guard inside `loadBoards(workspaceKey?)`
- E2E-test that workspace and board are restored after a real page reload
- E2E-test all fallback scenarios (stale key, stale id, no stored value)
- E2E-test pencil button visibility, overlay open/close, and board reload after save

**Non-Goals:**
- Testing `WorkflowEditorOverlay` internals (already tested in `workflow-setup.spec.ts`)
- Mutation testing or performance testing
- Backend / API integration tests (feature is frontend-only)

## Decisions

### D1: Unit-test localStorage with jsdom — no injection
Vitest's jsdom provides a real in-memory `localStorage`. Tests seed it directly (`localStorage.setItem(...)`) and clear it in `beforeEach` via `localStorage.clear()`. This is consistent with how terminal.ts and drawer.ts are tested and avoids any injection complexity.

### D2: Seed localStorage in Playwright via `page.addInitScript`
`page.addInitScript` runs before any app JavaScript, making it the correct hook for simulating a "returning user" who already has values in storage. This is the established project pattern (see `chat-sidebar.spec.ts`, `board.spec.ts`).

### D3: Board persistence unit tests extend `board.test.ts`, not a new file
Workspace and board store tests are new files. Board persistence tests are added as new `describe` suites in the existing `board.test.ts` to co-locate all board store tests. `storage.test.ts` and `workspace.test.ts` are new files.

### D4: E2E pencil button tests stub `workflow.getYaml` locally
`workflow.getYaml` is not in the baseline fixture — each test that needs it registers the stub inline with `api.returns("workflow.getYaml", { yaml })`. This mirrors the exact pattern in `workflow-setup.spec.ts` and avoids polluting the shared baseline.

### D5: Test IDs follow existing naming convention
Unit test IDs: `RS-*` (readStorage), `WS-P-*` (workspace persistence), `BP-*` (board persistence).
Playwright test IDs: `BP-E2E-*` (board persistence E2E), `BWE-*` (board workflow edit E2E).
Workspace nav extension: `WS-NAV-3`.

## Risks / Trade-offs

- **`watch` is asynchronous** → `watch` with `{ flush: 'sync' }` is NOT used in production (it uses the default async flush). Unit tests that set `activeBoardId` and immediately read `localStorage` must `await nextTick()` or use `vi.waitUntil`. Pinia's `watch` under vitest/jsdom flushes synchronously by default in most cases — verify and use `await nextTick()` defensively.
- **Board test isolation** → Each `board.test.ts` suite calls `localStorage.clear()` in its own `beforeEach`. The existing suites do not use `localStorage`, so adding `clear()` to the top-level `beforeEach` is safe and backward-compatible.
- **Playwright test order** → `fullyParallel: true` in `playwright.config.ts`. Each test in persistence specs navigates fresh to `/` — no shared state. `page.addInitScript` is per-page, not global.

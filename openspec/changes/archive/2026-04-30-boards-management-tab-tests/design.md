## Context

The `boards-management-tab-refactor` change adds three testable surfaces:
1. **Backend**: new `boards.update` and `boards.delete` handlers in `src/bun/handlers/boards.ts`, plus the DI refactor (`boardHandlers()` now calls `getDb()` internally)
2. **Store**: new `updateBoard` and `deleteBoard` actions in `src/mainview/stores/board.ts`
3. **Frontend**: new `BoardDetailDialog.vue` and `BoardSetupTab.vue` components

The codebase already has established test patterns for each layer — this design follows them exactly rather than introducing new frameworks or approaches.

## Goals / Non-Goals

**Goals:**
- Full coverage of `boards.update` field combinations, partial updates, and validation failures
- Full coverage of `boards.delete` task-guard logic and count in error message
- DI regression test confirming `boardHandlers()` works without a `db` parameter
- Store tests verify API call shape, optimistic state management, and error propagation
- Playwright tests cover all Boards tab UI interactions using the existing mock-api infrastructure

**Non-Goals:**
- Performance or load testing
- Testing `boards.list` or `boards.create` beyond regression (already working)
- End-to-end tests with a real backend (Playwright tests use `mock-api.ts` intercepts only)
- Coverage of `BoardView.vue` board rendering (handled by existing `board.spec.ts`)

## Decisions

### D1: Backend tests use the getDb() singleton via initDb() — no explicit db injection in test bodies

**Decision:** Call `initDb()` in `beforeEach`. After the DI refactor, `boardHandlers()` calls `getDb()` internally, which returns the same in-memory instance seeded by `initDb()`. Tests call `boardHandlers()` with no arguments and exercise handlers directly.

**Rationale:** This is identical to the existing pattern in `handlers.test.ts`. The in-memory DB is reset per test via `resetDbSingleton()` inside `initDb()`. No test-specific injection plumbing needed — the singleton IS the injection point.

**Alternative considered:** Pass a `db` parameter to handlers in tests — rejected because the DI refactor removes that parameter. Re-adding it only in tests would undermine the refactor.

---

### D2: Store tests use vi.mock("../rpc") — same pattern as task.test.ts

**Decision:** At module level: `const apiMock = vi.fn(); vi.mock("../rpc", () => ({ api: apiMock }))`. Each test configures `apiMock.mockResolvedValueOnce(...)` to return controlled responses. `setActivePinia(createPinia())` in `beforeEach` resets store state.

**Rationale:** Matches `task.test.ts` and `conversation.test.ts` exactly. No real network or DB involved. Tests are fast and deterministic. The `vi.mock` at module scope ensures the mock is in place before the store module is imported.

**No optimistic delete**: `deleteBoard` must NOT remove the board from `boards.value` before the API call succeeds. Tests verify this by rejecting the mock and asserting the board is still present.

---

### D3: Playwright tests use mock-api.ts intercepts — taskCount drives task-presence scenarios

**Decision:** All Playwright tests use `api.returns("boards.list", [...])` and `api.capture("boards.update/delete", ...)`. Board task presence is controlled via `makeBoard({ taskCount: N })` — no navigation to the board or `tasks.list` setup needed.

**Rationale:** The `taskCount` field on `Board` (added in `boards-management-tab-refactor`) means test scenarios for "board has tasks" are fully expressible in the mock data layer. This eliminates multi-step navigation setup (go to board, create tasks, go back to setup) from tests, keeping them fast and readable.

**`goToSetup()` extraction**: The helper lives in `e2e/ui/fixtures/setup-helpers.ts` so both `workspace-settings.spec.ts` and `board-setup.spec.ts` share it. Follows the existing `board-helpers.ts` pattern.

---

### D4: boards.update partial-field test coverage — explicit per-field isolation

**Decision:** Test each field update in isolation (`name` only, `workflowTemplateId` only, `projectKeys` only) before testing the "other fields unchanged" invariant. The invariant test re-fetches the board after a name-only update and asserts `workflowTemplateId` and `projectKeys` are unchanged.

**Rationale:** Dynamic `SET` clauses (building SQL only for provided fields) are a common source of bugs — either overwriting unset fields with `undefined` or failing to update correctly. Explicit isolation tests catch both failure modes.

---

### D5: boards.delete error message test — count in message

**Decision:** Test both `taskCount=1` (singular "1 task(s)") and `taskCount=3` (plural, count in message) to verify the count is dynamic, not hardcoded to 1.

**Rationale:** The backend format is `"Board has N task(s). Remove them first."` — a regression that replaces `N` with a literal string would otherwise pass a single-task test.

## Risks / Trade-offs

- **Test order dependency** — `initDb()` calls `resetDbSingleton()` which must run before each test. If a test skips `beforeEach`, it will inherit state from the previous test. Vitest's `beforeEach` guarantee makes this safe.
- **workspace-settings.spec.ts refactor** — Extracting `goToSetup()` is a pure internal refactor with no behavioral change, but it must be verified that the import resolves correctly after the move.

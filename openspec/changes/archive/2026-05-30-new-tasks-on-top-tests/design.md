## Context

The `new-tasks-on-top` feature modifies three code paths:
1. `PositionService.getTopPosition` — new method, pure arithmetic
2. `tasks.create` handler — replaces `MAX+1000` with `getTopPosition`
3. `BoardToolExecutor.execCreateTask` — adds explicit `getTopPosition` call

None of these paths have existing tests for position-on-creation behaviour. This design covers where tests live, what patterns they use, and how they interconnect.

## Goals / Non-Goals

**Goals:**
- Cover `getTopPosition` with unit tests (all edge cases: empty, single, multiple tasks, cross-board isolation)
- Cover `tasks.create` RPC handler with integration tests that assert `position` value in the response and DB
- Cover `execCreateTask` with integration tests that assert position is set correctly in the created task
- Cover the Playwright board UI with end-to-end tests verifying DOM card order after creation

**Non-Goals:**
- Re-testing the existing `rebalanceColumnPositions` / `reorderColumn` suites
- Testing concurrent-creation race conditions (acceptable known edge case, documented in feature design)
- Browser cross-compatibility or performance testing

## Decisions

### D1 — Test file locations

Each layer gets tests in the file that already covers it:

| Layer | File | Suite ID |
|---|---|---|
| `PositionService.getTopPosition` unit | `src/bun/test/position-service.test.ts` | `PS-4` |
| `tasks.create` integration | `src/bun/test/handlers.test.ts` | `TC-POS` |
| `execCreateTask` integration | `src/bun/test/board-tool-executor.test.ts` | `BE-4` extended |
| Board UI card order | `e2e/ui/board-create-task.spec.ts` | `CREATE-4/5` |

This avoids creating new test files and follows the established pattern in the project.

### D2 — In-memory DB via DI

All backend tests (PS-4, TC-POS, BE-4.x) use the existing `initDb()` helper from `src/bun/test/helpers.ts` to create an isolated in-memory SQLite database per test. No mocking of `Database` is needed — real queries run against the schema.

### D3 — Playwright mocks

`CREATE-4` and `CREATE-5` use the existing `ApiMock` / `WsMock` infrastructure from `e2e/ui/fixtures/mock-api.ts`. No real backend required.

- `CREATE-4`: intercept `tasks.create`, return a task with `position: 0.5` (lower than any seeded task with `position: 1000`), confirm the new card appears first in DOM order.
- `CREATE-5`: seed board with one card (`position: 1000`), push a `task.updated` WebSocket event with a task that has `position: 0.5`, confirm that card appears first.

### D4 — Assertion strategy

Backend tests assert:
- Returned `Task.position` field value (from handler/executor response)
- DB row's `position` column (via `SELECT position FROM tasks WHERE id = ?`)

Playwright tests assert DOM card order by querying `.task-card` elements and comparing their `data-task-id` attributes (or visible text content) to expected order.

## Risks / Trade-offs

- **`CREATE-5` fidelity**: The WebSocket-push test (`CREATE-5`) tests the frontend's sort computed, not `execCreateTask` itself. The integration between AI creation and frontend ordering is partially covered by this test but relies on the WS mock infrastructure correctly simulating the `task.updated` event with the right `position` field.
- **Test isolation**: `handlers.test.ts` is a large file (~500+ lines). The new `TC-POS` suite should be placed near the existing `tasks.create` tests and use `beforeEach` to reset DB state to avoid interference.

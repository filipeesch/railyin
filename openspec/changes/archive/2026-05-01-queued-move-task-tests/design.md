## Context

The `queued-move-task` feature modifies `StreamProcessor`, `TransitionExecutor`, `execMoveTask`, the `tasks.transition` handler, and the frontend task store. It also adds a new DB column and migration. The changes touch existing tests at the constructor level (`StreamProcessor` gains two new callback params) and at the behavioral level (`markTaskUnread` is narrowed and three `board-unread.spec.ts` tests will fail under the new frontend behavior).

The test suite targets three layers:

1. **Backend integration tests** — in-memory SQLite, no network, DI via constructor callbacks and spy arrow functions
2. **Frontend Vitest tests** — Pinia store tests with `vi.spyOn`, no DOM required
3. **Playwright e2e** — mock WS/API via `fixtures/mock-api.ts`, `vite preview` serving `dist/`

### Key infrastructure constraints

- `initDb()` in `src/bun/test/helpers.ts` uses an **inline schema** separate from real migrations — `needs_column_prompt` must be added there too (not only in migration 034)
- `StreamProcessor` currently has 6 constructor args; the new 7th and 8th are optional callbacks — existing tests need two extra `() => {}` to avoid TS errors
- `StubStreamProcessor` in `transition-executor.test.ts` calls `super(null, fakeRawBuffer, ()=>{}, ()=>{}, ()=>{}, ()=>{})` — needs two more no-ops
- UNREAD-1, UNREAD-3, UNREAD-4 in `board-unread.spec.ts` use `message.new` to trigger the unread dot — this trigger is removed by the frontend fix; all three must be updated in-place to use `task.updated` with terminal `executionState`

## Goals / Non-Goals

**Goals:**
- Cover all new behavior from `queued-move-task` with automated tests
- Fix/update existing tests that break due to the `StreamProcessor` constructor change and frontend unread narrowing
- Use constructor/callback injection (DI) throughout — no `vi.mock` module mocking for production modules
- Tests are independent and deterministic (in-memory DB, no real engine, mock WS)

**Non-Goals:**
- No mutation testing or performance tests
- No full integration test that runs a real Claude/Copilot engine
- No tests for the migration runner itself (`db-migrations.test.ts` handles that separately)

## Decisions

### Decision 1: StreamProcessor drain tests use spy callbacks, not stub classes

The new `StreamProcessor` constructor params are callbacks (`onDeferredTransition`, `onPendingMessage`). Tests capture calls with plain spy arrays:

```ts
const transitions: [number, string][] = [];
const messages:    [number, string][] = [];
const sp = new StreamProcessor(
  db, fakeRawBuffer, noop, noop, noop, noop,
  (tid, state) => transitions.push([tid, state]),
  (tid, msg)   => messages.push([tid, msg]),
);
```

No `StubTransitionExecutor` class needed. This is consistent with how `onTaskUpdated` and `onNewMessage` are tested in existing SP tests.

### Decision 2: execMoveTask three-case tests read DB flag directly

After calling `execMoveTask`, tests assert:
1. Whether `onTransition` was called (spy arrow function in `commonCtx()`)
2. The value of `needs_column_prompt` column via `db.query(...).get(taskId)`

No mock executor needed — the test just checks what was written to DB and what callback was invoked.

### Decision 3: tasks.transition deferred tests set execution_state directly in DB

The handler tests for the deferred path do NOT need a running engine. They set `execution_state = 'running'` directly on the task row via `db.run(...)` before calling the handler, then assert `executionId: null` in the response and check `needs_column_prompt` in the DB.

### Decision 4: Frontend tests use store action calls, not WS event dispatch

`task.test.ts` tests call `store.onTaskUpdated(payload)`, `store.onTaskStreamEvent(event)`, `store.onTaskNewMessage(msg)` directly (matching the existing T1–T9 pattern). `markTaskUnread` behavior is asserted by reading `store.unreadTaskIds` after the call.

### Decision 5: UNREAD Playwright tests updated in-place (not deleted)

UNREAD-1, UNREAD-3, and UNREAD-4 are updated to push `{ type: 'task.updated', payload: { ...task, executionState: 'completed' } }` via the mock WS instead of `message.new`. Test IDs and intent are preserved; only the trigger mechanism changes.

## Risks / Trade-offs

- **`helpers.ts` inline schema drift**: if a future migration adds a column but `helpers.ts` is not updated, all backend tests silently miss it. This is a pre-existing structural risk; this change makes it explicit in the test todo description.
- **StreamProcessor constructor arity**: TypeScript will catch any test file that doesn't add the two new no-ops, so the risk of a silent miss is low.
- **UNREAD Playwright test fragility**: the updated tests depend on the mock WS correctly populating `executionState` in the `task.updated` payload. If the mock factory doesn't support the field, the tests will always pass vacuously.

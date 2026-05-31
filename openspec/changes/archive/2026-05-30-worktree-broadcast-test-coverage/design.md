## Context

The `fix-worktree-task-update-join` change replaces 6 inline SQL queries — each missing `LEFT JOIN task_git_context` — with calls to `fetchTaskWithModel()`. Each of those queries feeds either an `onTaskUpdated` broadcast or an RPC return value. The bug surfaced as Terminal/Code Server buttons disappearing after execution events because `worktreePath` was silently nulled out.

All affected classes receive their collaborators (including the `onTaskUpdated` callback) via constructor injection, making spy-based unit testing straightforward without any production code changes.

Existing test infrastructure supports everything needed:
- `initDb()` already creates the `task_git_context` table
- `seedProjectAndTask()` returns `taskId`; a single `db.run("INSERT INTO task_git_context …")` seeds git context
- `WsMock.push()` and `makeTask()` in the Playwright fixtures support full `Task` payload injection including `worktreePath`

## Goals / Non-Goals

**Goals:**
- Each fixed call site has at least one test asserting `worktreePath` is present in the broadcast/return
- A Playwright regression sentinel (`WS-WT-1`) documents the pre-fix symptom pattern (buttons disappear when `task.updated` nulls `worktreePath`)
- A Playwright green test (`WS-WT-2`) confirms buttons survive a correct `task.updated` push

**Non-Goals:**
- Testing `fetchTaskWithModel()` itself (already covered in `task-queries` tests)
- E2E tests hitting a real Bun server
- Testing `human-turn-executor`'s full conversation flow — only the `onTaskUpdated` payload is in scope

## Decisions

### Decision: Inline `task_git_context` seeding per test, not a new helper

Adding a `seedGitContext(db, taskId, path)` helper to `helpers.ts` would be premature generalization for a small set of tests. Each test seeds its own row directly with `db.run("INSERT INTO task_git_context …")` — keeping the setup explicit and co-located with the assertion.

*Alternative considered*: extend `seedProjectAndTask` to optionally insert a git context row — rejected because that function is used across ~30 test files; adding an optional parameter risks unexpected behavior elsewhere.

### Decision: `WS-WT-1` lives in `board-ws-updates.spec.ts`, not a new spec file

The button-visibility tests sit at the intersection of WebSocket push semantics and drawer UI. The `board-ws-updates.spec.ts` suite already exercises `task.updated` push patterns. Adding two tests there avoids creating a single-purpose Playwright file.

### Decision: `human-turn-executor.test.ts` is a new file

There is no existing test file for `HumanTurnExecutor`. Its three `onTaskUpdated` paths are distinct enough to warrant dedicated coverage. The test setup pattern mirrors `retry-executor.test.ts` closely — `StubStreamProcessor`, `StubWorkdirResolver`, injected `onTaskUpdated` spy.

### Decision: No production code changes for testability

All required seams are already injectable. No `internal` exposure, no test-only flags, no alternative paths.

## Risks / Trade-offs

- **`human-turn-executor.ts` resume path requires a live engine stub** → the `waiting_user` → `running` path calls `engineRegistry.resolveEngineForModel(…)` then `engine.resume(…)`. A `TestEngine` stub (already the pattern in `retry-executor.test.ts`) handles this cleanly.
- **`StubStreamProcessor` in retry/human-turn tests isolates the broadcast** → tests assert on the `onTaskUpdated` spy, not on the actual broadcast; this is intentional and consistent with how SP-9 and transition-executor tests are structured.

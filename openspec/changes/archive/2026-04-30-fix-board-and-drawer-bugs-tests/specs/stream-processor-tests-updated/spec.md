## ADDED Requirements

### Requirement: Error paths in StreamProcessor abort signal and emit done event
`src/bun/test/stream-processor.test.ts` SHALL include tests SP-7, SP-8, and SP-9 covering the error-path lifecycle fixes and the worktree preservation fix. Tests use `sp.createSignal(executionId)` before `await sp.consume(...)` and `sp.setOnStreamEvent(cb)` to capture events via DI — no module-level mocking.

#### Scenario: SP-7 — catch block aborts the AbortSignal
- **WHEN** the stream engine throws an unhandled error during `consume()`
- **THEN** `signal.aborted` is `true` after `consume()` settles

#### Scenario: SP-7b — catch block emits a done stream event
- **WHEN** the stream engine throws an unhandled error during `consume()`
- **THEN** the `setOnStreamEvent` callback received a `{ type: 'done' }` event

#### Scenario: SP-8 — fatal error event aborts the AbortSignal
- **WHEN** the engine yields an `{ type: "error", error: { fatal: true } }` event
- **THEN** `signal.aborted` is `true` after `consume()` settles

#### Scenario: SP-8b — fatal error event emits a done stream event
- **WHEN** the engine yields an `{ type: "error", error: { fatal: true } }` event
- **THEN** the `setOnStreamEvent` callback received a `{ type: 'done' }` event

#### Scenario: SP-9 — onTaskUpdated receives task with non-null worktreePath
- **WHEN** a `task_git_context` row exists for the task and `consume()` completes normally
- **THEN** the `onTaskUpdated` spy was called with a task where `worktreePath` is not null

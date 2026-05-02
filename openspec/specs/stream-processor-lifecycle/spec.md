## Purpose
Defines the lifecycle of `StreamProcessor` — how execution signals are created and torn down, how accumulators are flushed on cancellation, how fatal errors are handled, and how error paths clean up state and notify the frontend.

## Requirements

### Requirement: createSignal registers an AbortController and returns its signal
`StreamProcessor.createSignal(executionId: number)` SHALL create a new `AbortController`, store it under `executionId`, and return its `AbortSignal`. Calling `abort(executionId)` SHALL trigger that signal.

#### Scenario: Signal fires when abort is called
- **WHEN** `createSignal(1)` is called and then `abort(1)` is called
- **THEN** the returned `AbortSignal.aborted` is `true`

#### Scenario: Unknown executionId abort is a no-op
- **WHEN** `abort(99999)` is called with no prior `createSignal(99999)`
- **THEN** no error is thrown

### Requirement: AbortController entry is deleted after consume() completes
`StreamProcessor` SHALL delete the `abortControllers` and `rawMessageSeq` entries for an `executionId` in the `finally` block of `consume()`, regardless of whether the execution succeeded, was cancelled, or errored.

#### Scenario: Cleanup on successful completion
- **WHEN** `consume()` runs to completion with a `done` event
- **THEN** the `abortControllers` and `rawMessageSeq` entries for that executionId are removed

#### Scenario: Cleanup on cancellation
- **WHEN** `abort(executionId)` is called while `consume()` is running
- **THEN** after `consume()` settles, the `abortControllers` entry for that executionId is removed

### Requirement: Accumulators are flushed to DB on all cancellation paths
`StreamProcessor` SHALL expose a single private `_flushAccumulators()` method that persists any in-progress token and reasoning content to the DB as conversation messages. This method SHALL be called from exactly one location — the cancellation handler inside `consume()`.

#### Scenario: Token content flushed on cancel
- **WHEN** the stream has emitted some `token` events and the abort signal fires before `done`
- **THEN** the accumulated token content is persisted as an `assistant` conversation message

#### Scenario: Reasoning content flushed on cancel
- **WHEN** the stream has emitted some `reasoning` events and the abort signal fires before the round ends
- **THEN** the accumulated reasoning content is persisted as a `reasoning` conversation message

### Requirement: Fatal error transitions execution and task to failed state
`StreamProcessor` SHALL handle `{ type: "error", fatal: true }` engine events by setting the execution `status` to `"failed"` and the task `execution_state` to `"failed"` in the DB.

#### Scenario: Fatal error marks execution failed
- **WHEN** the engine yields `{ type: "error", fatal: true, message: "..." }`
- **THEN** the execution row has `status = "failed"` and `finished_at` is set

#### Scenario: Fatal error marks task failed
- **WHEN** a fatal error event is received during a task execution
- **THEN** the task row has `execution_state = "failed"`

### Requirement: Error paths abort the active signal and emit a done event
When `stream-processor.ts` enters the `catch` block or handles an `{ type: "error", fatal: true }` engine event, the system SHALL call `.abort()` on the active `AbortController` for that execution before deleting it, and SHALL emit a `{ type: "done" }` stream event to the frontend.

#### Scenario: catch block aborts signal and emits done
- **WHEN** `consume()` throws an unhandled error
- **THEN** `abortControllers.get(executionId).abort()` is called, the controller entry is deleted, and a `done` stream event is broadcast to the frontend

#### Scenario: fatal error event aborts signal and emits done
- **WHEN** the engine yields `{ type: "error", fatal: true }`
- **THEN** `abortControllers.get(executionId).abort()` is called and a `done` stream event is broadcast to the frontend

#### Scenario: Frontend converges to terminal state on error
- **WHEN** an execution fails (catch or fatal error)
- **THEN** the frontend `streamState.isDone` becomes true, the send button is unlocked, and the streaming indicator is dismissed

#### Scenario: Aborting an already-aborted controller is safe
- **WHEN** `.abort()` is called on an AbortController that has already been aborted
- **THEN** no error is thrown and the system continues cleanup normally

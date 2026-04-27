## ADDED Requirements

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

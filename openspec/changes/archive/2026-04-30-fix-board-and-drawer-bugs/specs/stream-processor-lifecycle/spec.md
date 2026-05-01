## ADDED Requirements

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

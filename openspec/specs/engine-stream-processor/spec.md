## ADDED Requirements

### Requirement: StreamProcessor owns AbortController lifecycle
The `StreamProcessor` class SHALL be the single owner of the `abortControllers` map. It SHALL expose `createSignal(executionId: number): AbortSignal` to register a new controller and return its signal, and `abort(executionId: number): void` to trigger cancellation.

#### Scenario: Signal created before execution params are built
- **WHEN** any executor starts a new execution
- **THEN** it calls `streamProcessor.createSignal(executionId)` first and passes the returned signal to `ExecutionParamsBuilder.build()`

#### Scenario: Abort cleans up the map
- **WHEN** `StreamProcessor.consume()` reaches its `finally` block
- **THEN** the `abortControllers` entry for that executionId is deleted

#### Scenario: Orchestrator cancel delegates abort
- **WHEN** `Orchestrator.cancel(executionId)` is called
- **THEN** it calls `streamProcessor.abort(executionId)` to trigger the signal before performing DB writes

### Requirement: StreamProcessor encapsulates stream consumption
The `StreamProcessor` class SHALL expose a `runNonNative(taskId, conversationId, executionId, engine, params)` method that starts an engine execution and consumes the resulting stream, handling all DB persistence and callback relay.

#### Scenario: Token accumulation and final flush
- **WHEN** the stream emits `token` events followed by a `done` event
- **THEN** all token content is accumulated and persisted as a single `assistant` conversation message on `done`

#### Scenario: Reasoning flush before tool_start
- **WHEN** a `tool_start` event is received while `reasoningAccum` is non-empty
- **THEN** the reasoning content is flushed as a `reasoning` message before the tool call is persisted

#### Scenario: Cancellation flushes accumulators
- **WHEN** the abort signal fires mid-stream
- **THEN** any accumulated token and reasoning content is flushed to DB before the execution is marked `cancelled`

#### Scenario: Fatal error transitions to failed
- **WHEN** the stream emits `{ type: "error", fatal: true }`
- **THEN** the execution status is set to `failed` and task execution_state is set to `failed`

### Requirement: rawMessageSeq is owned by StreamProcessor
The `StreamProcessor` class SHALL own the `rawMessageSeq` map used for ordering raw model message inserts, and SHALL clean it up in the `finally` block of `consume()`.

#### Scenario: Sequence is cleaned up after execution
- **WHEN** `consume()` completes (success, error, or cancel)
- **THEN** the `rawMessageSeq` entry for that executionId is deleted from the map

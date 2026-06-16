## Purpose
Defines the test infrastructure that exercises the Cursor SDK engine: the in-process mock adapter, the engine-agnostic integration scenarios reused via `shared-rpc-scenarios.ts`, the typed mock surface, and the Playwright UI coverage for cursor-engine tasks.

## Requirements

### Requirement: Cursor SDK Mock Adapter with Queue/Step-Builder API

The test infrastructure SHALL provide `MockCursorSdkAdapter` — an async-iterable mock of the production `CursorSdkAdapter` driven by per-turn queues. Each call to `run()` pops the next queued turn and emits its scripted `EngineEvent` steps (token, reasoning, tool_start, tool_result, status, error, ask_user). The mock SHALL be signal-aware and SHALL invoke supplied custom tools via a `callTool` step so suspend-loop tools fire the engine's `onSuspend` callback exactly as in production.

#### Scenario: Queued turn streams in order

- **WHEN** a test calls `adapter.queueTurn({ steps: [token("Hello"), token(" world"), toolStart("c1", "create_card"), toolResult("c1", "ok")] })`
- **AND** then awaits `adapter.run(config)`
- **THEN** the async iterable yields each step's `EngineEvent` in order
- **AND** terminates with `{ type: "done" }` when the signal is not aborted

#### Scenario: Abort omits the terminal done

- **WHEN** a queued turn's `waitForAbort` step is reached and the supplied `signal` is later aborted
- **THEN** the mock stops processing further steps
- **AND** does NOT yield `{ type: "done" }` (matching production `SubprocessCursorAdapter`)

#### Scenario: callTool triggers onSuspend for suspend-loop tools

- **WHEN** a queued step is `callTool("decision_request", args)`
- **THEN** the mock invokes the registered `customTools["decision_request"].execute(args, {})`
- **AND** the production wrapper calls `onSuspend(payload)` which aborts the supplied signal
- **AND** the mock skips any post-suspend steps

### Requirement: Engine Integration Tests via Shared RPC Scenarios

The test suite SHALL exercise the Cursor engine end-to-end against the engine-agnostic helpers in `src/bun/test/support/shared-rpc-scenarios.ts` (single-turn chat, multi-turn chat, tool success, tool failure, cancellation, fatal failure, model listing) AND SHALL cover Cursor's cursor-specific decision_request suspension path.

#### Scenario: Shared scenarios run against MockCursorSdkAdapter

- **WHEN** `src/bun/test/cursor/rpc-scenarios.test.ts` boots a runtime via `createCursorRpcRuntime(adapter)` with queued turns
- **THEN** `runSingleTurnChatScenario`, `runMultiTurnChatScenario`, `runToolSuccessScenario`, `runToolFailureScenario`, `runCancellationScenario`, `runFatalFailureScenario`, and `runModelListingScenario` all pass

#### Scenario: decision_request suspension persists a decision_request_prompt and transitions to waiting_user

- **WHEN** a queued turn calls `callTool("decision_request", { questions: [...] })`
- **THEN** the execution status transitions to `waiting_user`
- **AND** a `decision_request_prompt` conversation message is persisted with the question payload

#### Scenario: Follow-up message after suspend restarts as a fresh execution

- **WHEN** a follow-up `tasks.sendMessage` is sent after a `decision_request` suspension
- **THEN** because `CursorEngine.resume()` throws by contract, `HumanTurnExecutor` falls into its restart branch
- **AND** the returned executionId is NOT the suspended execution's id

### Requirement: Mock SDK Types

The test infrastructure SHALL export typed mock components (`MockCursorSdkAdapter`, `CursorMockStep`, `CursorMockTurn`) and step builders from `src/bun/test/cursor/mocks.ts` that satisfy the production `CursorSdkAdapter` interface.

#### Scenario: Type safety

- **WHEN** a test imports `{ MockCursorSdkAdapter, token, toolStart, callTool, ... }` from `src/bun/test/cursor/mocks.ts`
- **THEN** TypeScript compilation succeeds
- **AND** `MockCursorSdkAdapter` is assignable to `CursorSdkAdapter`

### Requirement: Playwright UI Test for Cursor Engine

Playwright tests SHALL verify the frontend renders the Cursor engine model in the picker and renders cursor-driven assistant streams, tool calls, and decision_request prompts identically to other engines.

#### Scenario: Engine selection

- **WHEN** the user opens the model picker
- **THEN** a Cursor model (e.g. `cursor/...`) is listed and selectable
- **AND** selecting it sets the conversation model to that id

#### Scenario: Streaming renders for cursor-driven runs

- **WHEN** the mocked backend emits `text_chunk` and `assistant` stream events for a cursor-engine task
- **THEN** the chat surface shows the assistant message text live and persists it on stream completion

#### Scenario: Tool execution rendering

- **WHEN** the mocked backend emits `tool_call` + `tool_result` stream events under a cursor-engine task
- **THEN** the chat surface shows the tool call with its display label and the tool result inline

#### Scenario: decision_request prompt rendering

- **WHEN** the mocked backend emits a `decision_request_prompt` message under a cursor-engine task and transitions to `waiting_user`
- **THEN** the chat surface renders the decision_request UI (questions + options)

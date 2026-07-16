# Pi Execution Controller

## Purpose

Specifies the `PiExecutionController`, a single-responsibility service that owns the Pi SDK execution loop for one conversation turn. It subscribes to SDK events, translates them to Railyin `EngineEvent`s, and drives the prompt/continue/waitForIdle lifecycle via a `RunDriver` abstraction.

## Requirements

### Requirement: Own the AsyncQueue and event subscription
`PiExecutionController` SHALL create an `AsyncQueue<EngineEvent>` for each `execute()` call. It SHALL subscribe to the `AgentSession` event stream once at the start of execution and unsubscribe exactly once when the turn finishes. The queue SHALL remain open during background-compaction pause-and-resume cycles and SHALL be closed only after the final `RunDriver` call settles and no further resume is required.

#### Scenario: Queue emits translated events
- **WHEN** the SDK emits `message_update` with a text delta
- **THEN** the controller pushes a `{ type: "token", text: delta }` event to the queue

#### Scenario: Queue closes after run settles
- **WHEN** the SDK run finishes and `waitForIdle()` resolves
- **THEN** the controller unsubscribes and closes the queue
- **AND** the consumer receives `{ type: "done" }` followed by the queue closing

#### Scenario: Queue stays open during compaction
- **WHEN** background compaction aborts the active prompt mid-turn
- **THEN** the queue remains open, compaction events continue to flow, and the controller resumes via `RunDriver.resume()`

### Requirement: Drive the run via RunDriver
`PiExecutionController` SHALL NOT call `session.prompt()` or `session.agent.continue()` directly. Instead, it SHALL use an injected `RunDriver` interface with two methods:

```ts
interface RunDriver {
  start(session: AgentSession, prompt: string, signal?: AbortSignal): Promise<void>;
  resume(session: AgentSession, signal?: AbortSignal): Promise<void>;
}
```

The controller SHALL call `start()` for the initial prompt and `resume()` for each continuation required after background compaction. The `RunDriver` implementation is responsible for awaiting `session.agent.waitForIdle()`; the controller treats each resolved `start()`/`resume()` as a fully settled turn.

#### Scenario: Initial prompt uses start()
- **WHEN** `execute()` begins
- **THEN** `runDriver.start(session, resolvedPrompt, abortSignal)` is awaited

#### Scenario: Mid-turn compaction uses resume()
- **WHEN** background compaction aborts the prompt and the last message role is not `assistant`
- **THEN** `runDriver.resume(session, abortSignal)` is awaited after compaction settles

#### Scenario: Settled turn after each run call
- **WHEN** `runDriver.start()` resolves
- **THEN** the controller treats the turn as settled and checks compaction state
- **AND** the actual `waitForIdle()` call is encapsulated inside the `RunDriver` implementation

### Requirement: Integrate with CompactionCoordinator
`PiExecutionController` SHALL pass every SDK event to `compactionCoordinator.observe(event, session)` so the coordinator can decide whether to trigger background compaction. After each `RunDriver` call settles, the controller SHALL call `await compactionCoordinator.awaitCompaction(conversationId)` to ensure any in-flight compaction completes before inspecting session state.

#### Scenario: Coordinator observes all events
- **WHEN** the SDK emits any event
- **THEN** `compactionCoordinator.observe(event, session)` is called before the event is translated

#### Scenario: Controller awaits compaction before resume decision
- **WHEN** `runDriver.start()` resolves and a background compaction is in flight
- **THEN** the controller awaits the compaction promise before deciding whether to resume

### Requirement: Translate SDK events to EngineEvents
`PiExecutionController` SHALL use the existing `translatePiEvent` function (or equivalent) to convert each `AgentSessionEvent` into zero or more `EngineEvent`s. Translated events SHALL be pushed to the queue in order.

#### Scenario: Text delta becomes token event
- **WHEN** the SDK emits a text delta
- **THEN** a `token` event is pushed to the queue

#### Scenario: agent_end becomes done event
- **WHEN** the SDK emits `agent_end`
- **THEN** a `done` event is pushed to the queue

### Requirement: Handle errors gracefully
If `RunDriver.start()` or `resume()` throws, or if `waitForIdle()` rejects, the controller SHALL push an `{ type: "error", message, fatal: false }` event to the queue, unsubscribe, close the queue, and return. The controller SHALL NOT leave the subscription active after an error.

#### Scenario: Prompt error emits error event
- **WHEN** `runDriver.start()` rejects with a Pi error
- **THEN** an `error` event is pushed and the queue closes

#### Scenario: Error path unsubscribes exactly once
- **WHEN** an error occurs during execution
- **THEN** the SDK subscription is removed exactly once and no further events are translated

### Requirement: Support cancellation
`PiExecutionController` SHALL accept an `AbortSignal` in `execute()`. When the signal aborts, the controller SHALL call `session.abort()` and exit the loop. Any in-flight `RunDriver` call is expected to reject or resolve quickly after `session.abort()`.

#### Scenario: Abort signal stops execution
- **WHEN** the abort signal fires during streaming
- **THEN** `session.abort()` is called and the queue closes without emitting further events

### Requirement: Preserve raw model event forwarding
If `ExecutionParams.onRawModelMessage` is provided, `PiExecutionController` SHALL forward raw SDK events through that callback. For child sessions spawned by the `delegate` tool, the controller is not responsible; the `delegate` implementation in `ToolFactory` handles forwarding with `parentToolCallId`.

#### Scenario: Parent raw events forwarded
- **WHEN** `onRawModelMessage` is provided and the parent SDK emits a raw event
- **THEN** the callback is invoked with the raw event and `parentToolCallId: undefined`

### Requirement: Unit-testable with mock RunDriver
`PiExecutionController` SHALL be designed so that unit tests can inject a mock `RunDriver` and a controllable fake SDK event source. Tests SHALL verify queue contents, subscription lifecycle, compaction resume decisions, and error handling without creating a real `AgentSession`.

#### Scenario: Mock driver emits events and completes
- **GIVEN** a mock `RunDriver` that resolves after emitting `text_delta`, `agent_end`, and `turn_end` events
- **WHEN** `controller.execute(session, conversationId, prompt, signal)` is consumed
- **THEN** the queue emits the translated `token` event, `done` event, and compaction observation occurred for `turn_end`

#### Scenario: Mock driver simulates mid-turn compaction
- **GIVEN** a mock `RunDriver` whose first `start()` emits `turn_end` (above threshold) and resolves, and a `CompactionCoordinator` that reports an in-flight compaction and `shouldResume: true`
- **WHEN** the controller consumes the stream
- **THEN** `runDriver.resume()` is called once after compaction settles, the queue stays open across both driver calls, and only one `done` event is emitted

#### Scenario: Error from mock driver closes queue
- **GIVEN** a mock `RunDriver` that rejects with `Error("prompt failed")`
- **WHEN** the controller consumes the stream
- **THEN** an `{ type: "error", message: "prompt failed" }` event is emitted and the queue closes

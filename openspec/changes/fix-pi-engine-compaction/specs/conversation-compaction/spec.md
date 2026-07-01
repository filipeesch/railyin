## MODIFIED Requirements

### Requirement: Pi engine participates in compaction lifecycle

Pi engine tasks SHALL support both manual and auto-compaction via Pi SDK. Compaction events MUST be forwarded to Railyin's stream processor so the conversation UI reflects the compaction lifecycle. The Pi engine SHALL own the full compaction lifecycle: the SDK's threshold-based auto-compaction is disabled; threshold compaction is managed by the engine's `turn_end`-based background compaction mechanism. Overflow auto-compaction is handled by the SDK autonomously and detected by the engine via `compaction_end.willRetry`.

When the SDK emits `compaction_end` with `willRetry: true` (overflow auto-compaction), the engine SHALL detect this via a `sdkWillRetryRef` closure ref set in the session subscriber. The execution loop SHALL await the SDK's own deferred `agent.continue()` call (scheduled internally by the SDK via `setTimeout(..., 100)`) by subscribing to the next `agent_end` event. The engine SHALL NOT call `session.agent.continue()` itself in this path — doing so would conflict with the SDK's own deferred call.

The `AsyncQueue` SHALL remain open throughout SDK overflow compaction and the subsequent retry turn. The subscriber remains active so all `compaction_start`, `compaction_done`, and post-retry events flow to the UI.

#### Scenario: Background compaction fires and execution continues
- **WHEN** the Pi engine's `turn_end`-based background compaction fires and `session.abort()` resolves `session.prompt()` early
- **THEN** `PiEngine` does NOT close the `AsyncQueue`; it awaits the background compaction promise; then calls `session.agent.continue()` if the agent was mid-turn; and continues streaming events until the agent truly finishes

#### Scenario: SDK overflow compaction fires and execution continues
- **WHEN** the LLM returns a context overflow error and the SDK emits `compaction_start { reason: "overflow" }` followed by `compaction_end { reason: "overflow", willRetry: true }`
- **THEN** `PiEngine` forwards both events to the stream; sets `sdkWillRetryRef.value = true`; and after `session.prompt()` resolves, awaits the next `agent_end` from the SDK's own deferred retry; then the execution loop continues normally

#### Scenario: Manual compact triggers via compact button
- **WHEN** the user clicks the compact button in the task drawer
- **AND** the `tasks.compact` RPC is called
- **AND** the task uses a Pi engine
- **THEN** `PiEngine.compact()` calls `session.compact()` on the active session
- **AND** the Pi session JSONL is compacted via the local LLM

#### Scenario: Auto-compact fires when Pi SDK detects threshold
- **WHEN** the engine's `turn_end` handler determines context usage exceeds the soft threshold
- **THEN** `session.compact()` is invoked asynchronously
- **AND** `PiEngine` forwards `compaction_start` and `compaction_done` events through the still-open queue
- **AND** the execution loop resumes after compaction completes

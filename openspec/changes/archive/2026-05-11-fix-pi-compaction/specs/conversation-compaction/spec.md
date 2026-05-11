## MODIFIED Requirements

### Requirement: Compaction auto-triggers when context usage reaches 90%
The Pi engine SHALL automatically compact the conversation after each execution completes if the content-based token estimate (`session.getContextUsage().tokens`) exceeds `contextWindow - DEFAULT_RESERVE_TOKENS` (16,384 tokens) AND compaction is not already in progress. The check SHALL be performed in the `.then()` callback of `session.prompt()`, before `.finally(() => queue.close())`, so that compaction events emitted by the SDK are delivered through the still-open `AsyncQueue`. Failure during auto-compact SHALL be logged to the console only and SHALL NOT surface in the UI.

#### Scenario: Auto-compact fires after execution when estimate exceeds threshold
- **WHEN** an execution completes and `session.getContextUsage().tokens > contextWindow - 16384`
- **THEN** `session.compact()` is called before the `AsyncQueue` closes, emitting `compaction_start` and `compaction_done` events through the stream pipeline

#### Scenario: Auto-compact does not fire below threshold
- **WHEN** an execution completes and `session.getContextUsage().tokens <= contextWindow - 16384`
- **THEN** no compaction occurs

#### Scenario: Auto-compact does not fire when already compacting
- **WHEN** an execution completes above threshold but `session.isCompacting` is true
- **THEN** no compaction call is made

#### Scenario: Auto-compact failure is logged only
- **WHEN** auto-compact throws an error (e.g., LLM timeout)
- **THEN** the error is logged to console with prefix `[pi] auto-compact failed:` and the execution stream completes normally

### Requirement: User can manually trigger compaction at any time
The system SHALL expose a `tasks.compact` RPC and a "Compact" button in the task detail drawer that allows the user to trigger compaction at any time regardless of current context usage. If no live Pi session exists for the conversation, the engine SHALL restore it from the persisted `.jsonl` session file before compacting. If compaction is already in progress, the system SHALL throw a user-friendly error. After successful compaction, a `message.new` WebSocket event SHALL be broadcast with the new `compaction_summary` message.

#### Scenario: Manual compact button visible in drawer
- **WHEN** the task detail drawer is open and the task is not currently running
- **THEN** a "Compact" button is visible

#### Scenario: Manual compact RPC stores summary and broadcasts message
- **WHEN** `tasks.compact` is called for a task
- **THEN** a compaction AI call is made, the resulting summary is stored as a `compaction_summary` message, and a `message.new` event is broadcast with that message

#### Scenario: Compact works after server restart (no live session)
- **WHEN** `tasks.compact` is called and no live Pi session exists in memory for the conversation
- **THEN** the session is restored from `~/.railyin/pi-sessions/<hash>.jsonl` and compaction proceeds normally

#### Scenario: Compact rejected when already compacting
- **WHEN** `tasks.compact` is called while compaction is already in progress for that conversation
- **THEN** an error `"Compaction already in progress"` is thrown

#### Scenario: Compact button disabled while running
- **WHEN** the task execution state is `running`
- **THEN** the Compact button is disabled

### Requirement: Compaction summary content is persisted correctly
The `compaction_summary` message stored in the database SHALL contain the actual summary text produced by the compaction LLM call. The `compaction_done` stream event's `summary` field SHALL be used as the message content; an empty string SHALL NOT be stored when a summary is available.

#### Scenario: compaction_done event stores actual summary
- **WHEN** a `compaction_done` EngineEvent is processed by the stream processor
- **THEN** the `compaction_summary` message content equals `event.summary` (not an empty string)

#### Scenario: compaction_done with no summary stores empty string
- **WHEN** a `compaction_done` EngineEvent has no `summary` field
- **THEN** the `compaction_summary` message content is an empty string

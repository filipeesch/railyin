## Purpose
Allows users and the system to compact a task's conversation history into a summary to reclaim context window space.

## Requirements

### Requirement: Conversation can be compacted into a summary
The system SHALL support compacting a task's conversation history by sending accumulated messages to the AI model and replacing them, for future LLM calls, with a single summary message of type `compaction_summary`. The full history SHALL remain in the conversation's message store (the file-backed `ConversationMessageStore` for new conversations, or the legacy `conversation_messages` table for pre-existing ones). The AI call SHALL use the structured multi-section compaction prompt (see `compaction-prompt` spec) and the stored summary SHALL contain only the `<summary>` block output, with any `<analysis>` scratchpad block stripped prior to storage. Context token estimation for auto-compact threshold checking SHALL reflect the micro-compact decay — i.e., it SHALL estimate tokens for the assembled payload (after inline clearing), not for the raw stored messages. The compaction prompt SHALL explicitly inform the model that a `Session Notes` file exists and is injected separately — allowing the compaction summary to defer persistent facts to the notes layer rather than duplicating them. The compaction-anchor lookup (finding the most recent `compaction_summary` message) SHALL be served by the `ConversationMessageStore`, using the sidecar's `lastCompactionSummaryId`/`lastCompactionSummaryByteOffset` for file-backed conversations rather than scanning the file.

#### Scenario: Compaction appends a summary message
- **WHEN** compaction is triggered (manually or automatically)
- **THEN** a `compaction_summary` message is appended to the conversation containing an AI-generated summary of prior messages, structured according to the compaction prompt template

#### Scenario: Analysis scratchpad is not stored
- **WHEN** compaction completes and the model response contains an `<analysis>` block
- **THEN** the stored `compaction_summary` message contains only the content of the `<summary>` block, not the analysis

#### Scenario: Post-compaction LLM calls use summary, notes, and newer messages
- **WHEN** an LLM call is assembled after a compaction_summary exists in history
- **THEN** the assembled context contains: the system prompt (with session notes block if present), the compaction_summary as a system message, and only messages that occurred after it

#### Scenario: Pre-compaction messages remain retrievable from the message store
- **WHEN** compaction completes
- **THEN** all messages before the compaction_summary are still retrievable via the conversation's `ConversationMessageStore`, whether file-backed or legacy SQLite

#### Scenario: Compaction uses the task's own model
- **WHEN** compaction runs
- **THEN** the AI call for generating the summary uses the same model as the task (`task.model ?? workspace ai.model`)

#### Scenario: Compaction uses stored conversation model
- **WHEN** `compact(taskId, conversationId, workingDirectory)` is called and `conversations.model` is `"pi-local/lmstudio/llama-3.2-3b"`
- **THEN** the Pi session for compaction is created or updated with model `"pi-local/lmstudio/llama-3.2-3b"` and the context window resolved from `model_settings` for that model

#### Scenario: Compaction uses correct context window from model_settings
- **WHEN** `compact()` resolves model `"pi-local/lmstudio/qwen3:8b"` and `model_settings` has `context_window = 32768` for that model
- **THEN** the Pi session used for compaction has `model.contextWindow = 32768`

#### Scenario: Compaction is visible in the conversation UI
- **WHEN** a compaction_summary message exists in the conversation
- **THEN** the UI renders it as a distinct visual divider labelled "— Conversation compacted —" with the summary accessible on expand

#### Scenario: Auto-compact threshold checks assembled token count
- **WHEN** the system checks whether to auto-compact before a send
- **THEN** the token estimate used is based on the assembled payload (after micro-compact clearing), not the raw stored message content

#### Scenario: Compaction-anchor lookup uses sidecar for file-backed conversations
- **WHEN** the system needs to find the most recent `compaction_summary` message for a file-backed conversation
- **THEN** the `ConversationMessageStore` returns it using the sidecar's `lastCompactionSummaryId` rather than scanning the JSONL file

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

### Requirement: Pi engine participates in compaction lifecycle
Pi engine tasks SHALL support both manual and auto-compaction via Pi SDK. Compaction events MUST be forwarded to Railyin's stream processor so the conversation UI reflects the compaction lifecycle. The Pi engine SHALL own the full compaction lifecycle: the SDK's threshold-based auto-compaction is disabled; threshold compaction is managed by the engine's `turn_end`-based background compaction mechanism. Overflow auto-compaction is handled by the SDK autonomously and detected by the engine via `compaction_end.willRetry`.

When the SDK emits `compaction_end` with `willRetry: true` (overflow auto-compaction), the engine SHALL detect this via a `sdkWillRetryRef` closure ref set in the session subscriber. The execution loop SHALL await the SDK's own deferred `agent.continue()` call (scheduled internally by the SDK via `setTimeout(..., 100)`) by subscribing to the next `agent_end` event via `waitForNextAgentEnd()`. After `agent_end` fires, the loop continues to the next iteration and calls `session.agent.continue()` via `runWithLimiter` to resume the turn. The engine SHALL NOT duplicate the SDK's own deferred `agent.continue()` call — `waitForNextAgentEnd` ensures the SDK's retry has completed before the loop proceeds.

The `AsyncQueue` SHALL remain open throughout SDK overflow compaction and the subsequent retry turn. The subscriber remains active so all `compaction_start`, `compaction_done`, and post-retry events flow to the UI.

#### Scenario: Background compaction fires and execution continues
- **WHEN** the Pi engine's `turn_end`-based background compaction fires and `session.abort()` resolves `session.prompt()` early
- **THEN** `PiEngine` does NOT close the `AsyncQueue`; it awaits the background compaction promise; then calls `session.agent.continue()` if the agent was mid-turn; and continues streaming events until the agent truly finishes

#### Scenario: SDK overflow compaction fires and execution continues
- **WHEN** the LLM returns a context overflow error and the SDK emits `compaction_start { reason: "overflow" }` followed by `compaction_end { reason: "overflow", willRetry: true }`
- **THEN** `PiEngine` forwards both events to the stream; sets `sdkWillRetryRef.value = true`; after `session.prompt()` resolves, awaits the next `agent_end` from the SDK's own deferred retry via `waitForNextAgentEnd()`; then on the next loop iteration calls `session.agent.continue()` via `runWithLimiter` to resume the conversation

#### Scenario: Auto-compact fires when Pi SDK detects threshold
- **WHEN** the Pi SDK determines context usage has reached the configured auto-compact threshold during an active execution
- **THEN** Pi SDK emits `compaction_start { reason: "threshold" }`
- **AND** `PiEngine` forwards this as a `{ type: "compaction_start" }` EngineEvent
- **AND** after compaction completes, Pi SDK emits `compaction_end { aborted: false }`
- **AND** `PiEngine` forwards this as a `{ type: "compaction_done" }` EngineEvent
- **AND** the stream processor writes a `compaction_summary` message to the conversation

#### Scenario: Manual compact triggers via compact button
- **WHEN** the user clicks the compact button in the task drawer
- **AND** the `tasks.compact` RPC is called
- **AND** the task uses a Pi engine
- **THEN** `PiEngine.compact()` calls `session.compact()` on the active session
- **AND** the Pi session JSONL is compacted via the local LLM

#### Scenario: Overflow recovery compacts automatically
- **WHEN** the LLM returns a context overflow error during a Pi execution
- **AND** Pi SDK emits `compaction_start { reason: "overflow" }`
- **THEN** `PiEngine` forwards the compaction lifecycle events to Railyin's stream
- **AND** Pi SDK retries the prompt after compaction completes

### Requirement: Compaction summary content is persisted correctly
The `compaction_summary` message stored in the database SHALL contain the actual summary text produced by the compaction LLM call. The `compaction_done` stream event's `summary` field SHALL be used as the message content; an empty string SHALL NOT be stored when a summary is available.

#### Scenario: compaction_done event stores actual summary
- **WHEN** a `compaction_done` EngineEvent is processed by the stream processor
- **THEN** the `compaction_summary` message content equals `event.summary` (not an empty string)

#### Scenario: compaction_done with no summary stores empty string
- **WHEN** a `compaction_done` EngineEvent has no `summary` field
- **THEN** the `compaction_summary` message content is an empty string

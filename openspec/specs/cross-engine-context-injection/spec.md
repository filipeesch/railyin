## Purpose
Defines how the system detects engine switches mid-conversation and injects DB-backed message history into the new engine's context, preserving conversational continuity across engine boundaries.

## Requirements

### Requirement: CrossEngineContextInjector detects engine switches and injects DB history
The system SHALL provide a `CrossEngineContextInjector` in `src/bun/conversation/cross-engine-context.ts`. Before each execution, it SHALL compare `conversations.last_engine_type` with the target `QualifiedModelId.engineId`. If different and non-null, it SHALL fetch conversation messages from the last `compaction_summary` DB anchor and return them as a `<message_history>` XML block prepended to the first user message of the new session. The system prompt SHALL NOT be modified, preserving its cacheability with providers that support prompt caching.

#### Scenario: Same engine — no injection
- **WHEN** `last_engine_type` equals the target engine ID
- **THEN** `prepareSwitch()` returns `undefined` and no context block is added

#### Scenario: First execution — no injection
- **WHEN** `last_engine_type` is `null` (conversation never executed)
- **THEN** `prepareSwitch()` returns `undefined`

#### Scenario: Engine switch triggers context injection
- **WHEN** `last_engine_type` is `"copilot"` and target engine is `"claude"`
- **THEN** messages since the last `compaction_summary` anchor are formatted and returned as a `{ prefixedUserContent: string }` result

#### Scenario: Injected block is prepended to first user message content
- **WHEN** the injector returns a non-null result
- **THEN** the executor prepends the `<message_history>` XML block to the original user message content before calling `engine.execute()`; `systemInstructions` is unchanged

### Requirement: Pre-switch compaction when token usage exceeds threshold
Before injecting context, the injector SHALL estimate token usage of the messages-to-inject against the target model's `contextWindow`. If usage exceeds 75% AND the source engine implements `compact?()`, it SHALL trigger compaction on the source engine first, then re-fetch messages from the new anchor. If the source engine has no `compact()` (e.g. Claude), it SHALL proceed without compaction and log a warning.

#### Scenario: Under threshold — no compaction
- **WHEN** estimated tokens are below 75% of target model's contextWindow
- **THEN** `compact()` is NOT called and injection proceeds immediately

#### Scenario: Over threshold with compact-capable source engine
- **WHEN** estimated tokens exceed 75% of target model's contextWindow AND source engine has `compact()`
- **THEN** `compact()` is awaited, messages are re-fetched from the new anchor, and injection proceeds with the compacted history

#### Scenario: Over threshold with Claude as source (no compact)
- **WHEN** estimated tokens exceed 75% AND source engine has no `compact()` method
- **THEN** a warning is logged, injection proceeds with the uncompacted history

#### Scenario: Target model has no contextWindow (e.g. copilot/auto)
- **WHEN** the target model's `contextWindow` is `undefined`
- **THEN** the 75% threshold check is skipped and injection proceeds without compaction

### Requirement: last_engine_type is updated after each execution
After each successful or failed execution, the system SHALL update `conversations.last_engine_type` to the current execution's `QualifiedModelId.engineId`.

#### Scenario: last_engine_type updated after execution
- **WHEN** an execution with model `"claude/claude-sonnet-4-5"` completes
- **THEN** `conversations.last_engine_type` is set to `"claude"` for that conversation

#### Scenario: last_engine_type updated even on execution failure
- **WHEN** an execution fails partway through
- **THEN** `conversations.last_engine_type` is still updated to the attempted engine ID

### Requirement: chat-executor test infrastructure supports engine-switch scenarios
The test helpers SHALL be extended to support engine-switch test scenarios without requiring raw SQL in individual tests. `seedChatSession` SHALL accept an optional `lastEngineType` override. `makeExecutor` factory SHALL accept an optional `crossEngineInjector` parameter. A new `makeTestRegistryWith(engines: Map<string, ExecutionEngine>)` helper SHALL be exported from `helpers.ts`.

#### Scenario: seedChatSession sets last_engine_type when provided
- **WHEN** `seedChatSession(db, { model: "copilot/mock-model", lastEngineType: "copilot" })` is called
- **THEN** the seeded `conversations` row has `last_engine_type = "copilot"`

#### Scenario: seedChatSession leaves last_engine_type null when not provided
- **WHEN** `seedChatSession(db, { model: "copilot/mock-model" })` is called with no `lastEngineType`
- **THEN** the seeded `conversations` row has `last_engine_type = NULL`

### Requirement: CE-8 — historyBlock injected into engine prompt on switch
The test suite SHALL verify that when `ChatExecutor` is wired with a `CrossEngineContextInjector`, switching engines injects the history block into the engine-facing prompt.

#### Scenario: history block prepended to params.prompt when last_engine_type differs
- **WHEN** `conversations.last_engine_type` is `"copilot"`, prior messages exist, and `execute()` is called with model `"claude/claude-sonnet-4-5"`
- **THEN** `streamProcessor.lastRun!.params.prompt` contains `<message_history>` and includes the seeded message text

#### Scenario: params.prompt starts with the history block header
- **WHEN** an engine switch is detected
- **THEN** `params.prompt` starts with `"## Context from previous conversation (engine switch)"`

### Requirement: CE-9 — no injection when engine unchanged
The test suite SHALL verify that no history block is added when the engine has not changed.

#### Scenario: params.prompt equals raw content when same engine
- **WHEN** `conversations.last_engine_type` is `"copilot"` and `execute()` is called with `"copilot/mock-model"`
- **THEN** `params.prompt` equals the raw user content string and does NOT contain `<message_history>`

### Requirement: CE-10 — no injection on first turn
The test suite SHALL verify that execution proceeds normally when no prior engine has been recorded.

#### Scenario: params.prompt equals raw content when last_engine_type is null
- **WHEN** `conversations.last_engine_type` is `null` and `execute()` is called
- **THEN** `params.prompt` equals the raw user content string

### Requirement: CE-11 — historyBlock not stored in conversation_messages
The test suite SHALL verify that the history block is engine-only and does not appear in the persisted user message.

#### Scenario: conversation_messages.content is the raw user input
- **WHEN** an engine switch is detected and execution proceeds
- **THEN** the `conversation_messages` row for the user turn has `content` equal to the original input string, not the injected prompt

### Requirement: CE-12 — last_engine_type written after each chat turn
The test suite SHALL verify that `conversations.last_engine_type` is updated after a successful execution.

#### Scenario: last_engine_type set to target engine ID after execution
- **WHEN** `execute()` completes with model `"copilot/mock-model"`
- **THEN** `conversations.last_engine_type` equals `"copilot"` in the DB

#### Scenario: last_engine_type overwritten when model switches engines
- **WHEN** a first `execute()` with `"copilot/mock-model"` is followed by a second `execute()` with `"claude/claude-sonnet-4-5"`
- **THEN** `conversations.last_engine_type` equals `"claude"` after the second call

### Requirement: CE-13 — last_engine_type not written on Pi pre-flight failure
The test suite SHALL verify that `conversations.last_engine_type` is not modified when the Pi pre-flight exits early.

#### Scenario: last_engine_type unchanged when Pi pre-flight fires
- **WHEN** `conversations.last_engine_type` is `"copilot"`, model is `"pi/some-model"`, and no context window is configured
- **THEN** `conversations.last_engine_type` remains `"copilot"` after the failed execution

### Requirement: CE-14 — model-update condition always syncs model to DB
The test suite SHALL verify the corrected model-update condition writes the new model even when a previous model was already set.

#### Scenario: conversations.model updated when model changes from a prior value
- **WHEN** `conversations.model` is `"copilot/v1"` and `execute()` is called with `"copilot/v2"`
- **THEN** `conversations.model` equals `"copilot/v2"` in the DB after execution

### Requirement: CrossEngineContextInjector is wired into ChatExecutor
The system SHALL wire `CrossEngineContextInjector` into `ChatExecutor` via constructor injection. `ChatExecutor` SHALL call `prepareSwitch()` before each execution turn, using the target engine ID derived from the effective model and the source engine resolved from `conversations.last_engine_type`. The resulting `historyBlock` SHALL be prepended to the engine-facing prompt (`engineContent`) but SHALL NOT appear in the user-facing `content` stored in `conversation_messages`.

#### Scenario: Chat engine switch injects history block into engine prompt
- **WHEN** a chat session's `conversations.last_engine_type` is `"copilot"` and the user sends a message with model `"claude/claude-sonnet-4-5"`
- **THEN** `prepareSwitch()` returns a `historyBlock` containing DB-persisted messages formatted as `<message_history>` XML, and this block is prepended to the engine content passed to `engine.execute()`

#### Scenario: No injection when engine unchanged
- **WHEN** a chat session's `conversations.last_engine_type` matches the engine ID of the current model
- **THEN** `prepareSwitch()` returns `undefined` and no history block is added to the engine prompt

#### Scenario: No injection on first chat turn
- **WHEN** `conversations.last_engine_type` is `null` (no prior turns)
- **THEN** `prepareSwitch()` returns `undefined` and execution proceeds normally

### Requirement: ChatExecutor maintains last_engine_type after each turn
The system SHALL update `conversations.last_engine_type` to the target engine ID immediately after calling `runNonNative()` for each chat execution turn. This update SHALL occur regardless of whether the AI response succeeds or fails, but SHALL NOT occur for early-exit paths where `runNonNative()` is never called (e.g., Pi pre-flight configuration error).

#### Scenario: last_engine_type written after successful chat turn
- **WHEN** a chat turn executes with model `"claude/claude-sonnet-4-5"`
- **THEN** `conversations.last_engine_type` is set to `"claude"` for that conversation after `runNonNative()` is called

#### Scenario: last_engine_type not written on Pi pre-flight error
- **WHEN** a chat turn targets the Pi engine but the context window is not configured and the early-exit path fires
- **THEN** `conversations.last_engine_type` is NOT updated and retains its previous value

### Requirement: Source engine resolved from last_engine_type for pre-switch compaction
For chat session engine switches, the system SHALL resolve the source engine using `engineRegistry.getEngineById(conversations.last_engine_type)` and pass it to `prepareSwitch()` as the `sourceEngine` argument. This enables pre-switch compaction for Pi-to-other-engine switches when the chat context exceeds 75% of the target model's context window.

#### Scenario: Pre-switch compaction triggered for large Pi chat session
- **WHEN** a Pi-engine chat session has a context exceeding 75% of the target model's context window and the user switches to another engine
- **THEN** `compact()` is called on the Pi source engine before the history block is extracted

#### Scenario: Source engine null when no prior engine recorded
- **WHEN** `conversations.last_engine_type` is `null`
- **THEN** `sourceEngine` is `null`, `prepareSwitch()` returns `undefined`, and no compaction is attempted

## ADDED Requirements

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

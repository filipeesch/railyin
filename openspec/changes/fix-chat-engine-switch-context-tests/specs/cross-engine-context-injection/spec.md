## ADDED Requirements

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

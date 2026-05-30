# Capability: ChatExecutor Test

## Purpose

Specifies the observable behaviour of `ChatExecutor` that must be covered by automated tests, including how execution parameters are assembled, how the Pi-engine pre-flight guard works, how callbacks are invoked, and how the resulting system messages are rendered in the chat UI.

---

## Requirements

### Requirement: ChatExecutor injects contextWindowOverride into ExecutionParams
`ChatExecutor` SHALL resolve `contextWindowOverride` from `ModelSettingsRepository` and include it in the `ExecutionParams` passed to the stream processor.

#### Scenario: Context window is configured
- **WHEN** a chat session executes with a model that has a context window configured in model settings
- **THEN** `ExecutionParams.contextWindowOverride` SHALL equal the value returned by `ModelSettingsRepository.getContextWindow`

#### Scenario: Context window is not configured for a non-Pi engine
- **WHEN** a chat session executes with a Claude model that has no context window configured
- **THEN** `ExecutionParams.contextWindowOverride` SHALL be `undefined` and execution SHALL proceed normally

---

### Requirement: ChatExecutor injects boardTools into ExecutionParams
`ChatExecutor` SHALL pass `IBoardToolExecutor` into `ExecutionParams.boardTools` unconditionally, making board management tools available to the AI in chat sessions.

#### Scenario: Board tools available in chat
- **WHEN** a chat session executes
- **THEN** `ExecutionParams.boardTools` SHALL be the `IBoardToolExecutor` instance provided at construction time

---

### Requirement: Pre-flight guard blocks Pi execution when context window is absent
When the selected model belongs to the Pi engine and `contextWindowOverride` resolves to `null`/`undefined`, `ChatExecutor` SHALL NOT start a managed execution. Instead it SHALL persist a system error message to the conversation and return early.

#### Scenario: Pi model with no context window configured
- **WHEN** a chat session targets a Pi model AND `ModelSettingsRepository.getContextWindow` returns `null`
- **THEN** no `executions` row SHALL be created
- **THEN** a `conversation_messages` row with `type = "system"` SHALL be persisted in the conversation
- **THEN** `onNewMessage` SHALL be called exactly once with the persisted system message

#### Scenario: Pi model with context window configured
- **WHEN** a chat session targets a Pi model AND `ModelSettingsRepository.getContextWindow` returns a positive integer
- **THEN** the pre-flight guard SHALL NOT trigger
- **THEN** execution SHALL proceed and the stream processor SHALL be invoked

---

### Requirement: Pre-flight guard does not affect non-Pi engines
The pre-flight context-window check SHALL be scoped exclusively to the Pi engine. All other engines SHALL be unaffected.

#### Scenario: Claude model with no context window configured
- **WHEN** a chat session targets a Claude model AND `ModelSettingsRepository.getContextWindow` returns `null`
- **THEN** no system error message SHALL be persisted
- **THEN** execution SHALL proceed and the stream processor SHALL be invoked

---

### Requirement: onNewMessage callback is called with the pre-flight error message
When the pre-flight guard fires, `ChatExecutor` SHALL call the injected `onNewMessage` callback immediately after persisting the system error message, enabling real-time WebSocket delivery to the frontend.

#### Scenario: Callback receives the error message
- **WHEN** the pre-flight guard fires
- **THEN** `onNewMessage` SHALL be called with a `ConversationMessage` whose `type` is `"system"` and whose content references the unconfigured Pi model

#### Scenario: Callback is NOT called on successful execution
- **WHEN** a chat session executes successfully (pre-flight passes)
- **THEN** `onNewMessage` SHALL NOT be called during the pre-flight phase (it MAY be called by downstream stream handling, which is outside this scope)

---

### Requirement: System error message is rendered in the chat UI
The frontend chat conversation view SHALL render a system-type error message that was pushed via WebSocket as a result of the pre-flight guard.

#### Scenario: Error message visible in conversation
- **WHEN** the backend emits a `message.new` WebSocket event with `type = "system"` for a Pi chat session
- **THEN** the message SHALL appear in the chat conversation panel
- **THEN** the message SHALL be visually distinct from user and assistant messages (system style)

#### Scenario: Claude chat session unaffected
- **WHEN** a Claude chat session sends a message
- **THEN** no system error message SHALL appear in the conversation
- **THEN** the assistant response SHALL render normally

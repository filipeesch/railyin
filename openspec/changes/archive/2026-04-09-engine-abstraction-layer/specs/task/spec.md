## MODIFIED Requirements

### Requirement: Task stores a model override
Each task SHALL have an optional `model` field that overrides the engine-level default model for all AI executions run in the context of that task. The model field is engine-agnostic — it stores a model identifier suitable for the active engine (fully-qualified ID for native engine, plain model name for Copilot engine).

#### Scenario: Task model used when set
- **WHEN** a task has a non-null `model` field and an execution is triggered
- **THEN** the orchestrator passes the task's model value as `ExecutionParams.model` to the engine

#### Scenario: Engine default model used when task model is null
- **WHEN** a task's `model` field is null
- **THEN** the engine's default model (from engine config) is used for all executions

### Requirement: Task owns a persistent conversation
Each task SHALL own exactly one conversation. All executions, retries, user messages, assistant responses, transition events, and system messages for that task are appended to this single conversation timeline. The conversation is never reset. Messages from different engines (native vs Copilot) coexist in the same timeline using the same `ConversationMessage` types.

#### Scenario: Conversation persists through transitions
- **WHEN** a task moves from one column to another
- **THEN** the new execution's messages are appended to the existing conversation; prior messages remain visible

#### Scenario: Conversation persists through retries
- **WHEN** a retry is triggered
- **THEN** the retry's messages are appended to the existing conversation with prior attempt messages still visible

#### Scenario: Conversation messages normalized from different engines
- **WHEN** the Copilot engine produces tool_start and tool_result events for built-in tools
- **THEN** the orchestrator persists them as `tool_call` and `tool_result` conversation messages in the same format as native engine messages

## ADDED Requirements

### Requirement: Task conversation records are engine-agnostic
The `conversation_messages` table SHALL store messages from any engine using the same schema. The orchestrator normalizes all `EngineEvent` types to `ConversationMessage` types before persisting. No engine-specific message types exist in the database.

#### Scenario: Native engine messages stored as ConversationMessage
- **WHEN** the native engine produces token, tool_start, tool_result, and done events
- **THEN** the orchestrator writes `assistant`, `tool_call`, and `tool_result` rows to `conversation_messages`

#### Scenario: Copilot engine messages stored as ConversationMessage
- **WHEN** the Copilot engine translates SDK events to EngineEvents
- **THEN** the orchestrator writes the same `assistant`, `tool_call`, and `tool_result` row types to `conversation_messages`

#### Scenario: Conversation timeline displays uniformly regardless of engine
- **WHEN** a task's conversation was produced by the Copilot engine
- **THEN** the frontend renders the conversation timeline identically to native engine conversations

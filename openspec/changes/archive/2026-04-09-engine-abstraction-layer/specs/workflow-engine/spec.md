## MODIFIED Requirements

### Requirement: Entering a column triggers on_enter_prompt execution
The system SHALL automatically execute a column's `on_enter_prompt` when a task enters that column, if the prompt is configured. Before starting the execution, the orchestrator SHALL update the task's `model` field to the column's configured `model`, or the workspace default if the column has none. The orchestrator SHALL resolve the `on_enter_prompt` slash reference, persist the resolved content as a `user` message with `sender = 'prompt'` to `conversation_messages`, construct `ExecutionParams`, and delegate to the active `ExecutionEngine.execute()`.

#### Scenario: Prompt runs on column entry
- **WHEN** a task is moved to a column with a configured `on_enter_prompt`
- **THEN** the orchestrator creates `ExecutionParams` with the resolved prompt and calls `engine.execute(params)`; `execution_state` is set to `running`

#### Scenario: No prompt means idle state
- **WHEN** a task is moved to a column with no `on_enter_prompt`
- **THEN** `execution_state` is set to `idle` and no execution is created

#### Scenario: Task model updated to column model on entry
- **WHEN** a task enters a column with a `model` field defined
- **THEN** `task.model` is set to the column's model before execution begins

#### Scenario: Task model reset to workspace default when column has no model
- **WHEN** a task enters a column with no `model` field
- **THEN** `task.model` is set to the workspace `default_model` value (resolved from engine config for native, or from engine config for copilot)

#### Scenario: Resolved prompt is persisted before execution
- **WHEN** the orchestrator fires for a column with `on_enter_prompt`
- **THEN** the orchestrator resolves the slash reference, persists the resolved content as a `user` message with `sender = 'prompt'`, and then calls `engine.execute(params)`

### Requirement: Execution result updates task execution state
The system SHALL update a task's `execution_state` based on the `EngineEvent` stream consumed by the orchestrator. Valid terminal states are `completed`, `failed`, and `waiting_user`. The orchestrator handles state updates uniformly regardless of which engine produced the events.

#### Scenario: Completed execution updates state to completed
- **WHEN** the orchestrator receives a `done` EngineEvent
- **THEN** the task's `execution_state` is set to `completed`

#### Scenario: Failed execution updates state to failed
- **WHEN** the orchestrator receives a fatal `error` EngineEvent
- **THEN** the task's `execution_state` is set to `failed`

#### Scenario: ask_user event transitions to waiting_user
- **WHEN** the orchestrator receives an `ask_user` EngineEvent
- **THEN** it appends an `ask_user_prompt` message to the conversation, sets `execution_state = 'waiting_user'`, and stops consuming events

#### Scenario: User answer resumes from waiting_user
- **WHEN** a task has `execution_state = 'waiting_user'` and the user sends a message
- **THEN** the orchestrator constructs new `ExecutionParams` with the user's answer and calls `engine.execute()` — the user's answer is appended as a `user` message and the engine continues with full conversation context

### Requirement: Frontend is notified immediately on execution state changes
The system SHALL push task state updates to the frontend via IPC whenever execution state changes — including when execution begins and when it completes or fails. The orchestrator handles all RPC relay regardless of engine.

#### Scenario: Running state pushed on human turn
- **WHEN** a user sends a chat message that starts a new execution
- **THEN** a `task.updated` event is sent to the frontend immediately after `execution_state` is set to `running`

#### Scenario: Completed state pushed after stream finishes
- **WHEN** the orchestrator receives a `done` event and updates the DB
- **THEN** a `task.updated` event is sent so the board card reflects the final state

### Requirement: Unified AI stream drives execution from first token to final response
The system SHALL execute all tool rounds and the final text response using the engine's `AsyncIterable<EngineEvent>` stream. The orchestrator consumes the event stream without issuing separate API calls. For the native engine, the stream encapsulates the full tool loop internally. For the Copilot engine, the SDK manages the tool loop and emits events.

#### Scenario: Tool loop exits after model produces text
- **WHEN** the engine yields a `done` event after yielding `token` events
- **THEN** the orchestrator treats the accumulated tokens as the final response and does not issue another call

#### Scenario: Model calls tools then produces final answer
- **WHEN** the engine yields `tool_start` and `tool_result` events followed by `token` events and a `done` event
- **THEN** the orchestrator persists each tool interaction and the final text as conversation messages

### Requirement: Execution supports abort-signal-based cancellation
The orchestrator SHALL maintain an in-memory `Map<executionId, AbortController>`. When a `tasks.cancel` request is received, the orchestrator calls `engine.cancel(executionId)` and aborts the controller. The engine catches the abort and the orchestrator transitions the execution to `cancelled` and the task to `waiting_user`.

#### Scenario: AbortController registered at execution start
- **WHEN** a new execution begins (transition or human turn)
- **THEN** an AbortController is registered in the map keyed by `executionId` and its signal is passed to `ExecutionParams`

#### Scenario: AbortController removed on execution completion
- **WHEN** an execution finishes normally (completed, failed, waiting_user)
- **THEN** the AbortController for that execution is removed from the map

#### Scenario: Cancel routes through engine abstraction
- **WHEN** the orchestrator receives a cancel request
- **THEN** it calls `engine.cancel(executionId)` and aborts the AbortController

#### Scenario: Stale running state reset on startup
- **WHEN** the Bun process restarts with tasks in `execution_state = 'running'`
- **THEN** those tasks are reset to `execution_state = 'failed'`

### Requirement: Tool set offered to model is determined per column (native engine)
For the native engine, the system SHALL filter tool definitions to only include tools named in the current column's `tools` configuration before building the AI request. When no `tools` key is present, the default set SHALL be used. For the Copilot engine, the SDK manages its own built-in tools; only common tools are always registered.

#### Scenario: Column tools list controls what native engine model receives
- **WHEN** a native engine execution runs in a column with `tools: [read_file, ask_me]`
- **THEN** the AI request includes only `read_file` and `ask_me` definitions

#### Scenario: No tools key falls back to native defaults
- **WHEN** a native engine execution runs in a column with no `tools` key and a worktree is available
- **THEN** the AI request includes `read_file`, `list_dir`, and `run_command`

#### Scenario: Copilot engine always has common tools regardless of column config
- **WHEN** a Copilot engine execution runs in any column
- **THEN** common tools (task management) are always registered; the SDK manages its own built-in tools independently

### Requirement: ask_me suspends execution and prompts the user for input
The system SHALL provide an `ask_me` capability that pauses agent execution and surfaces a question to the human user. For the native engine, this is implemented as a tool that yields an `ask_user` EngineEvent. For the Copilot engine, this is handled by the SDK's `onUserInputRequest` callback, which the engine translates to an `ask_user` EngineEvent. The orchestrator handles the suspension identically.

#### Scenario: ask_me pauses execution and shows prompt (native)
- **WHEN** the native engine's model calls `ask_me` with a question
- **THEN** the engine yields `{ type: "ask_user", question: "..." }` and the orchestrator sets execution_state to `waiting_user`

#### Scenario: ask_me pauses execution and shows prompt (copilot)
- **WHEN** the Copilot SDK triggers `onUserInputRequest`
- **THEN** the engine yields `{ type: "ask_user", question: "..." }` and the orchestrator sets execution_state to `waiting_user`

#### Scenario: User response resumes execution
- **WHEN** the user submits a reply to an `ask_user` prompt
- **THEN** the orchestrator calls `engine.sendMessage()` or starts a new execution, and the agent continues

## ADDED Requirements

### Requirement: Orchestrator delegates column transitions to the active engine
The orchestrator SHALL replace direct calls to `handleTransition`, `handleHumanTurn`, `handleRetry`, and `handleCodeReview` with engine-agnostic dispatch. The orchestrator resolves column config, creates execution records, and calls `engine.execute(params)`, consuming the returned event stream.

#### Scenario: Column transition dispatched through engine
- **WHEN** a task moves to a new column with an on_enter_prompt
- **THEN** the orchestrator constructs ExecutionParams and calls `engine.execute(params)` on the active engine

#### Scenario: Human turn dispatched through engine
- **WHEN** a user sends a message on a task
- **THEN** the orchestrator constructs ExecutionParams with the user message and calls `engine.execute(params)`

#### Scenario: Retry dispatched through engine
- **WHEN** a user triggers retry on a task
- **THEN** the orchestrator re-resolves the column's on_enter_prompt, increments retry count, and calls `engine.execute(params)`

#### Scenario: Code review dispatched through engine
- **WHEN** the orchestrator processes code review decisions
- **THEN** it constructs a prompt summarizing the decisions and calls `engine.execute(params)` on the active engine

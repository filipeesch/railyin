## Purpose
Defines the ExecutionEngine interface and related types (ExecutionParams, EngineEvent) that all engine implementations conform to. Specifies how the orchestrator consumes engine events and manages execution lifecycle, persistence, and relay.
## Requirements
### Requirement: ExecutionEngine interface defines the contract for all engines
The system SHALL define an `ExecutionEngine` interface that all engines implement. The interface SHALL include:
- `execute(params: ExecutionParams): AsyncIterable<EngineEvent>` — run an agentic execution
- `cancel(executionId: number): void` — abort a running execution
- `resume(executionId: number, input: EngineResumeInput): Promise<void>` — resume a paused execution with user input or a permission decision when the engine supports in-loop pauses
- `listModels(): Promise<EngineModelInfo[]>` — return models available through this engine

Every engine implementation SHALL conform to this interface in a way that preserves the shared orchestrator contract. The interface SHALL be defined in `src/bun/engine/types.ts`.

#### Scenario: Native engine implements ExecutionEngine
- **WHEN** the engine resolver instantiates the native engine
- **THEN** the returned object satisfies the `ExecutionEngine` interface and all four methods are callable

#### Scenario: Copilot engine implements ExecutionEngine
- **WHEN** the engine resolver instantiates the copilot engine
- **THEN** the returned object satisfies the `ExecutionEngine` interface and all four methods are callable

#### Scenario: Claude engine implements ExecutionEngine
- **WHEN** the engine resolver instantiates the Claude engine
- **THEN** the returned object satisfies the shared `ExecutionEngine` contract, including execution resumption for paused Claude flows

#### Scenario: execute returns an async iterable of EngineEvent
- **WHEN** `engine.execute(params)` is called
- **THEN** the return value is an `AsyncIterable<EngineEvent>` that yields events until the execution completes or is cancelled

### Requirement: ExecutionParams carries all context needed for an execution
The `ExecutionParams` type SHALL include: `executionId` (number), `taskId` (number), `prompt` (string — resolved prompt or user message), `systemInstructions` (optional string — resolved stage_instructions), `workingDirectory` (string — worktree path), `model` (string — engine-specific model ID), `signal` (AbortSignal), and `conversationHistory` (optional `ConversationMessage[]` — for engines that rebuild context from history).

#### Scenario: ExecutionParams created for column transition
- **WHEN** a task transitions to a column with `on_enter_prompt`
- **THEN** the orchestrator constructs `ExecutionParams` with the resolved prompt, column's stage_instructions, task worktree path, task model, a fresh AbortSignal, and a new executionId

#### Scenario: ExecutionParams created for human turn
- **WHEN** a user sends a message on a task
- **THEN** the orchestrator constructs `ExecutionParams` with the user message as `prompt`, column's stage_instructions, task worktree path, task model, and a fresh AbortSignal

### Requirement: EngineEvent is a discriminated union covering all execution outputs
The `EngineEvent` type SHALL remain the shared event contract for all engines, including non-native interactive pauses. It SHALL be a discriminated union on the `type` field with the following variants:
- `token` — streamed text content
- `reasoning` — model reasoning/thinking content
- `tool_start` — a tool call is beginning (name + arguments)
- `tool_result` — a tool call completed (name + result + optional isError), and MAY include `writtenFiles` for structured file changes produced by that tool call
- `ask_user` — execution is pausing to ask the user a question
- `shell_approval` — execution is pausing for shell command approval
- `status` — informational status message
- `usage` — token usage stats (inputTokens, outputTokens)
- `done` — execution completed (optional summary)
- `error` — execution error (message + optional fatal flag)

#### Scenario: Token events stream text content to the UI
- **WHEN** the engine yields `{ type: "token", content: "Hello" }`
- **THEN** the orchestrator relays the content to the frontend via `stream.token` RPC

#### Scenario: Done event signals execution completion
- **WHEN** the engine yields `{ type: "done" }`
- **THEN** the orchestrator persists the accumulated assistant response and updates execution state to `completed`

#### Scenario: Error event signals execution failure
- **WHEN** the engine yields `{ type: "error", message: "API timeout", fatal: true }`
- **THEN** the orchestrator updates execution state to `failed` and relays the error to the frontend

#### Scenario: ask_user event pauses execution
- **WHEN** the engine yields `{ type: "ask_user", question: "Which approach?" }`
- **THEN** the orchestrator writes an `ask_user_prompt` message, sets execution state to `waiting_user`, and relays the question to the frontend

#### Scenario: shell_approval event pauses a non-native execution
- **WHEN** a non-native engine yields a `shell_approval` event
- **THEN** the orchestrator writes an `ask_user_prompt` conversation message with a shell-approval payload, marks the task and execution as `waiting_user`, and keeps the execution resumable

#### Scenario: Tool result includes structured file-change metadata
- **WHEN** an engine yields `tool_result` with `writtenFiles`
- **THEN** the orchestrator and UI can correlate file changes to that same tool call without tool-name heuristics

### Requirement: Engine resolver instantiates the correct engine from workspace config
The system SHALL resolve the execution engine from the workspace that owns the task being executed, not from a single global workspace config. Supported engine types SHALL include `native`, `copilot`, and `claude`.

#### Scenario: Task execution uses owning workspace config
- **WHEN** a task belongs to a board in workspace A
- **THEN** `resolveEngine` uses workspace A's resolved config for that execution

#### Scenario: Copilot engine resolved from config
- **WHEN** `workspace.yaml` has `engine.type: copilot`
- **THEN** `resolveEngine` returns an instance of `CopilotEngine`

#### Scenario: Claude engine resolved from config
- **WHEN** `workspace.yaml` has `engine.type: claude`
- **THEN** `resolveEngine` returns an instance of `ClaudeEngine`

#### Scenario: Unknown engine type rejected
- **WHEN** `workspace.yaml` has `engine.type: unsupported`
- **THEN** `resolveEngine` throws an error indicating the engine type is not supported

#### Scenario: Concurrent executions use different workspace engines
- **WHEN** one running task belongs to a `native` workspace and another running task belongs to a `copilot` or `claude` workspace
- **THEN** both executions proceed concurrently using their own workspace-specific engine instances and config

### Requirement: Orchestrator consumes engine events and handles persistence and relay
The orchestrator SHALL consume the `AsyncIterable<EngineEvent>` produced by the engine and handle all engine-agnostic concerns: persisting conversation messages to the database, relaying streaming tokens to the frontend via RPC, updating execution and task state in the database, managing cancellation/resume lifecycle, and recording token usage.

For non-native engines that pause for input, the orchestrator SHALL treat `waiting_user` as a resumable state rather than a terminal stop.

#### Scenario: Orchestrator persists tool call messages
- **WHEN** the orchestrator receives `tool_start` and `tool_result` events
- **THEN** it writes `tool_call` and `tool_result` conversation messages to the database

#### Scenario: Orchestrator accumulates tokens into assistant message
- **WHEN** the orchestrator receives a sequence of `token` events followed by a `done` event
- **THEN** it persists a single assistant message containing the concatenated token content

#### Scenario: Orchestrator relays tokens to frontend in real time
- **WHEN** the orchestrator receives a `token` event
- **THEN** it immediately sends a `stream.token` RPC message to the frontend

#### Scenario: Orchestrator handles AbortController lifecycle
- **WHEN** a new execution starts
- **THEN** an AbortController is registered in the execution map; when the execution ends (done/error/cancel), the controller is removed

#### Scenario: Orchestrator updates execution state on completion
- **WHEN** the orchestrator receives a `done` event
- **THEN** it updates `execution.status` to `completed` and `task.execution_state` to `completed` in the database

#### Scenario: Orchestrator updates execution state on error
- **WHEN** the orchestrator receives a fatal `error` event
- **THEN** it updates `execution.status` to `failed` and `task.execution_state` to `failed` in the database

#### Scenario: Waiting-user execution remains resumable
- **WHEN** a non-native execution pauses for a question or approval request
- **THEN** the task remains associated with the paused execution ID and the execution is not finalized as completed, failed, or cancelled

#### Scenario: User reply resumes paused execution instead of starting a new one
- **WHEN** a task is in `waiting_user` because a non-native execution requested input
- **THEN** the orchestrator routes the reply into `engine.resume(...)` for the same execution rather than creating a fresh execution row

### Requirement: Orchestrator resolves slash references before passing to engine
The orchestrator SHALL detect when an `on_enter_prompt` or user message begins with a `/stem` pattern and resolve it using the task's project worktree. The resolved plain text SHALL be passed to the engine as the `prompt` field. Engines SHALL NOT need to understand Railyin's prompt file system.

#### Scenario: Slash reference in on_enter_prompt resolved by orchestrator
- **WHEN** a column has `on_enter_prompt: /opsx-propose add-dark-mode`
- **THEN** the orchestrator resolves the prompt file, substitutes `$input`, and passes the resulting text as `ExecutionParams.prompt`

#### Scenario: Slash reference in user message resolved by orchestrator
- **WHEN** a user sends `/opsx-explore caching strategy`
- **THEN** the orchestrator resolves the prompt, substitutes `$input` with `caching strategy`, and passes the result as `ExecutionParams.prompt`

#### Scenario: Non-slash messages passed unchanged
- **WHEN** a user sends "Please fix the bug in parser.ts"
- **THEN** the orchestrator passes the text unchanged as `ExecutionParams.prompt`


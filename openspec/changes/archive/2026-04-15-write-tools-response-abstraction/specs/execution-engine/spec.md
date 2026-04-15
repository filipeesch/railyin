## MODIFIED Requirements

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

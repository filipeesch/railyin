## ADDED Requirements

### Requirement: Cursor SDK engine support

The system SHALL support `cursor` as an engine type, providing agent execution capabilities through the `@cursor/sdk` package.

#### Scenario: Cursor engine selection

- **WHEN** a user selects a `cursor/...` model in model selection
- **THEN** Railyin instantiates a `CursorEngine`
- **AND** the engine delegates SDK calls to a `CursorSdkAdapter` configured with the workspace's Cursor `api_key`
- **AND** model identifiers are exposed as `cursor/${sdkModelId}` (e.g. `cursor/claude-sonnet-4-6`); the engine strips the `cursor/` prefix before passing the id to the SDK

### Requirement: Subprocess-isolated SDK runtime

The system SHALL run the Cursor SDK in a Node.js subprocess, not in the Bun parent process.

#### Scenario: Worker spawn and IPC

- **WHEN** the first call to `CursorSdkAdapter.run` or `CursorSdkAdapter.listModels` arrives
- **THEN** Railyin spawns a Node worker (`cursor/worker.mjs`) using `node` (or the binary referenced by `RAILYIN_CURSOR_NODE`)
- **AND** the worker signals readiness with `{ "type": "ready" }` on stdout before Railyin sends any request
- **AND** subsequent calls reuse the same long-lived worker

#### Scenario: Worker crash recovery

- **WHEN** the worker process exits unexpectedly while runs are active
- **THEN** every active run receives a fatal `EngineEvent.error` describing the worker exit
- **AND** any pending tool-call promises are rejected
- **AND** the next adapter call respawns the worker

### Requirement: Per-conversation agent lifecycle

The system SHALL maintain one Cursor agent per `conversation_id`, resuming the prior agent across turns so SDK-side chat history is preserved.

#### Scenario: First execution on a conversation

- **WHEN** an execution starts and no `agent_id` is persisted in `cursor_sessions` for the `conversation_id`
- **THEN** the worker calls `Agent.create({ apiKey, model, local: { cwd, customTools } })`
- **AND** sends the prompt via `agent.send(prompt)`
- **AND** the worker emits an `agentCreated` IPC message with the newly assigned `agentId`
- **AND** the Bun side persists `{ conversation_id, agent_id }` in `cursor_sessions`
- **AND** the agent's working directory is the task's worktree path

#### Scenario: Subsequent execution resumes the agent

- **WHEN** an execution starts and `cursor_sessions` already has an `agent_id` for the `conversation_id`
- **THEN** the engine forwards the stored `agentId` to the worker via `StartRunRequest.agentId`
- **AND** the worker calls `Agent.resume(agentId, { apiKey, model, local: { cwd, customTools } })`
- **AND** the worker does NOT emit `agentCreated`
- **AND** the Bun side updates `last_used_at` on the row

#### Scenario: Resume failure falls back to create

- **WHEN** `Agent.resume(agentId, ...)` throws (agent deleted, local store missing, server-side eviction)
- **THEN** the worker logs a warning, calls `Agent.create(...)`, and emits `agentCreated` with the new `agentId`
- **AND** the Bun side overwrites the stored `agent_id` for that `conversation_id`

#### Scenario: In-turn resume is rejected to force fresh execution

- **WHEN** `CursorEngine.resume(executionId, input)` is called (suspend-loop tools)
- **THEN** it throws an `Error`
- **AND** the calling `HumanTurnExecutor` falls into its fallback restart branch, which starts a new execution with the user input prepended to the prompt

#### Scenario: Conversation deletion cleans up the session

- **WHEN** a row in `conversations` is deleted
- **THEN** the matching `cursor_sessions` row is removed via `ON DELETE CASCADE`

### Requirement: Session persistence storage

The system SHALL persist the Cursor `agent_id` per conversation in a dedicated table.

#### Scenario: Schema

- **WHEN** migrations run
- **THEN** a table `cursor_sessions` exists with columns `conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE`, `agent_id TEXT NOT NULL`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`, `last_used_at TEXT NOT NULL DEFAULT (datetime('now'))`

#### Scenario: Repository contract

- **WHEN** `CursorSessionRepository` is constructed
- **THEN** it exposes `getAgentId(conversationId)`, `upsert(conversationId, agentId)`, `touch(conversationId)`, and `delete(conversationId)`
- **AND** `upsert` uses `INSERT ... ON CONFLICT(conversation_id) DO UPDATE SET agent_id = excluded.agent_id, last_used_at = datetime('now')`

### Requirement: IPC for agent resume

The worker IPC SHALL carry the per-conversation `agent_id` from Bun to the worker and report newly created ids back.

#### Scenario: StartRun carries optional agentId

- **WHEN** the Bun adapter sends `startRun`
- **THEN** it includes `agentId` exactly when the engine has a persisted id for the conversation

#### Scenario: Worker reports new agent ids

- **WHEN** the worker calls `Agent.create(...)` (either no `agentId` was provided, or `Agent.resume` failed)
- **THEN** it emits `{ type: "agentCreated", runId, agentId }` to the Bun parent before the first stream event
- **AND** the Bun adapter dispatches the message to the run's `onAgentCreated` callback

### Requirement: Streaming event translation

The system SHALL translate `@cursor/sdk` `SDKMessage` events to Railyin's `EngineEvent` stream format and SHALL relay them across the IPC boundary.

#### Scenario: Token streaming

- **WHEN** the SDK emits a `type: "assistant"` message containing text blocks
- **THEN** the worker yields one `EngineEvent` of `type: "token"` per non-empty content concatenation
- **AND** the Bun adapter forwards it to the caller's async iterable

#### Scenario: Reasoning

- **WHEN** the SDK emits a `type: "thinking"` message with a non-empty `text`
- **THEN** the worker yields `EngineEvent` of `type: "reasoning"`

#### Scenario: Tool call lifecycle

- **WHEN** the SDK emits a `type: "tool_call"` message with `status: "running"`
- **THEN** a `tool_start` `EngineEvent` is yielded with `name`, stringified `arguments`, and `callId`
- **AND** when a `type: "tool_call"` message with `status: "completed"` or `status: "error"` follows
- **THEN** a `tool_result` `EngineEvent` is yielded with the same `callId`, stringified `result`, and `isError` set when applicable

#### Scenario: Run completion

- **WHEN** the SDK stream ends
- **THEN** the worker awaits `run.wait()`
- **AND** if `result.status === "error"` the adapter emits a fatal `EngineEvent.error` with the SDK's error detail (or "Cursor agent run failed with no detail" when the SDK omits it)
- **AND** otherwise the adapter emits an `EngineEvent` of `type: "done"`

### Requirement: Custom tool registration and proxying

The system SHALL register Railyin's common task tools and MCP-registry tools as Cursor `SDKCustomTool` entries, with execution proxied from the worker back to the Bun parent.

#### Scenario: Bun side: schema-only export

- **WHEN** `CursorSdkAdapter.run` is invoked with a `customTools` map
- **THEN** only each tool's `name`, `description`, and `inputSchema` are serialised across IPC
- **AND** the tool's `execute` function stays in the Bun process

#### Scenario: Worker side: proxy invocation

- **WHEN** the SDK invokes a registered custom tool during a run
- **THEN** the worker sends a `toolCall` IPC message with a fresh `callId`, `runId`, `toolName`, and `args`
- **AND** the worker awaits a matching `toolResult` IPC message before returning to the SDK

#### Scenario: Bun side: tool dispatch and response

- **WHEN** the Bun adapter receives a `toolCall` IPC message
- **THEN** it looks up the active run by `runId`, resolves the named tool, and invokes its `execute(args)`
- **AND** sends back a `toolResult` IPC message with either `result` or an `error` string

#### Scenario: Suspend-loop tools terminate the run

- **WHEN** a common tool returns `{ type: "suspend", payload }` (e.g. `decision_request`)
- **THEN** the engine's `onSuspend` callback records the payload and aborts the run
- **AND** after the SDK stream cuts, the engine yields a `decision_request` `EngineEvent` with the recorded payload

### Requirement: Built-in tools remain available with steering

The system SHALL leave Cursor's built-in tools enabled (the SDK does not expose a disable knob) AND SHALL steer the agent toward Railyin-native bypass tools where the built-ins are unreliable.

#### Scenario: Bypass tools registered

- **WHEN** a run starts with a worktree path
- **THEN** `railyin_shell`, `railyin_grep`, `railyin_glob`, and `railyin_read` are registered as `customTools` rooted at the worktree
- **AND** the composed prompt includes a "Tool routing (IMPORTANT)" prefix instructing the agent to prefer them over the SDK's `Shell` / `Grep` / `Glob` / `Read`

### Requirement: Model listing

The system SHALL list Cursor models available to the configured `api_key`.

#### Scenario: Models listed

- **WHEN** the engine registry calls `CursorEngine.listModels`
- **THEN** the worker calls `Cursor.models.list({ apiKey })`
- **AND** Railyin returns each as `{ qualifiedId: 'cursor/' + id, displayName, description }`

#### Scenario: Missing API key

- **WHEN** neither `engines.yaml` nor `CURSOR_API_KEY` provides an API key
- **THEN** `listModels` returns an empty array and logs a warning

### Requirement: Engine configuration

The system SHALL accept `cursor` engine configuration via `engines.yaml` with an optional `api_key`.

#### Scenario: Config with API key

- **WHEN** `engines.yaml` contains an engine entry of `type: "cursor"` with `api_key: "..."`
- **THEN** the adapter uses that key for both `Agent.create` and `Cursor.models.list`

#### Scenario: Fallback to environment variable

- **WHEN** `engines.yaml` omits `api_key`
- **THEN** the adapter falls back to `process.env.CURSOR_API_KEY`
- **AND** if neither is set, runs fail fast with a clear authentication error and `listModels` returns an empty list

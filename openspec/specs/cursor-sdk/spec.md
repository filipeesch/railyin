## Purpose
Defines the Cursor SDK engine integration: how Railyin spawns and talks to the `@cursor/sdk` runtime in a Node subprocess, how SDK events are translated to `EngineEvent`s, how per-conversation agent identity is derived and resumed, how Railyin's common tools and MCP tools are registered as Cursor `SDKCustomTool` entries, and how the engine is configured and discovered.

## Requirements

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

The system SHALL use a caller-defined deterministic Cursor `agentId` per conversation and resume the same agent across turns so SDK-side chat history is preserved without any Railyin-side persistence.

#### Scenario: Deterministic id derivation

- **WHEN** an execution starts on a conversation
- **THEN** the engine computes `agentId` as a UUIDv5 derived from a fixed Railyin namespace and the name `task:${taskId}` when the conversation is task-scoped, or `conversation:${conversationId}` otherwise
- **AND** forwards it to the worker via `StartRunRequest.agentId`
- **AND** the derivation is pure: the same `(taskId, conversationId)` always yields the same UUID, and task-scoped ids are independent of `conversationId`

#### Scenario: First execution on a conversation

- **WHEN** the worker receives `startRun` and `Agent.resume(agentId, ...)` throws (no agent exists yet)
- **THEN** the worker calls `Agent.create({ agentId, apiKey, model, local: { cwd, customTools, settingSources: ["project"] } })` with the same caller-supplied `agentId`
- **AND** sends the prompt via `agent.send(prompt)`
- **AND** the agent's working directory is the task's worktree path
- **AND** if `agent.send(prompt)` throws `AgentBusyError`, the worker retries with `{ local: { force: true } }`

#### Scenario: Subsequent execution resumes the agent

- **WHEN** the worker receives `startRun` with the same `agentId` and an agent already exists in the SDK's local store
- **THEN** `Agent.resume(agentId, { apiKey, model, local: { cwd, customTools, settingSources: ["project"] } })` succeeds and returns the prior agent
- **AND** the worker does NOT call `Agent.create`

#### Scenario: Resume failure of an existing agent falls back to create

- **WHEN** `Agent.resume(agentId, ...)` throws for any reason
- **THEN** the worker falls back to `Agent.create({ ...baseOptions, agentId })` with the same `agentId`
- **AND** the new agent can be resumed on future turns

#### Scenario: In-turn resume is rejected to force fresh execution

- **WHEN** `CursorEngine.resume(executionId, input)` is called (suspend-loop tools)
- **THEN** it throws an `Error`
- **AND** the calling `HumanTurnExecutor` falls into its fallback restart branch, which starts a new execution with the user input prepended to the prompt

### Requirement: IPC for agent resume

The worker IPC SHALL carry the per-conversation `agent_id` from Bun to the worker.

#### Scenario: StartRun carries the deterministic agentId

- **WHEN** the Bun adapter sends `startRun`
- **THEN** it includes `agentId` derived from `(taskId, conversationId)` (see Per-conversation agent lifecycle)

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

### Requirement: Slash command resolution via CursorDialect
The system SHALL resolve slash-command references in Cursor engine prompts via `CursorDialect.resolvePrompt()` before dispatching to the SDK. Raw slash references SHALL never be sent to the Cursor SDK unresolved.

#### Scenario: on_enter_prompt with slash reference is expanded
- **WHEN** a task transitions to a column whose `on_enter_prompt` is `/gsd-execute-phase`
- **THEN** `CursorEngine` resolves it via `CursorDialect.resolvePrompt()` to the XML-wrapped file body
- **AND** the resolved content is sent to the Cursor SDK as the agent prompt, not the raw `/gsd-execute-phase` string

#### Scenario: Plain prompt is passed through unchanged
- **WHEN** the prompt does not start with a slash reference
- **THEN** `CursorEngine` sends it to the SDK unchanged

### Requirement: Skill content injected into system-instructions prefix
The system SHALL inject the content of `SKILL.md` files from `CursorDialect.getSkillPaths()` into the system-instructions prefix that is prepended to every Cursor agent run, so agents have project skill context on every turn.

#### Scenario: Skills prepended to prompt prefix
- **WHEN** `.cursor/skills/<name>/SKILL.md` files exist in the paths returned by `getSkillPaths()`
- **THEN** each `SKILL.md` content is read and prepended to the `systemBlock` in the Cursor engine's prompt prefix
- **AND** each skill section is preceded by a header identifying the skill directory name

#### Scenario: No skill directories — no change to prefix
- **WHEN** no `.cursor/skills/` directories exist for the task's paths
- **THEN** the prompt prefix is unchanged (no empty section is injected)

### Requirement: Cursor native project rules loaded automatically
The system SHALL pass `settingSources: ["project"]` to the Cursor SDK's local agent options so `.cursorrules` and `.cursor/rules/*.mdc` files are loaded automatically on every run.

#### Scenario: settingSources injected in worker startRun
- **WHEN** the Bun adapter sends a `startRun` message to the worker
- **THEN** the worker includes `settingSources: ["project"]` in the `local` options passed to `Agent.create` / `Agent.resume`
- **AND** the SDK loads `.cursorrules` and `.cursor/rules/*.mdc` from the project working directory

### Requirement: AgentBusyError recovery after decision_request abort
The system SHALL recover transparently from `AgentBusyError` on the subsequent turn after a `decision_request`-triggered run abort, without surfacing an error to the user.

#### Scenario: AgentBusyError on turn following decision_request is retried automatically
- **WHEN** `agent.send(prompt)` throws `AgentBusyError` in the worker
- **THEN** the worker retries immediately with `agent.send(prompt, { local: { force: true } })`
- **AND** the run proceeds normally from that point
- **AND** no error is surfaced to the Bun parent or the user

#### Scenario: Non-AgentBusyError errors are not swallowed
- **WHEN** `agent.send(prompt)` throws an error that is not `AgentBusyError`
- **THEN** the worker propagates the error as a fatal `runDone` status, not as a retry

### Requirement: listCommands resolves paths from DB like other engines
The system SHALL resolve the task's worktree path and project path from the database in `CursorEngine.listCommands()`, identical to the pattern used by `CopilotEngine` and `ClaudeEngine`.

#### Scenario: listCommands returns commands from worktree and project paths
- **WHEN** `CursorEngine.listCommands(taskId)` is called for a task with a known worktree and project
- **THEN** it queries `task_git_context.worktree_path` for the worktree
- **AND** resolves the project path via `getLoadedProjectByKey`
- **AND** delegates to `CursorDialect.listCommands(worktreePath, projectPath)`

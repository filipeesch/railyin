## Purpose
Defines the Cursor SDK engine integration: how Railyin runs the `@cursor/sdk` runtime in-process in the Bun server, how SDK events are translated to `EngineEvent`s, how per-conversation agent identity is derived and resumed, how Railyin's common tools and MCP tools are registered as Cursor `SDKCustomTool` entries, and how the engine is configured and discovered.
## Requirements
### Requirement: Cursor SDK engine support

The system SHALL support `cursor` as an engine type, providing agent execution capabilities through the `@cursor/sdk` package.

#### Scenario: Cursor engine selection

- **WHEN** a user selects a `cursor/...` model in model selection
- **THEN** Railyin instantiates a `CursorEngine`
- **AND** the engine delegates SDK calls to a `CursorSdkAdapter` configured with the workspace's Cursor `api_key`
- **AND** model identifiers are exposed as `cursor/${sdkModelId}` (e.g. `cursor/claude-sonnet-4-6`); the engine strips the `cursor/` prefix before passing the id to the SDK

### Requirement: In-process SDK runtime

The system SHALL run the `@cursor/sdk` directly in the Bun main process. No subprocess, IPC protocol, or external `node` binary dependency SHALL be required for the Cursor engine to function.

#### Scenario: First call constructs the SDK client in-process

- **WHEN** the first call to `CursorSdkAdapter.run` or `CursorSdkAdapter.listModels` arrives
- **THEN** the adapter calls `@cursor/sdk`'s `Agent`/`Cursor` APIs directly, in the same process and event loop as the rest of the Bun server
- **AND** no child process is spawned

#### Scenario: SDK-side errors surface without a worker-crash path

- **WHEN** an SDK call throws or an in-flight run errors
- **THEN** the adapter surfaces the failure as a fatal `EngineEvent.error` directly from the `catch` block of the call site
- **AND** there is no separate "worker exit" recovery path, because there is no worker process to exit independently of the Bun server itself

#### Scenario: Abort-listener suppression is scoped to the Bun process

- **WHEN** the adapter module is loaded
- **THEN** it calls `setMaxListeners(0)` to suppress Node's `MaxListenersExceededWarning` for the SDK's internal abort-listener accumulation across repeated `Agent.create`/`Agent.resume` calls
- **AND** this suppression applies process-wide (accepted trade-off; the Bun server has no other high-volume `AbortSignal` listener source that this would need to mask)

### Requirement: Per-conversation agent lifecycle

The system SHALL use a caller-defined deterministic Cursor `agentId` per conversation and resume the same agent across turns so SDK-side chat history is preserved without any Railyin-side persistence.

#### Scenario: Deterministic id derivation

- **WHEN** an execution starts on a conversation
- **THEN** the engine computes `agentId` as a UUIDv5 derived from a fixed Railyin namespace and the name `task:${taskId}` when the conversation is task-scoped, or `conversation:${conversationId}` otherwise
- **AND** passes it directly to the in-process adapter's `run()` call as part of `CursorRunConfig`
- **AND** the derivation is pure: the same `(taskId, conversationId)` always yields the same UUID, and task-scoped ids are independent of `conversationId`

#### Scenario: First execution on a conversation

- **WHEN** the adapter starts a run and `Agent.resume(agentId, ...)` throws (no agent exists yet)
- **THEN** the adapter calls `Agent.create({ agentId, apiKey, model, local: { cwd, customTools, settingSources: ["project"] } })` with the same caller-supplied `agentId`
- **AND** sends the prompt via `agent.send(prompt)`
- **AND** the agent's working directory is the task's worktree path
- **AND** if `agent.send(prompt)` throws `AgentBusyError`, the adapter retries with `{ local: { force: true } }`

#### Scenario: Subsequent execution resumes the agent

- **WHEN** the adapter starts a run with the same `agentId` and an agent already exists in the SDK's local store
- **THEN** `Agent.resume(agentId, { apiKey, model, local: { cwd, customTools, settingSources: ["project"] } })` succeeds and returns the prior agent
- **AND** the adapter does NOT call `Agent.create`

#### Scenario: Resume failure of an existing agent falls back to create

- **WHEN** `Agent.resume(agentId, ...)` throws for any reason
- **THEN** the adapter falls back to `Agent.create({ ...baseOptions, agentId })` with the same `agentId`
- **AND** the new agent can be resumed on future turns

#### Scenario: In-turn resume is rejected to force fresh execution

- **WHEN** `CursorEngine.resume(executionId, input)` is called (suspend-loop tools)
- **THEN** it throws an `Error`
- **AND** the calling `HumanTurnExecutor` falls into its fallback restart branch, which starts a new execution with the user input prepended to the prompt

### Requirement: Streaming event translation

The system SHALL translate `@cursor/sdk` `SDKMessage` events to Railyin's `EngineEvent` stream format directly in-process. Tool events MUST include display metadata, structured result data, and file diff information.

#### Scenario: Token streaming
- **WHEN** the SDK emits a `type: "assistant"` message containing text blocks
- **THEN** the adapter yields one `EngineEvent` of `type: "token"` per non-empty content concatenation to the caller's async iterable

#### Scenario: Reasoning
- **WHEN** the SDK emits a `type: "thinking"` message with a non-empty `text`
- **THEN** the adapter yields an `EngineEvent` of `type: "reasoning"`

#### Scenario: Tool call start includes display metadata
- **WHEN** the SDK emits a `type: "tool_call"` message with `status: "running"`
- **THEN** a `tool_start` `EngineEvent` is yielded with `name`, stringified `arguments`, `callId`, and `display` metadata (including `label`, `subject`, and `contentType`)
- **AND** the `display.label` uses lowercase tool names matching the SDK (e.g., `"read"`, `"shell"`, `"edit"`, `"write"`, `"delete"`, `"glob"`, `"grep"`)
- **AND** the `display.subject` extracts the primary argument (file path for read/write/edit/delete, command for shell, pattern for glob/grep)

#### Scenario: Tool call completion includes structured result
- **WHEN** the SDK emits a `type: "tool_call"` message with `status: "completed"` or `status: "error"`
- **THEN** a `tool_result` `EngineEvent` is yielded with the same `callId`, stringified `result`, `isError` set when applicable, and `display` metadata
- **AND** when the tool is `shell`, the `detailedResult` is set to `result.value.stdout` (with stderr appended if present)
- **AND** when the tool is `edit` or `write` with a `diffString`, the `writtenFiles` is set to parsed `FileDiffPayload` entries with hunks
- **AND** when the tool is `read`, the `result` contains the file content

#### Scenario: Run completion
- **WHEN** the SDK stream ends
- **THEN** the adapter awaits `run.wait()`
- **AND** if `result.status === "error"` the adapter emits a fatal `EngineEvent.error` with the SDK's error detail (or "Cursor agent run failed with no detail" when the SDK omits it)
- **AND** otherwise the adapter emits an `EngineEvent` of `type: "done"`


#### Scenario: Status transitions carry the real status value
- **WHEN** the SDK emits a `type: "status"` message
- **THEN** the adapter yields an `EngineEvent` of `type: "status"` whose `message` field is derived from the SDK message's `status` field (e.g. `"RUNNING"`, `"FINISHED"`, `"ERROR"`)
- **AND** the adapter does NOT read a non-existent `message.message` field
- **AND** if `status` is absent for any reason, the `message` field falls back to an empty string rather than throwing
### Requirement: Custom tool registration and direct execution

The system SHALL register Railyin's common task tools and MCP-registry tools as Cursor `SDKCustomTool` entries, with `execute` invoked directly in-process — no serialization boundary or proxy round-trip.

#### Scenario: Tool schema and execute registered together

- **WHEN** `CursorSdkAdapter.run` is invoked with a `customTools` map
- **THEN** each tool's `name`, `description`, `inputSchema`, and `execute` function are passed directly to the SDK's `Agent.create`/`Agent.resume` `local.customTools` option
- **AND** no cross-process serialization of tool schemas or arguments occurs

#### Scenario: Direct tool invocation

- **WHEN** the SDK invokes a registered custom tool during a run
- **THEN** the tool's `execute(args)` function runs synchronously in the same process as the SDK call, returning its result (or throwing) directly to the SDK without any intermediate message passing

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
- **THEN** the adapter calls `Cursor.models.list({ apiKey })` directly in-process
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

#### Scenario: settingSources included in agent options
- **WHEN** the adapter calls `Agent.create` or `Agent.resume`
- **THEN** it includes `settingSources: ["project"]` in the `local` options
- **AND** the SDK loads `.cursorrules` and `.cursor/rules/*.mdc` from the project working directory

### Requirement: AgentBusyError recovery after decision_request abort
The system SHALL retry a busy Cursor agent once with `force:true` after a `decision_request`-triggered abort, and SHALL attempt same-id agent recreation and resend in the same turn if the forced retry still reports the agent as busy. The same deterministic `agentId` SHALL be preserved for future turns; no Cursor-specific persistence or id rotation is allowed.

#### Scenario: AgentBusyError on turn following decision_request is retried automatically
- **WHEN** `agent.send(prompt)` throws `AgentBusyError` in the adapter
- **THEN** the adapter retries immediately with `agent.send(prompt, { local: { force: true } })`
- **AND** if the retry succeeds, the run proceeds normally from that point

#### Scenario: Persistent busy after force triggers same-id recreation and resend
- **WHEN** `agent.send(prompt, { local: { force: true } })` still throws `AgentBusyError`
- **THEN** the adapter recreates the same agent id and resends the prompt in the same turn
- **AND** if the recreated agent is still busy, the adapter ends the current execution cleanly
- **AND** the next turn can reuse the same deterministic `agentId`

#### Scenario: Non-AgentBusyError errors are not swallowed
- **WHEN** `agent.send(prompt)` throws an error that is not `AgentBusyError`
- **THEN** the adapter propagates the error as a fatal error event, not as a retry

### Requirement: listCommands resolves paths from DB like other engines
The system SHALL resolve the task's worktree path and project path from the database in `CursorEngine.listCommands()`, identical to the pattern used by `CopilotEngine` and `ClaudeEngine`.

#### Scenario: listCommands returns commands from worktree and project paths
- **WHEN** `CursorEngine.listCommands(taskId)` is called for a task with a known worktree and project
- **THEN** it queries `task_git_context.worktree_path` for the worktree
- **AND** resolves the project path via `getLoadedProjectByKey`
- **AND** delegates to `CursorDialect.listCommands(worktreePath, projectPath)`
### Requirement: HTTP/1.1 forcing for local-agent SDK transport

The system SHALL configure the Cursor SDK, once at adapter module load, to use HTTP/1.1 with SSE instead of HTTP/2 for local-agent backend streams, to avoid a known, unfixed upstream HTTP/2 session-teardown bug class in the SDK's bundled `@connectrpc/connect-node` transport.

#### Scenario: SDK configured for HTTP/1.1 before first agent call
- **WHEN** the Cursor adapter module is loaded (before any `Agent.create`/`Agent.resume` call)
- **THEN** it calls `Cursor.configure({ local: { useHttp1ForAgent: true } })`
- **AND** this configuration applies process-wide to all subsequent local-agent SDK calls

### Requirement: Per-run stall watchdog

The system SHALL detect when an active Cursor run's SDK message stream stops emitting for longer than an inactivity threshold appropriate to whether the run is idly waiting on the assistant/SDK or is legitimately busy executing a tool call, and SHALL terminate that run with a fatal `EngineEvent.error` rather than allowing it to hang indefinitely.

#### Scenario: Stream inactivity triggers a fatal error
- **WHEN** no SDK message is received from `run.stream()` for longer than the configured stall threshold, and the run has not been aborted (cancelled by the caller, superseded by decision_request, etc.)
- **THEN** the adapter treats the run as stalled: it best-effort cancels the underlying SDK run, yields exactly one fatal `EngineEvent.error` identifying the failure as a stall timeout, and stops iterating the stream
- **AND** the resulting fatal error flows through the same execution/error-handling path as any other fatal `EngineEvent.error`, marking the execution `failed` in the database

#### Scenario: Timer resets on every SDK message
- **WHEN** an SDK message is received from `run.stream()` (of any type, including intermediate `tool_call` "running" updates)
- **THEN** the stall timer is reset, so any streaming progress — not just completed tool calls — postpones a stall determination

#### Scenario: Watchdog does not fire during an intentional abort
- **WHEN** the run's `AbortSignal` has already been triggered (caller cancellation, decision_request suspend, etc.) before the stall threshold elapses
- **THEN** the watchdog does not yield a stall-timeout error; the existing abort-handling path proceeds unchanged

#### Scenario: Watchdog is scoped to the Cursor engine only
- **WHEN** any other engine (Claude, Copilot, Pi, OpenCode, etc.) executes a run
- **THEN** no stall watchdog applies; this mechanism lives entirely inside `CursorEngine`/`InProcessCursorAdapter` and is not part of the shared `ExecutionEngine`/`StreamProcessor` contract

#### Scenario: Stall threshold is configurable per adapter instance
- **WHEN** `InProcessCursorAdapter` is constructed with an explicit `stallTimeoutMs` and/or `toolExecutionStallTimeoutMs` value
- **THEN** the watchdog uses those values instead of the real-world defaults, enabling deterministic, fast tests without waiting out the production thresholds

#### Scenario: A new execution can start after a stall-triggered failure
- **WHEN** a run has been terminated by the stall watchdog (task/execution left in a terminal `failed` state) and the user sends a follow-up message on the same task
- **THEN** the system starts a new execution normally, the same way it would after any other fatal-error failure, with no RPC-level guard blocking the send and no special-casing required beyond the existing failed-execution handling

#### Scenario: An in-flight tool call is judged against a relaxed threshold, not the idle threshold
- **WHEN** a `tool_call` message with `status: "running"` has been received and no matching `"completed"`/`"error"` message for the same `call_id` has been received yet
- **THEN** the watchdog uses the relaxed `toolExecutionStallTimeoutMs` threshold (default 30 minutes) instead of the strict idle `stallTimeoutMs` threshold (default 5 minutes) for determining a stall
- **AND** once the matching `"completed"` or `"error"` message is received for that `call_id`, the run reverts to being judged against the strict idle threshold
- **AND** a tool call that itself produces no further SDK message for longer than the relaxed threshold is still treated as a stall, following the same fatal-error/cancel/log behavior as the idle-threshold case

### Requirement: Structured stall and transport-error logging

The system SHALL log stall-timeout events and observed Cursor-SDK session-closed transport errors as structured, single-line JSON log entries correlated with execution/task/conversation/agent identifiers, so future occurrences are traceable instead of anonymous unhandled-rejection log lines.

#### Scenario: Stall timeout is logged with correlation ids
- **WHEN** the stall watchdog fires for a run
- **THEN** a `console.error` line is emitted containing `executionId`, `taskId`, `conversationId`, and `agentId` (when known), tagged with an event name identifying it as a stall timeout


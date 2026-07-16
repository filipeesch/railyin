## REMOVED Requirements

### Requirement: Subprocess-isolated SDK runtime

**Reason**: The Bun HTTP/2 incompatibility that required isolating `@cursor/sdk` in a Node.js subprocess is fixed upstream as of `@cursor/sdk@1.0.23` (verified via live repro against the real Cursor API on Bun 1.4.0: `1.0.18` fails 3/3 runs with `ERR_HTTP2_SESSION_ERROR`, `1.0.23` succeeds 8/8 runs with zero HTTP/2 errors). Running the SDK in-process removes the subprocess lifecycle, the `node` binary dependency, and the IPC boundary entirely.

**Migration**: See the new "In-process SDK runtime" requirement. No Railyin-side data migration is needed — the subprocess boundary was an internal implementation detail with no persisted state of its own. Deployments relying on `RAILYIN_CURSOR_NODE` to point at a specific `node` binary no longer need to set it; the variable is no longer read.

### Requirement: IPC for agent resume

**Reason**: This requirement existed solely to carry `agentId` across the Bun↔worker IPC boundary. With the SDK running in-process, `agentId` is passed directly as a JS object field to `Agent.create`/`Agent.resume` — no serialization or IPC message is involved.

**Migration**: See "Per-conversation agent lifecycle" (unchanged behavior, updated wording) in the modified requirements below.

## MODIFIED Requirements

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

### Requirement: Model listing

The system SHALL list Cursor models available to the configured `api_key`.

#### Scenario: Models listed

- **WHEN** the engine registry calls `CursorEngine.listModels`
- **THEN** the adapter calls `Cursor.models.list({ apiKey })` directly in-process
- **AND** Railyin returns each as `{ qualifiedId: 'cursor/' + id, displayName, description }`

#### Scenario: Missing API key

- **WHEN** neither `engines.yaml` nor `CURSOR_API_KEY` provides an API key
- **THEN** `listModels` returns an empty array and logs a warning

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

## ADDED Requirements

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

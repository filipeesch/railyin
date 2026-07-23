## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: HTTP/1.1 forcing for local-agent SDK transport

The system SHALL configure the Cursor SDK, once at adapter module load, to use HTTP/1.1 with SSE instead of HTTP/2 for local-agent backend streams, to avoid a known, unfixed upstream HTTP/2 session-teardown bug class in the SDK's bundled `@connectrpc/connect-node` transport.

#### Scenario: SDK configured for HTTP/1.1 before first agent call
- **WHEN** the Cursor adapter module is loaded (before any `Agent.create`/`Agent.resume` call)
- **THEN** it calls `Cursor.configure({ local: { useHttp1ForAgent: true } })`
- **AND** this configuration applies process-wide to all subsequent local-agent SDK calls

### Requirement: Per-run stall watchdog

The system SHALL detect when an active Cursor run's SDK message stream stops emitting for longer than a fixed inactivity threshold while the run is expected to still be actively streaming, and SHALL terminate that run with a fatal `EngineEvent.error` rather than allowing it to hang indefinitely.

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
- **WHEN** `InProcessCursorAdapter` is constructed with an explicit `stallTimeoutMs` value
- **THEN** the watchdog uses that value instead of the real-world default, enabling deterministic, fast tests without waiting out the production threshold

#### Scenario: A new execution can start after a stall-triggered failure
- **WHEN** a run has been terminated by the stall watchdog (task/execution left in a terminal `failed` state) and the user sends a follow-up message on the same task
- **THEN** the system starts a new execution normally, the same way it would after any other fatal-error failure, with no RPC-level guard blocking the send and no special-casing required beyond the existing failed-execution handling

### Requirement: Structured stall and transport-error logging

The system SHALL log stall-timeout events and observed Cursor-SDK session-closed transport errors as structured, single-line JSON log entries correlated with execution/task/conversation/agent identifiers, so future occurrences are traceable instead of anonymous unhandled-rejection log lines.

#### Scenario: Stall timeout is logged with correlation ids
- **WHEN** the stall watchdog fires for a run
- **THEN** a `console.error` line is emitted containing `executionId`, `taskId`, `conversationId`, and `agentId` (when known), tagged with an event name identifying it as a stall timeout

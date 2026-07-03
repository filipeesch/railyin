## MODIFIED Requirements

### Requirement: Streaming event translation

The system SHALL translate `@cursor/sdk` `SDKMessage` events to Railyin's `EngineEvent` stream format and SHALL relay them across the IPC boundary. Tool events MUST include display metadata, structured result data, and file diff information.

#### Scenario: Token streaming
- **WHEN** the SDK emits a `type: "assistant"` message containing text blocks
- **THEN** the worker yields one `EngineEvent` of `type: "token"` per non-empty content concatenation
- **AND** the Bun adapter forwards it to the caller's async iterable

#### Scenario: Reasoning
- **WHEN** the SDK emits a `type: "thinking"` message with a non-empty `text`
- **THEN** the worker yields `EngineEvent` of `type: "reasoning"`

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
- **THEN** the worker awaits `run.wait()`
- **AND** if `result.status === "error"` the adapter emits a fatal `EngineEvent.error` with the SDK's error detail (or "Cursor agent run failed with no detail" when the SDK omits it)
- **AND** otherwise the adapter emits an `EngineEvent` of `type: "done"`

## ADDED Requirements

### Requirement: Tool call parent block assignment ignores reasoningBlockId
The stream processor SHALL assign `parentBlockId` for `tool_call` and `tool_result` stream events using only `event.parentCallId ?? null`. It SHALL NOT fall back to `reasoningBlockId` when `event.parentCallId` is absent.

#### Scenario: Top-level tool call has null parent
- **WHEN** a `tool_call` event has no `parentCallId` and a prior reasoning block exists
- **THEN** the emitted stream event has `parentBlockId: null` (not the reasoning block id)

#### Scenario: Subagent tool call preserves its parentCallId
- **WHEN** a `tool_call` event has `parentCallId` set to the spawning tool's callId
- **THEN** the emitted stream event has `parentBlockId` equal to that callId

#### Scenario: Tool result parent matches tool call parent
- **WHEN** a `tool_result` event is emitted for a top-level tool
- **THEN** its `parentBlockId` is `null`, not the reasoning block id

### Requirement: worktreePath is threaded to display builder functions
The stream processor SHALL pass the execution's `worktreePath` (when available) to `translateCopilotStream`, `translateClaudeMessage`, and any other display builder invocations, so that absolute paths in tool subjects can be relativized.

#### Scenario: Bash subject uses relative path when worktreePath is provided
- **WHEN** a bash tool call subject contains an absolute path starting with the worktreePath
- **THEN** the emitted `ToolCallDisplay.subject` uses the relative path instead

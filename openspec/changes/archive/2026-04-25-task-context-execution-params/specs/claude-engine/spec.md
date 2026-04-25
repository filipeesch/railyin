## MODIFIED Requirements

### Requirement: ClaudeEngine wraps the Claude Agent SDK as an ExecutionEngine
The system SHALL implement `ClaudeEngine` conforming to the shared `ExecutionEngine` contract. It SHALL use `@anthropic-ai/claude-agent-sdk` through an engine-specific adapter that can be replaced in tests. The engine SHALL create or resume Claude sessions, translate SDK messages into `EngineEvent` values (including tool calls and results), and manage task-scoped runtime lease lifecycle for Claude-backed executions.

When `ExecutionParams.taskContext` is present, the Claude adapter SHALL inject the task identity block via the SDK's `SessionStart` hook `additionalContext` mechanism. This ensures the model receives task context at session initialization with higher priority than `systemPrompt.append` content. The `systemPrompt.append` field SHALL carry `systemInstructions` (stage instructions) only.

The message translator SHALL handle all content block types emitted by the Claude SDK:
- **text blocks** → `{ type: "token", content: block.text }`
- **thinking blocks** → `{ type: "reasoning", content: block.thinking }`
- **tool_use blocks** (in assistant messages) → `{ type: "tool_start", callId: block.id, name: block.name, arguments: JSON.stringify(block.input) }`
- **tool_result blocks** (in user messages) → `{ type: "tool_result", callId: block.tool_use_id, name: <paired from tool_use>, result: block.content }`
- **rate_limit events** → `{ type: "status", message: "Claude API rate limited..." }`
- **compaction_summary messages** → `{ type: "status", message: "Context window compacted..." }`

#### Scenario: ClaudeEngine instantiates from config
- **WHEN** `workspace.yaml` has `engine.type: claude`
- **THEN** a `ClaudeEngine` instance is created and ready to accept executions

#### Scenario: ClaudeEngine resumes a task session on later turns
- **WHEN** a later execution starts for the same task and worktree
- **THEN** the engine resumes the task's deterministic Claude session instead of starting from empty context

#### Scenario: ClaudeEngine disconnects active work on cancellation
- **WHEN** `cancel(executionId)` is called for a running Claude execution
- **THEN** the active Claude query/session is interrupted and the engine stops yielding additional events for that execution

#### Scenario: Tool call is translated to tool_start event
- **WHEN** Claude emits an assistant message with a `tool_use` content block (id="call_xyz", name="search", input={...})
- **THEN** the engine yields a `tool_start` event containing callId, name, and JSON arguments, making the tool invocation visible in the conversation timeline

#### Scenario: taskContext is injected via SessionStart hook on new session
- **WHEN** the Claude adapter starts a new session with `taskContext` present
- **THEN** the SDK `SessionStart` hook fires and returns `additionalContext` containing the formatted task block
- **AND** `systemPrompt.append` contains only `systemInstructions` (stage instructions)

#### Scenario: taskContext is injected via SessionStart hook on resumed session
- **WHEN** the Claude adapter resumes an existing session with `taskContext` present
- **THEN** the SDK `SessionStart` hook fires on resume and returns `additionalContext` with the task block

#### Scenario: No taskContext means no hook additionalContext
- **WHEN** the Claude adapter runs with `taskContext` undefined (e.g., chat session)
- **THEN** the `SessionStart` hook is not registered or returns no `additionalContext`

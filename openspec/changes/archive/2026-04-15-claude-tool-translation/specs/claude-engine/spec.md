## MODIFIED Requirements

### Requirement: ClaudeEngine wraps the Claude Agent SDK as an ExecutionEngine
The system SHALL implement `ClaudeEngine` conforming to the shared `ExecutionEngine` contract. It SHALL use `@anthropic-ai/claude-agent-sdk` through an engine-specific adapter that can be replaced in tests. The engine SHALL create or resume Claude sessions, translate SDK messages into `EngineEvent` values (including tool calls and results), and manage session lifecycle for Claude-backed executions.

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

#### Scenario: Tool result is paired with preceding tool call
- **WHEN** Claude emits a user message with a `tool_result` content block (tool_use_id="call_xyz", content="Found 3 results")
- **THEN** the engine yields a `tool_result` event with the tool name (looked up from the preceding tool_use), result content, and callId, creating a tool_call↔result pair in the conversation

#### Scenario: Tool result is surfaced even if preceding tool_use was missed
- **WHEN** a tool_result block references a tool_use_id that was never seen in the raw stream (e.g., due to capture gap)
- **THEN** the engine yields a `tool_result` event with name="unknown" instead of failing, allowing partial recovery and logging the anomaly

#### Scenario: Rate limit event is surfaced as status
- **WHEN** the Claude SDK emits a rate_limit_event in a result message
- **THEN** the engine yields a `status` event informing the user that the API is rate limited and retrying

#### Scenario: Compaction summary is surfaced to provide transparency
- **WHEN** the Claude SDK emits a system message with subtype="compaction_summary"
- **THEN** the engine yields a `status` event showing users that context window management occurred (e.g., "Context window compacted. Conversation summary created to reduce tokens.")

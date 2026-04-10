## Purpose
The spawn_agent capability lets an AI agent delegate sub-tasks to parallel in-memory child executions that share the parent task's worktree, enabling parallel workstreams within a single task execution.

## Requirements

### Requirement: spawn_agent runs parallel sub-executions in the parent worktree
The system SHALL provide a `spawn_agent` tool that, when called, fans out one or more in-memory child executions in parallel. Each child receives its own `instructions` string and `tools` list. All children share the parent task's worktree. The tool SHALL return a JSON array of result strings (one per child) to the parent execution. When `parentContext` is provided, children inherit the parent's assembled message context (appending instructions to the final user message) and use `parentToolDefs` for API calls — the child's declared `tools` serve only as an execution whitelist. This ensures the API request prefix (tools + system) is byte-identical between parent and child, enabling prompt cache hits. Tool definitions SHALL be sorted by name to ensure byte-identical API request prefixes across concurrent children.

#### Scenario: Multiple children run in parallel
- **WHEN** an agent calls `spawn_agent` with N child descriptors
- **THEN** all N children run concurrently (Promise.all) and each child's API request prefix (system message + tool definitions) is byte-identical

#### Scenario: Sub-agent system message includes worktree path
- **WHEN** `runSubExecution` constructs `liveMessages` for a child
- **THEN** the first message is `{ role: "system", content: "<orchestrator intro>\n\n## Environment\n- worktree_path: <path>" }` followed by `{ role: "user", content: instructions }`; the worktree_path is identical for all parallel children so the system message is byte-identical across runs, preserving cache sharing

#### Scenario: Tool definitions are sorted by name for prefix stability
- **WHEN** `runSubExecution` resolves tool definitions via `resolveToolsForColumn`
- **THEN** the resulting array is sorted by `name` (ascending) before being passed to `retryTurn`

#### Scenario: Sub-agent uses parent tool definitions for cache sharing
- **WHEN** `runSubExecution` receives `parentToolDefs`
- **THEN** the API call uses `parentToolDefs` (not the child's resolved tools) so the tools_hash matches the parent's, enabling cache prefix reuse

#### Scenario: Sub-agent tool whitelist enforcement
- **WHEN** a sub-agent receives `parentToolDefs` and the model calls a tool that is in `parentToolDefs` but NOT in the child's declared `tools` list
- **THEN** the engine returns an error tool_result: `Error: tool "<name>" is not available to this sub-agent. Available tools: <child_tool_names>.`

#### Scenario: Sub-agent inherits parent conversation context
- **WHEN** `runSubExecution` receives `parentContext`
- **THEN** the child's `liveMessages` start from the parent's assembled messages with the child's instructions merged into the final user message, instead of a fresh [system, user] pair

#### Scenario: Failed child returns error string, parent is not suspended
- **WHEN** a child execution throws or times out
- **THEN** the child's entry in the result array contains an error description, the other children are unaffected, and the parent execution continues

#### Scenario: Sub-agent cache prefix matches parent in refinement proxy
- **WHEN** the refinement proxy captures a parent request and a subsequent sub-agent request that received `parentToolDefs`
- **THEN** both requests have identical `tools_hash` values

### Requirement: spawn_agent tool call is intercepted before the standard executeTool path
The system SHALL intercept `spawn_agent` tool calls in the engine's tool-call loop, before forwarding to `executeTool`. This mirrors how `ask_me` is intercepted but does NOT suspend execution. Before executing children, the engine SHALL append a `tool_call` message to `conversation_messages` and push it to `liveMessages`, matching the recording pattern used by all other tools.

#### Scenario: Interception happens transparently
- **WHEN** the model issues a `spawn_agent` tool call
- **THEN** the engine runs children, injects a `tool_result` message with the results array, and continues the loop without returning control to the model for a streaming response yet

#### Scenario: tool_call message is recorded before child execution
- **WHEN** the model issues a `spawn_agent` tool call
- **THEN** the engine appends a `tool_call` message to `conversation_messages` with the call details (name, arguments) before executing any children, and pushes the corresponding assistant message with `tool_calls` to `liveMessages`

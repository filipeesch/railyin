## MODIFIED Requirements

### Requirement: spawn_agent runs parallel sub-executions in the parent worktree
The system SHALL provide a `spawn_agent` tool that, when called, fans out one or more in-memory child executions in parallel. Each child receives its own `instructions` string and `tools` list. All children share the parent task's worktree. The tool SHALL return a JSON array of result strings (one per child) to the parent execution. Children do NOT receive the parent's conversation history — each starts fresh with a system message containing a sub-agent context line followed by a user message with the child's instructions. Tool definitions SHALL be sorted by name to ensure byte-identical API request prefixes across concurrent children, maximizing prompt cache hits.

#### Scenario: Multiple children run in parallel
- **WHEN** an agent calls `spawn_agent` with N child descriptors
- **THEN** all N children run concurrently (Promise.all) and each child's API request prefix (system message + tool definitions) is byte-identical

#### Scenario: Sub-agent system message enables prompt cache sharing
- **WHEN** `runSubExecution` constructs `liveMessages` for a child
- **THEN** the first message is `{ role: "system", content: "You are a focused sub-agent. Complete the task described below." }` followed by `{ role: "user", content: instructions }`

#### Scenario: Tool definitions are sorted by name for prefix stability
- **WHEN** `runSubExecution` resolves tool definitions via `resolveToolsForColumn`
- **THEN** the resulting array is sorted by `name` (ascending) before being passed to `retryTurn`

#### Scenario: Failed child returns error string, parent is not suspended
- **WHEN** a child execution throws or times out
- **THEN** the child's entry in the result array contains an error description, the other children are unaffected, and the parent execution continues

## MODIFIED Requirements

### Requirement: spawn_agent runs parallel sub-executions in the parent worktree
The system SHALL provide a `spawn_agent` tool that, when called, fans out one or more in-memory child executions in parallel. Each child receives its own `instructions` string and `tools` list. All children share the parent task's worktree. The tool SHALL return a JSON array of result strings (one per child) to the parent execution. Children SHALL receive the parent's assembled message context (micro-compacted) as their base conversation, with the child's `instructions` appended as the final user message. Tool definitions SHALL be sorted by name to ensure byte-identical API request prefixes across concurrent children, maximizing prompt cache hits.

#### Scenario: Multiple children run in parallel with shared cache prefix
- **WHEN** an agent calls `spawn_agent` with N child descriptors
- **THEN** all N children run concurrently (Promise.all) and each child starts from the parent's assembled context (same system + tools + history prefix), so all children share the same cache anchor

#### Scenario: Sub-agent system message uses inherited parent context
- **WHEN** `runSubExecution` constructs messages for a child
- **THEN** the message array is the micro-compacted parent context with a new user message (`{ role: "user", content: instructions }`) appended; the child does NOT construct a fresh `[system, user]` pair

#### Scenario: Tool definitions are sorted by name for prefix stability
- **WHEN** `runSubExecution` resolves tool definitions via `resolveToolsForColumn`
- **THEN** the resulting array is sorted by `name` (ascending) before being passed to `retryTurn`

#### Scenario: Failed child returns error string, parent is not suspended
- **WHEN** a child execution throws or times out
- **THEN** the child's entry in the result array contains an error description, the other children are unaffected, and the parent execution continues

#### Scenario: Fallback to fresh context when no parent context available
- **WHEN** `runSubExecution` is called without a parent context (e.g. from a workflow trigger or test)
- **THEN** behavior falls back to constructing `[system, user]` from column instructions and instructions string

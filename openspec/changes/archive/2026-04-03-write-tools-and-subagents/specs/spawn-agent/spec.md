## ADDED Requirements

### Requirement: spawn_agent runs parallel sub-executions in the parent worktree
The system SHALL provide a `spawn_agent` tool that, when called, fans out one or more in-memory child executions in parallel. Each child receives its own `instructions` string and `tools` list. All children share the parent task's worktree. The tool SHALL return a JSON array of result strings (one per child) to the parent execution. Children do NOT receive the parent's conversation history — each starts fresh.

#### Scenario: Single child completes and result is returned
- **WHEN** an agent calls `spawn_agent` with one child descriptor
- **THEN** the child run executes to completion and its result string is returned to the parent as a JSON array with one element

#### Scenario: Multiple children run in parallel
- **WHEN** an agent calls `spawn_agent` with N child descriptors
- **THEN** all N children run concurrently (Promise.all) and the parent resumes only after all complete

#### Scenario: Failed child returns error string, parent is not suspended
- **WHEN** a child execution throws or times out
- **THEN** the child's entry in the result array contains an error description, the other children are unaffected, and the parent execution continues

#### Scenario: No new Task or Execution DB records are created for children
- **WHEN** `spawn_agent` is called
- **THEN** no rows are inserted into the `tasks` or `executions` tables for the child runs

### Requirement: spawn_agent tool call is intercepted before the standard executeTool path
The system SHALL intercept `spawn_agent` tool calls in the engine's tool-call loop, before forwarding to `executeTool`. This mirrors how `ask_me` is intercepted but does NOT suspend execution.

#### Scenario: Interception happens transparently
- **WHEN** the model issues a `spawn_agent` tool call
- **THEN** the engine runs children, injects a `tool_result` message with the results array, and continues the loop without returning control to the model for a streaming response yet

## MODIFIED Requirements

### Requirement: spawn_agent runs parallel sub-executions in the parent worktree
The system SHALL provide a `spawn_agent` tool that, when called, fans out one or more in-memory child executions in parallel. Each child receives its own `instructions` string and `tools` list (for anonymous children) or a named `agent` reference (for named children). All children share the parent task's worktree. The tool SHALL return a JSON array of result strings (one per child) to the parent execution.

**Pi engine specifics:** Children run as fresh `Agent` instances with no parent conversation history. The Pi engine does NOT support `parentContext` inheritance or `parentToolDefs` cache sharing. Named agents (`.railyin/agents/<name>.md`) own their tool set; the caller does not pass `tools` for named children.

#### Scenario: Multiple children run in parallel
- **WHEN** an agent calls `spawn_agent` with N child descriptors
- **THEN** all N children run concurrently (Promise.all) and results are returned in input order

#### Scenario: Failed child returns error string, parent is not suspended
- **WHEN** a child execution throws or its agent enters an error state
- **THEN** the child's entry in the result array contains an error description, the other children are unaffected, and the parent execution continues

#### Scenario: Named agent child uses agent file tools
- **WHEN** a child specifies `agent: "reviewer"` in the Pi engine
- **THEN** the child's tool set comes from the `reviewer` agent file's frontmatter, not from the spawn call args

#### Scenario: Children have no access to parent conversation history
- **WHEN** spawn_agent executes children in the Pi engine
- **THEN** each child `Agent` is constructed with a fresh message history containing only the `instructions` as the first user message

## ADDED Requirements

### Requirement: Sub-agent execution inherits parent assembled conversation context
The system SHALL, when spawning a sub-agent via `spawn_agent`, pass the parent's assembled `messages` array (the same array dispatched to the Anthropic API for the current round) as the base context for the child execution. The sub-agent SHALL append its `instructions` as the final user message in this context rather than starting from a fresh `[system, user]` pair. The parent context SHALL be passed through already in Anthropic wire format (with `cache_control` breakpoints applied) so the sub-agent's first API call shares the parent's cache prefix.

#### Scenario: Sub-agent first call achieves cache hit
- **WHEN** a sub-agent is spawned with parent context
- **AND** the parent has an active Anthropic cache from prior rounds
- **THEN** the sub-agent's first API call shows `cache_read_input_tokens > 0` (cache hit on the inherited prefix)

#### Scenario: Sub-agent instructions appended as final user message
- **WHEN** `runSubExecution` is called with a parent context array
- **THEN** the child's message array is the parent context plus a new `{ role: "user", content: instructions }` appended at the end

#### Scenario: Fresh context used when no parent context provided
- **WHEN** `runSubExecution` is called without a parent context (e.g. from a workflow trigger or test)
- **THEN** behavior falls back to the existing `[system, user]` pair construction

### Requirement: Forked context is micro-compacted before inheritance
The system SHALL apply micro-compaction (clearing stale tool results) to the parent context before passing it to a sub-agent. This limits the inherited token count and prevents unbounded growth when sub-agents are spawned in chains.

#### Scenario: Inherited context has old tool results cleared
- **WHEN** the parent context contains tool results older than `MICRO_COMPACT_TURN_WINDOW` assistant turns
- **THEN** those tool results are replaced with the sentinel string before the context is forked to the child

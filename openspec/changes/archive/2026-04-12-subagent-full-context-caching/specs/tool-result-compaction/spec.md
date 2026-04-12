## ADDED Requirements

### Requirement: Sub-agent tool results are compacted before API dispatch
The system SHALL, when assembling messages for an API call, replace the content of tool result messages that are older than `MICRO_COMPACT_TURN_WINDOW` assistant turns AND whose tool name is in `MICRO_COMPACT_CLEARABLE_TOOLS` with the sentinel string `[tool result cleared — content no longer in active context]`. This compaction SHALL apply to the full context when it is inherited by a sub-agent fork, before the forked messages are passed to the child.

#### Scenario: Forked context tool results are compacted
- **WHEN** the parent assembles a context to fork to a sub-agent
- **THEN** `compactMessages()` is applied to the assembled context before forking, replacing stale tool results with the sentinel string

#### Scenario: Live results within window pass through unmodified
- **WHEN** a tool result was produced within the last `MICRO_COMPACT_TURN_WINDOW` assistant turns
- **THEN** its full content is preserved in the forked context

### Requirement: Tool result compaction threshold is configurable
The system SHALL expose `MICRO_COMPACT_TURN_WINDOW` as a named constant (default: 5) representing the number of most recent assistant turns whose tool results are retained in full. Tool results from earlier turns are replaced with the sentinel string.

#### Scenario: Constant controls compaction boundary
- **WHEN** `MICRO_COMPACT_TURN_WINDOW` is 5
- **AND** the conversation has 8 assistant turns with tool results
- **THEN** tool results from the first 3 turns are cleared; results from turns 4-8 are preserved

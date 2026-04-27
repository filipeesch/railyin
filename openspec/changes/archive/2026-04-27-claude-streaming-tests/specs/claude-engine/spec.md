## MODIFIED Requirements

### Requirement: translateClaudeMessage handles mixed assistant content correctly
The system SHALL emit only `tool_start` events when `translateClaudeMessage` processes an `assistant` message containing `text`, `thinking`, and `tool_use` blocks together. Text and thinking blocks SHALL be silently skipped (dedup) because they were already delivered via `stream_event` deltas. Only `tool_use` blocks SHALL produce events.

#### Scenario: Mixed assistant message emits only tool_start
- **WHEN** `translateClaudeMessage` processes an `assistant` message with `thinking`, `text`, and `tool_use` content blocks
- **THEN** the function returns exactly `[{ type: "tool_start", ... }]` — not `["reasoning", "token", "tool_start"]`

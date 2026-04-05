## MODIFIED Requirements

### Requirement: Context usage is estimated including injected system messages
The system SHALL expose a `tasks.contextUsage` RPC that returns `{ usedTokens: number, maxTokens: number, fraction: number }`. When the task's most recent execution has actual token count data (`input_tokens` populated in the executions table), the RPC SHALL return that value as `usedTokens`. When no actual data is available, it SHALL fall back to the character-count estimate plus system overhead.

#### Scenario: Usage includes system message overhead (fallback path)
- **WHEN** `tasks.contextUsage` is called for a task with a worktree and no execution usage data
- **THEN** the returned `usedTokens` accounts for worktree context injection overhead in addition to stored message chars (unchanged fallback behaviour)

#### Scenario: Actual token count used when execution data is available
- **WHEN** `tasks.contextUsage` is called and the most recent execution for that task has `input_tokens` populated
- **THEN** the returned `usedTokens` equals the `input_tokens` value from that execution record, without adding character-count overhead

#### Scenario: Max tokens sourced from model context window
- **WHEN** the model for the task has a known context window (from models.list)
- **THEN** `maxTokens` equals that model's context window (unchanged)

#### Scenario: Max tokens falls back to config then default
- **WHEN** the model context window is unknown from the API
- **THEN** `maxTokens` uses `ai.context_window_tokens` from workspace.yaml if set, otherwise 128,000 (unchanged)

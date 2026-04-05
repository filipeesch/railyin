## Purpose
Displays a visual gauge in the task detail drawer showing estimated token usage relative to the model's context window.

## Requirements

### Requirement: Context usage gauge displayed next to model selector
The system SHALL display a context usage gauge to the right of the model selector in the task detail drawer, showing estimated token usage as a fraction of the model's context window.

#### Scenario: Gauge shown when context window is known
- **WHEN** the task detail drawer opens and the model's context window is known (from API or config)
- **THEN** a gauge is displayed showing used tokens / max tokens as a filled bar with a percentage label

#### Scenario: Gauge colour reflects usage level
- **WHEN** the gauge is rendered
- **THEN** it is green below 70%, yellow from 70–89%, and red at 90% and above

#### Scenario: Gauge tooltip shows detail
- **WHEN** the user hovers over the gauge
- **THEN** a tooltip shows "~X,XXX / YY,XXX tokens (Z%)"

#### Scenario: Gauge updates after execution completes
- **WHEN** an AI execution finishes and `onTaskUpdated` fires
- **THEN** the gauge re-fetches context usage and updates its display

#### Scenario: Gauge hidden when context window is unknown
- **WHEN** the model's context window cannot be determined (API returns null and no config override)
- **THEN** the gauge is not rendered

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

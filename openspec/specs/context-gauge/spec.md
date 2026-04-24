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
The system SHALL expose a `tasks.contextUsage` RPC that returns `{ usedTokens: number, maxTokens: number, fraction: number }`. The estimate SHALL include stored conversation messages plus a fixed overhead for injected system messages (stage instructions and worktree context).

#### Scenario: Usage includes system message overhead
- **WHEN** `tasks.contextUsage` is called for a task with a worktree
- **THEN** the returned `usedTokens` accounts for worktree context injection overhead in addition to stored message chars

#### Scenario: Max tokens sourced from model context window
- **WHEN** the model for the task has a known context window (from models.list)
- **THEN** `maxTokens` equals that model's context window

#### Scenario: Max tokens falls back to config then default
- **WHEN** the model context window is unknown from the API
- **THEN** `maxTokens` uses `ai.context_window_tokens` from workspace.yaml if set, otherwise 128,000

### Requirement: Context usage is available by conversationId
The system SHALL expose conversation-scoped context usage retrieval keyed by `conversationId` so both task and session chat can read the same kind of usage estimate.

#### Scenario: Task chat requests context usage by conversation
- **WHEN** the active task chat requests context usage for its conversation
- **THEN** the system returns context usage for that conversation without requiring task-scoped estimation APIs

#### Scenario: Session chat requests context usage by conversation
- **WHEN** the active standalone session requests context usage for its conversation
- **THEN** the system returns context usage for that conversation using the same response shape as task chat

### Requirement: Context usage gauge appears in standalone sessions
The system SHALL display the same context usage gauge and context popover in standalone session chat when the session conversation has a known context window estimate.

#### Scenario: Session context gauge shown when usage is known
- **WHEN** a standalone session chat is open and conversation context usage is available
- **THEN** the session input toolbar shows the same context gauge used in task chat

#### Scenario: Session context gauge hidden when usage unavailable
- **WHEN** a standalone session chat has no context usage estimate
- **THEN** the context gauge is not rendered

### Requirement: Manual compaction is available in standalone sessions
The system SHALL expose manual conversation compaction controls in standalone sessions when the active engine supports manual compaction.

#### Scenario: Session compaction button shown in popover
- **WHEN** the user opens the context popover in a standalone chat session and the engine supports manual compaction
- **THEN** the popover shows the compact action with the same disabled and loading semantics as task chat

#### Scenario: Session context usage refreshes after execution
- **WHEN** a standalone session execution completes
- **THEN** the session context usage is refreshed so the gauge reflects the latest conversation size

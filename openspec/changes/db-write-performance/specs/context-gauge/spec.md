## MODIFIED Requirements

### Requirement: Context usage is estimated including injected system messages
The system SHALL expose a `tasks.contextUsage` RPC that returns `{ usedTokens: number, maxTokens: number, fraction: number }`. The estimate SHALL use the `ContextEstimator` service.

The fast path SHALL use `input_tokens` from the last completed execution when available. The slow path SHALL anchor on the last `compaction_summary` message and load at most 200 live messages after it. The character-to-token heuristic SHALL be type-weighted (`chars / 4` for text, `chars / 3.5` for tool JSON). The slow path SHALL NOT load all `conversation_messages` rows.

#### Scenario: Usage includes system message overhead
- **WHEN** `tasks.contextUsage` is called for a task with a worktree
- **THEN** the returned `usedTokens` accounts for worktree context injection overhead in addition to stored message chars

#### Scenario: Max tokens sourced from model context window
- **WHEN** the model for the task has a known context window (from models.list)
- **THEN** `maxTokens` equals that model's context window

#### Scenario: Max tokens falls back to config then default
- **WHEN** the model context window is unknown from the API
- **THEN** `maxTokens` uses `ai.context_window_tokens` from workspace.yaml if set, otherwise 128,000

#### Scenario: Slow path is bounded
- **WHEN** no completed execution with input_tokens exists and context must be estimated
- **THEN** at most 200 conversation messages are loaded from the database

### Requirement: Context usage is available by conversationId
The system SHALL expose conversation-scoped context usage retrieval keyed by `conversationId` so both task and session chat can read the same kind of usage estimate.

#### Scenario: Task chat requests context usage by conversation
- **WHEN** the active task chat requests context usage for its conversation
- **THEN** the system returns context usage for that conversation without requiring task-scoped estimation APIs

#### Scenario: Session chat requests context usage by conversation
- **WHEN** the active standalone session requests context usage for its conversation
- **THEN** the system returns context usage for that conversation using the same response shape as task chat

## Purpose
TBD — provides a unified service for estimating conversation context token usage, replacing the previous dual-path estimation functions.

## Requirements

### Requirement: ContextEstimator consolidates both estimation paths
The system SHALL provide a single `ContextEstimator` service that replaces both `estimateContextUsage` (in `context.ts`) and `estimateConversationContextUsage` (in `context-usage.ts`). It SHALL accept either a `taskId` or `conversationId` as the lookup key.

#### Scenario: Fast path — completed execution token count
- **WHEN** a completed execution with `input_tokens` exists for the task or conversation
- **THEN** `ContextEstimator` returns `input_tokens` from the most recent completed execution without querying `conversation_messages`

#### Scenario: Slow path anchors on last compaction_summary
- **WHEN** no completed execution with `input_tokens` exists
- **THEN** `ContextEstimator` queries for the last `compaction_summary` message and loads only messages with `id > compaction_summary.id`, capped at `LIMIT 200`

#### Scenario: Slow path estimates from summary + live window
- **WHEN** the slow path is used and a `compaction_summary` exists
- **THEN** token estimate = `compaction_summary.content.length / 4` + sum of live message char lengths with type-weighted divisor (`3.5` for `tool_call`/`tool_result`, `4` for all others)

#### Scenario: Slow path with no compaction_summary
- **WHEN** the slow path is used and no `compaction_summary` exists
- **THEN** `ContextEstimator` loads up to 200 messages from the beginning and estimates using the type-weighted heuristic

#### Scenario: ContextEstimator injected with Database
- **WHEN** `ContextEstimator` is constructed
- **THEN** it receives a `Database` instance as a constructor argument and does not call `getDb()` internally

### Requirement: Old estimateContextUsage and estimateConversationContextUsage are removed
The functions `estimateContextUsage` in `src/bun/conversation/context.ts` and `estimateConversationContextUsage` in `src/bun/context-usage.ts` SHALL be deleted and replaced by `ContextEstimator`.

#### Scenario: All callers use ContextEstimator
- **WHEN** the codebase is built
- **THEN** no direct calls to `estimateContextUsage` or `estimateConversationContextUsage` exist; all callers use `ContextEstimator`

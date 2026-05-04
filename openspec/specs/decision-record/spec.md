## Purpose
Defines the persistence model, repository interface, and system-instruction injection for decision records captured during AI-driven conversations.

## Requirements

### Requirement: Decision records are persisted per conversation in SQLite
The system SHALL maintain three tables — `decision_batches`, `decision_records`, and `decision_revisions` — scoped to `conversation_id` so that both task-backed and standalone chat conversations can store decision records without requiring a task_id.

`decision_batches` SHALL group records created in a single `decision_request` interaction, identified by an auto-increment `id`, `conversation_id` FK, `created_at`, and an optional `label` for display. `decision_records` SHALL hold individual decisions with `id`, `batch_id` (nullable FK to `decision_batches`), `conversation_id`, `question`, `answer`, `weight` (TEXT enum: `critical` | `medium` | `easy`), `is_source_ai` (BOOLEAN: 0 = user-confirmed via `decision_request`, 1 = AI-recorded via `record_decision`), `is_deleted` (BOOLEAN default 0), `revision_count` (INTEGER default 0), and `created_at`. `decision_revisions` SHALL hold the audit trail with `id`, `decision_id` FK, `previous_answer`, `new_answer`, `reason` (NOT NULL), and `revised_at`.

A DB migration SHALL create all three tables with correct FK constraints and indexes on `(conversation_id, is_deleted)` and `(decision_id)` for efficient injection queries.

#### Scenario: Task conversation stores decision record
- **WHEN** a decision record is created for a task-backed conversation
- **THEN** the record is stored with the conversation's `conversation_id` and can be queried by that id

#### Scenario: Chat session stores decision record
- **WHEN** a decision record is created in a standalone chat session
- **THEN** the record is stored with the chat session's `conversation_id` without requiring a task_id

#### Scenario: Batch groups multiple records from one interview
- **WHEN** a `decision_request` interaction produces answers to multiple questions
- **THEN** all resulting records share a single `batch_id` pointing to a `decision_batches` row

#### Scenario: Migration runs without errors on fresh database
- **WHEN** the database migration runner executes on a fresh SQLite database
- **THEN** all three tables are created with correct columns, FKs, and indexes

### Requirement: DecisionRepository encapsulates all decision persistence logic
The system SHALL provide a `DecisionRepository` class that exposes: `createBatch(conversationId, label?)`, `createRecord(conversationId, question, answer, weight, isSourceAi, batchId?)`, `updateRecord(id, newAnswer, reason)`, `deleteRecord(id)`, `listByConversation(conversationId)`, `getRevisions(recordId)`, and `buildSystemBlock(conversationId)`. The repository SHALL be constructed with a `Database` instance injected via constructor. No method SHALL access global state.

#### Scenario: createRecord persists a new decision
- **WHEN** `createRecord(conversationId, "Should we use DI?", "Yes", "critical", false)` is called
- **THEN** a row is inserted into `decision_records` with `is_source_ai = 0` and `revision_count = 0`

#### Scenario: updateRecord appends a revision and bumps revision_count
- **WHEN** `updateRecord(id, "No, use factory instead", "Changed after prototype")` is called
- **THEN** a row is inserted into `decision_revisions` with the previous answer and provided reason, and `decision_records.revision_count` is incremented by 1

#### Scenario: deleteRecord sets is_deleted flag
- **WHEN** `deleteRecord(id)` is called
- **THEN** `decision_records.is_deleted` is set to 1 and the record is excluded from `listByConversation`

#### Scenario: listByConversation excludes deleted records
- **WHEN** `listByConversation(conversationId)` is called
- **THEN** only records with `is_deleted = 0` are returned, ordered by `weight` descending (critical first)

### Requirement: Decision records are injected into systemInstructions at execution time
The system SHALL have `DecisionRepository.buildSystemBlock(conversationId)` return a formatted string block suitable for appending to `systemInstructions`. If no non-deleted records exist for the conversation, the method SHALL return an empty string. When records exist, the block SHALL begin with `## Decision Records`, followed by records grouped by weight descending, each formatted as `[WEIGHT] question → answer` with `(revised Nx · reason)` appended when `revision_count > 0` and `[AI-recorded]` appended when `is_source_ai = 1`.

`ExecutionParamsBuilder` SHALL receive a `DecisionRepository` via constructor injection and SHALL call `buildSystemBlock(conversationId)` in both `build()` and `buildForChat()`, appending the result to `systemInstructions` before returning `ExecutionParams`.

#### Scenario: Empty conversation produces no block
- **WHEN** `buildSystemBlock(conversationId)` is called for a conversation with no decision records
- **THEN** it returns an empty string

#### Scenario: Critical decisions appear before easy decisions
- **WHEN** a conversation has records with mixed weights
- **THEN** `buildSystemBlock` returns critical-weight records before easy-weight records in the formatted block

#### Scenario: Revised record includes revision metadata
- **WHEN** a record has been updated once with reason "Changed after test"
- **THEN** the line in the system block ends with `(revised 1x · Changed after test)`

#### Scenario: AI-recorded decision includes tag
- **WHEN** a record was created via `record_decision` (is_source_ai = 1)
- **THEN** the line in the system block ends with `[AI-recorded]`

#### Scenario: Deleted records are excluded from injection
- **WHEN** a record is deleted and `buildSystemBlock` is called
- **THEN** the deleted record does not appear in the returned block

#### Scenario: Decision block survives execution compaction
- **WHEN** execution context is rebuilt for a conversation where previous messages were compacted
- **THEN** systemInstructions includes the decision block because it is rebuilt from DB on every execution

### Requirement: Decision records are persisted atomically with message dispatch
The `tasks.sendMessage` and `chatSessions.sendMessage` handlers SHALL accept an optional `decisionBatch` payload parameter. When present, the handler SHALL persist the batch and its records in the same SQLite transaction as the conversation message write, before execution is triggered. If the transaction fails, neither the message nor the decisions SHALL be persisted.

#### Scenario: Decision batch persisted with message in same transaction
- **WHEN** `sendMessage` is called with a `decisionBatch` containing two records
- **THEN** the `decision_batches` row and two `decision_records` rows are written in the same transaction as the conversation message

#### Scenario: Transaction rollback discards both message and decisions
- **WHEN** the message insert fails within the transaction
- **THEN** neither the conversation message nor any decision records are written to the database

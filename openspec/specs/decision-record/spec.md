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
The system SHALL provide a `DecisionRepository` class that exposes: `createRecord(conversationId, question, answer, weight, isSourceAi, batchId?)`, `updateRecord(id, newAnswer, reason)`, `deleteRecord(id)`, `listByConversation(conversationId)`, `getRevisions(recordId)`, `buildContextBlock(conversationId)`, `markDecisionsInjected(conversationId, compactionSummaryId)`, and `getLastInjectedCompactionId(conversationId)`. The method `buildSystemBlock` SHALL be removed. The repository SHALL be constructed with a `Database` instance injected via constructor. No method SHALL access global state.

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
- **THEN** only records with `is_deleted = 0` are returned, ordered by weight descending (critical first)

#### Scenario: buildContextBlock returns XML decisions block
- **WHEN** `buildContextBlock(conversationId)` is called and non-deleted records exist
- **THEN** it returns a string starting with `<decisions>` and ending with `</decisions>` containing one line per record formatted as `[WEIGHT] question → answer`

#### Scenario: buildContextBlock returns empty string for no records
- **WHEN** `buildContextBlock(conversationId)` is called for a conversation with no non-deleted records
- **THEN** it returns an empty string

#### Scenario: markDecisionsInjected updates the tracking column
- **WHEN** `markDecisionsInjected(conversationId, 42)` is called
- **THEN** `conversations.decisions_injected_after_compaction_id` is set to `42` for that conversation

#### Scenario: getLastInjectedCompactionId returns current column value
- **WHEN** `getLastInjectedCompactionId(conversationId)` is called after `markDecisionsInjected(conversationId, 42)`
- **THEN** it returns `42`

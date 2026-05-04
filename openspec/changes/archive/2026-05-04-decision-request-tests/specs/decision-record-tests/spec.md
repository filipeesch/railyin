## ADDED Requirements

### Requirement: DecisionRepository CRUD is fully exercised in isolation

`DecisionRepository` SHALL be tested with an in-memory SQLite DB (via `initDb()` extended DDL) covering create, update (revision append), soft-delete, and list-with-filtering.

#### Scenario: createRecord returns row with all expected fields
- **WHEN** `createRecord` is called with question, answer, weight, and `isSourceAi = false`
- **THEN** the returned record has `id`, `conversationId`, `question`, `answer`, `weight`, `revisionCount = 0`, `isSourceAi = false`, `isDeleted = false`

#### Scenario: createRecord with isSourceAi = true sets flag
- **WHEN** `createRecord` is called with `isSourceAi = true`
- **THEN** the stored record has `is_source_ai = 1`

#### Scenario: updateRecord inserts a revision row and increments count
- **WHEN** `updateRecord` is called with a new answer and a reason
- **THEN** a row is inserted in `decision_revisions` with the previous answer and the reason; `revision_count` on the record increments by 1

#### Scenario: calling updateRecord twice increments revision_count to 2
- **WHEN** `updateRecord` is called twice on the same record
- **THEN** `revision_count = 2` and two rows exist in `decision_revisions`

#### Scenario: deleteRecord soft-deletes the record
- **WHEN** `deleteRecord` is called on a record
- **THEN** `is_deleted = 1` in `decision_records`; the row is NOT removed from the table

#### Scenario: listByConversation excludes deleted records
- **WHEN** a conversation has one active and one deleted record
- **THEN** `listByConversation` returns only the active record

#### Scenario: listByConversation orders by weight descending
- **WHEN** records exist with weights `easy`, `critical`, and `medium`
- **THEN** `listByConversation` returns them in order: `critical`, `medium`, `easy`

#### Scenario: listByConversation excludes records from other conversations
- **WHEN** two conversations each have a decision record
- **THEN** `listByConversation(conversationA)` returns only conversationA's record

#### Scenario: getRevisions returns revisions in ascending order
- **WHEN** `updateRecord` is called twice producing 2 revisions
- **THEN** `getRevisions` returns them in `revised_at ASC` order

### Requirement: DecisionRepository.buildSystemBlock formats the injection block correctly

`buildSystemBlock` SHALL return a correctly formatted string for injection into `systemInstructions`, grouped by weight and omitting deleted records.

#### Scenario: returns empty string when no records exist
- **WHEN** `buildSystemBlock` is called for a conversation with no records
- **THEN** the return value is `""`

#### Scenario: returns empty string when all records are deleted
- **WHEN** all records for a conversation are soft-deleted
- **THEN** `buildSystemBlock` returns `""`

#### Scenario: groups critical before easy
- **WHEN** records with weights `easy` and `critical` both exist
- **THEN** the block lists the `[CRITICAL]` record before the `[EASY]` record

#### Scenario: shows revision count and last reason after one update
- **WHEN** a record has been updated once with reason "changed approach"
- **THEN** the injected line includes `(revised 1x · last reason: "changed approach")`

#### Scenario: shows revised 2x after two updates
- **WHEN** a record has been updated twice, latest reason "reconsidered"
- **THEN** the injected line includes `(revised 2x · last reason: "reconsidered")`

#### Scenario: appends [AI-recorded] tag for is_source_ai records
- **WHEN** a record has `is_source_ai = true`
- **THEN** the injected line ends with `[AI-recorded]`

#### Scenario: block starts with the standard header
- **WHEN** at least one non-deleted record exists
- **THEN** the block begins with `## Decision Records`

### Requirement: Decision migration creates correct schema

The migration `040_decision_records.ts` SHALL create all three tables with the correct columns, FKs, and indexes.

#### Scenario: three tables exist after migration
- **WHEN** `runMigrations()` is run on a fresh DB
- **THEN** `decision_batches`, `decision_records`, and `decision_revisions` tables all exist

#### Scenario: decision_records.batch_id FK references decision_batches.id
- **WHEN** inserting a `decision_records` row with a non-existent `batch_id`
- **THEN** a FK constraint error is raised (FKs enabled)

#### Scenario: index on (conversation_id, is_deleted) exists
- **WHEN** the migration has run
- **THEN** `PRAGMA index_list('decision_records')` includes an index covering `conversation_id` and `is_deleted`

#### Scenario: migration is idempotent
- **WHEN** `runMigrations()` is called on a DB that already has all three tables
- **THEN** no error is thrown and the tables remain unchanged

### Requirement: decisions.list and decisions.getRevisions RPC handlers return correct data

The RPC handlers SHALL be tested with in-memory DB, verifying scoping, ordering, and exclusion of deleted records.

#### Scenario: decisions.list returns empty array for new conversation
- **WHEN** `decisions.list` is called with a `conversationId` that has no records
- **THEN** the response is `[]`

#### Scenario: decisions.list returns records for the correct conversation only
- **WHEN** two conversations each have decision records
- **THEN** `decisions.list({ conversationId: A })` returns only conversation A's records

#### Scenario: decisions.list excludes deleted records
- **WHEN** a conversation has one active and one deleted record
- **THEN** the response contains only the active record

#### Scenario: decisions.list orders by weight descending
- **WHEN** records exist with weights `easy`, `critical`, `medium`
- **THEN** the response order is `critical`, `medium`, `easy`

#### Scenario: decisions.getRevisions returns empty array for unrevised record
- **WHEN** `decisions.getRevisions` is called for a record with no updates
- **THEN** the response is `[]`

#### Scenario: decisions.getRevisions returns revisions in chronological order
- **WHEN** a record has been updated twice
- **THEN** the response lists both revisions in `revised_at ASC` order

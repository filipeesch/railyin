## MODIFIED Requirements

### Requirement: DecisionRepository encapsulates all decision persistence logic
The system SHALL provide a `DecisionRepository` class that exposes: `createBatch(conversationId, label?)`, `createRecord(conversationId, question, answer, weight, isSourceAi, batchId?)`, `updateRecord(id, newAnswer, reason)`, `deleteRecord(id)`, `listByConversation(conversationId)`, `getRevisions(recordId)`, `buildContextBlock(conversationId)`, `markDecisionsInjected(conversationId, compactionSummaryId)`, and `getLastInjectedCompactionId(conversationId)`. The method `buildSystemBlock` SHALL be removed. The repository SHALL be constructed with a `Database` instance injected via constructor. No method SHALL access global state.

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

## REMOVED Requirements

### Requirement: Decision records are injected into systemInstructions at execution time
**Reason**: Injecting decisions into `systemInstructions` invalidates the provider's system-prompt cache on every decision change. Decisions are now injected into the user-prompt layer via `DecisionContextInjector`.
**Migration**: Use `DecisionContextInjector.prepare(conversationId)` from `HumanTurnExecutor` and `TransitionExecutor` to obtain the `<decisions>` block and prepend it to `userContent`.

### Requirement: Decision records are persisted atomically with message dispatch
**Reason**: `decisionBatch` in `sendMessage` is replaced by the dedicated `tasks.submitDecisions` / `chatSessions.submitDecisions` RPC methods.
**Migration**: Call `tasks.submitDecisions` or `chatSessions.submitDecisions` instead of passing `decisionBatch` to `sendMessage`.

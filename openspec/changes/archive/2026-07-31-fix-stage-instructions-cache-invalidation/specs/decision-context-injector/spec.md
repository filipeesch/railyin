## MODIFIED Requirements

### Requirement: conversations table tracks last decisions injection per conversation
The system SHALL track the last decisions-injection point per conversation via the shared `conversation_injection_state` table (keyed by `(conversation_id, injection_type)`, introduced by the `stage-instructions-injection` capability), using `injection_type = 'decisions'`, rather than a dedicated `conversations.decisions_injected_after_compaction_id` column. `NULL`/absent row means decisions have never been injected. `0` is the sentinel for "injected before any compaction". A positive integer is the `id` of the `compaction_summary` conversation message after which decisions were last injected. The pre-existing `conversations.decisions_injected_after_compaction_id` column is retained (unused) for migration safety but is no longer read or written by `DecisionRepository`.

#### Scenario: Migration backfills existing tracking into the shared table
- **WHEN** the migration introducing `conversation_injection_state` runs on an existing database
- **THEN** every conversation with a non-null `decisions_injected_after_compaction_id` gets a corresponding `conversation_injection_state` row with `injection_type = 'decisions'` and the same tracked compaction id

#### Scenario: DecisionRepository delegates to the shared ConversationInjectionStateRepository
- **WHEN** `DecisionRepository.markDecisionsInjected(conversationId, compactionSummaryId)` or `getLastInjectedCompactionId(conversationId)` is called
- **THEN** `DecisionRepository` delegates to the shared `ConversationInjectionStateRepository` component (introduced by the `stage-instructions-injection` capability) using `injection_type = 'decisions'`, rather than implementing its own read/write logic against `conversation_injection_state` or the old `conversations.decisions_injected_after_compaction_id` column

### Requirement: HumanTurnExecutor and TransitionExecutor prepend the decisions block to userContent
Both `HumanTurnExecutor` and `TransitionExecutor` SHALL construct a `DecisionContextInjector`, call `prepare(conversationId)` after calling `CrossEngineContextInjector`, and build `userContent` as `[historyBlock, decisionsBlock, stageInstructionsBlock, resolvedPrompt].filter(Boolean).join('\n\n')`, where `stageInstructionsBlock` is produced by the shared prompt-assembly collaborator introduced by the `stage-instructions-injection` capability.

#### Scenario: Decisions block prepended to user prompt on first turn
- **WHEN** `HumanTurnExecutor` executes the first human turn on a conversation with decision records
- **THEN** the userContent sent to the engine begins with the `<decisions>` block followed by the resolved prompt (and, when due, a `stageInstructionsBlock` positioned between the decisions block and the resolved prompt)

#### Scenario: Decisions block absent on subsequent turns within same compaction cycle
- **WHEN** `HumanTurnExecutor` executes a turn after decisions have already been injected for the current compaction
- **THEN** the userContent does not contain a `<decisions>` block

#### Scenario: Decisions and stage-instructions injection are independent
- **WHEN** a turn executes where `decisionsBlock` is due for re-injection but `stageInstructionsBlock` is not (or vice versa)
- **THEN** only the due block is present in `userContent`; the other is omitted

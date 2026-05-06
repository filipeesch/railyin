## ADDED Requirements

### Requirement: DecisionRepository.buildContextBlock — empty when no records
`buildContextBlock(conversationId)` SHALL return an empty string when no decision records exist.

#### Scenario: DR-1 — no records
- **WHEN** no `decision_records` exist for the conversation
- **THEN** `buildContextBlock()` returns `""`

### Requirement: DecisionRepository.buildContextBlock — XML-tagged output
`buildContextBlock(conversationId)` SHALL return a `<decisions>…</decisions>` XML block when records exist.

#### Scenario: DR-2 — single record
- **WHEN** one active decision record exists
- **THEN** `buildContextBlock()` returns a string starting with `<decisions>` and ending with `</decisions>`

### Requirement: DecisionRepository.buildContextBlock — weight ordering
Records SHALL be ordered critical → medium → easy within the block.

#### Scenario: DR-3 — mixed weights
- **WHEN** records exist with weights easy, medium, and critical
- **THEN** the critical record appears before medium, medium before easy in the output

### Requirement: DecisionRepository.buildContextBlock — AI-recorded tag
Records with `is_source_ai = 1` SHALL include `[AI-recorded]` in the block.

#### Scenario: DR-4 — AI-authored record
- **WHEN** a record has `is_source_ai = 1`
- **THEN** its entry in the block contains `[AI-recorded]`

### Requirement: DecisionRepository.buildContextBlock — revision metadata
Records with revisions SHALL include revision count and last reason in the block.

#### Scenario: DR-5 — revised record
- **WHEN** a record has been revised once with reason "user changed mind"
- **THEN** the block entry contains `revised 1x` and `"user changed mind"`

### Requirement: DecisionRepository.markDecisionsInjected — stores sentinel
`markDecisionsInjected(conversationId, compactionSummaryId)` SHALL update `decisions_injected_after_compaction_id` to the given value.

#### Scenario: DR-6 — write sentinel 0
- **WHEN** called with `compactionSummaryId = 0`
- **THEN** `conversations.decisions_injected_after_compaction_id` is `0` for that conversation

#### Scenario: DR-7 — write real compaction id
- **WHEN** called with `compactionSummaryId = 42`
- **THEN** `conversations.decisions_injected_after_compaction_id` is `42`

### Requirement: DecisionRepository.getLastInjectedCompactionId — round-trip reads
`getLastInjectedCompactionId(conversationId)` SHALL return the stored value, or `null` when never set.

#### Scenario: DR-8 — null before any injection
- **WHEN** `decisions_injected_after_compaction_id` has never been written
- **THEN** `getLastInjectedCompactionId()` returns `null`

#### Scenario: DR-9 — sentinel 0 round-trip
- **WHEN** `markDecisionsInjected(conversationId, 0)` was called
- **THEN** `getLastInjectedCompactionId()` returns `0`

#### Scenario: DR-10 — real id round-trip
- **WHEN** `markDecisionsInjected(conversationId, 99)` was called
- **THEN** `getLastInjectedCompactionId()` returns `99`

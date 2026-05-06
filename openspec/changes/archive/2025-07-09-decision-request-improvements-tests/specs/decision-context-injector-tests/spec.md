## ADDED Requirements

### Requirement: DecisionContextInjector — never-injected conversation triggers first-turn injection
`DecisionContextInjector.prepare(conversationId)` SHALL return a decisions block and write sentinel `0` to `decisions_injected_after_compaction_id` when the column is `NULL` (never injected) and at least one decision record exists.

#### Scenario: DCI-1 — NULL column with decisions present
- **WHEN** `decisions_injected_after_compaction_id` is NULL and at least one `decision_records` row exists
- **THEN** `prepare()` returns a non-undefined decisions block and sets `decisions_injected_after_compaction_id = 0`

### Requirement: DecisionContextInjector — sentinel 0 prevents re-injection before first compaction
Once sentinel `0` is written, `prepare()` SHALL return `undefined` on subsequent calls as long as no `compaction_summary` message has been added.

#### Scenario: DCI-2 — sentinel already 0, no compaction_summary exists
- **WHEN** `decisions_injected_after_compaction_id = 0` and no `compaction_summary` message exists in the conversation
- **THEN** `prepare()` returns `undefined`

### Requirement: DecisionContextInjector — re-injects after new compaction
`prepare()` SHALL return a decisions block and update `decisions_injected_after_compaction_id` to the new compaction id when a new `compaction_summary` message exists whose id is greater than the stored value.

#### Scenario: DCI-3 — new compaction_summary after sentinel 0
- **WHEN** `decisions_injected_after_compaction_id = 0` and a `compaction_summary` message exists with id N
- **THEN** `prepare()` returns a non-undefined block and sets `decisions_injected_after_compaction_id = N`

#### Scenario: DCI-4 — column matches latest compaction_summary id
- **WHEN** `decisions_injected_after_compaction_id = N` and the latest `compaction_summary` has id N
- **THEN** `prepare()` returns `undefined` (already up to date)

### Requirement: DecisionContextInjector — no injection when no decision records exist
`prepare()` SHALL return `undefined` even when injection is otherwise due, if no decision records exist for the conversation.

#### Scenario: DCI-5 — NULL column but no decision records
- **WHEN** `decisions_injected_after_compaction_id` is NULL and `decision_records` is empty for the conversation
- **THEN** `prepare()` returns `undefined` and does NOT update the column

### Requirement: DecisionContextInjector — block is XML-tagged
The returned decisions block SHALL be wrapped in `<decisions>…</decisions>` tags.

#### Scenario: DCI-6 — block format
- **WHEN** `prepare()` returns a non-undefined block
- **THEN** the block starts with `<decisions>` and ends with `</decisions>`

### Requirement: DecisionContextInjector — idempotent within same compaction cycle
After `prepare()` writes sentinel or compaction id, a second call in the same turn SHALL return `undefined`.

#### Scenario: DCI-7 — second call returns undefined
- **WHEN** `prepare()` is called twice consecutively with the same conversation state
- **THEN** the second call returns `undefined`

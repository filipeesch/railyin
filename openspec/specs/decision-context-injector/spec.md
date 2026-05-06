## Purpose
Defines the `DecisionContextInjector` service responsible for prepending a `<decisions>` XML block to the user-prompt layer after each compaction cycle, preserving provider system-prompt cache stability.

## Requirements

### Requirement: DecisionContextInjector prepends a decisions block to the user prompt once per compaction cycle
The system SHALL provide a `DecisionContextInjector` class at `src/bun/conversation/decision-context-injector.ts`. Its constructor SHALL accept a `Database` instance. Its `prepare(conversationId: number)` method SHALL return `{ decisionsBlock: string | undefined }`. When a block should be injected, it SHALL call `DecisionRepository.buildContextBlock(conversationId)` and, if the result is non-empty, return it wrapped as a `<decisions>` XML block. If the block is empty (no records exist), it SHALL return `{ decisionsBlock: undefined }` and SHALL NOT update the tracking column.

#### Scenario: First turn before any compaction injects block
- **WHEN** `prepare(conversationId)` is called and `conversations.decisions_injected_after_compaction_id` is `NULL` and no `compaction_summary` message exists
- **THEN** it returns a non-undefined `decisionsBlock` and writes sentinel `0` to `decisions_injected_after_compaction_id`

#### Scenario: Already injected for current compaction returns undefined
- **WHEN** `prepare(conversationId)` is called and `decisions_injected_after_compaction_id` equals the id of the latest `compaction_summary` message
- **THEN** it returns `{ decisionsBlock: undefined }` and does not modify the column

#### Scenario: New compaction since last injection triggers re-injection
- **WHEN** a new `compaction_summary` message has been written after the last tracked injection
- **THEN** `prepare(conversationId)` returns a non-undefined `decisionsBlock` and updates `decisions_injected_after_compaction_id` to the new compaction_summary id

#### Scenario: No decision records returns undefined even if injection is due
- **WHEN** injection is due (NULL or stale compaction id) but `buildContextBlock` returns empty string
- **THEN** `prepare(conversationId)` returns `{ decisionsBlock: undefined }` and does not update the column

### Requirement: conversations table tracks last decisions injection per conversation
The system SHALL add a `decisions_injected_after_compaction_id INTEGER NULL` column to the `conversations` table via migration `042`. `NULL` means decisions have never been injected. `0` is the sentinel for "injected before any compaction". A positive integer is the `id` of the `compaction_summary` conversation message after which decisions were last injected.

#### Scenario: Migration adds column with NULL default
- **WHEN** migration `042` runs on an existing database
- **THEN** `conversations.decisions_injected_after_compaction_id` exists with `NULL` as the default for all existing rows

#### Scenario: ConversationRow type reflects new column
- **WHEN** `src/bun/db/row-types.ts` is read
- **THEN** `ConversationRow` includes `decisions_injected_after_compaction_id: number | null`

### Requirement: HumanTurnExecutor and TransitionExecutor prepend the decisions block to userContent
Both `HumanTurnExecutor` and `TransitionExecutor` SHALL construct a `DecisionContextInjector`, call `prepare(conversationId)` after calling `CrossEngineContextInjector`, and build `userContent` as `[historyBlock, decisionsBlock, resolvedPrompt].filter(Boolean).join('\n\n')`.

#### Scenario: Decisions block prepended to user prompt on first turn
- **WHEN** `HumanTurnExecutor` executes the first human turn on a conversation with decision records
- **THEN** the userContent sent to the engine begins with the `<decisions>` block followed by the resolved prompt

#### Scenario: Decisions block absent on subsequent turns within same compaction cycle
- **WHEN** `HumanTurnExecutor` executes a turn after decisions have already been injected for the current compaction
- **THEN** the userContent does not contain a `<decisions>` block

### Requirement: StubDecisionContextInjector for executor DI tests
`HumanTurnExecutor` and `TransitionExecutor` tests SHALL use a `StubDecisionContextInjector extends DecisionContextInjector` that overrides `prepare()` with a configurable return value and a call-count tracker. The stub SHALL be instantiated in the executor factory functions (`makeExecutor()`) alongside the existing stubs.

#### Scenario: HTE-D-1 — stub returns block, block prepended to engineContent
- **WHEN** `StubDecisionContextInjector.prepare()` is configured to return `"<decisions>…</decisions>"`
- **THEN** the `ExecutionParams` built by `HumanTurnExecutor` has `engineContent` prefixed with the decisions block

#### Scenario: HTE-D-2 — stub returns undefined, no prepend
- **WHEN** `StubDecisionContextInjector.prepare()` is configured to return `undefined`
- **THEN** the `ExecutionParams` built does NOT contain a decisions prefix

#### Scenario: HTE-D-3 — prepare() is called (not skipped)
- **WHEN** `HumanTurnExecutor.execute()` runs
- **THEN** the stub's `prepare()` call count is `1`

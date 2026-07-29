## ADDED Requirements

### Requirement: stage_instructions is delivered via userContent, not systemInstructions
The system SHALL NOT include column-specific `stage_instructions` in `systemInstructions`. `stage_instructions` SHALL instead be delivered as a `stageInstructionsBlock` prepended into `userContent`, ordered immediately before the resolved prompt: `userContent = [historyBlock, decisionsBlock, stageInstructionsBlock, resolvedPrompt].filter(Boolean).join("\n\n")`. `systemInstructions` SHALL contain only `workflow_instructions` and custom prompts, both of which are invariant across column transitions within the same workflow/model.

#### Scenario: Column transition does not change systemInstructions content related to stage
- **WHEN** a task transitions from column A to column B, and both columns define different `stage_instructions`
- **THEN** the `systemInstructions` string passed to the engine is unchanged (byte-identical) across the transition
- **AND** the new column's `stage_instructions` content appears in `userContent` as a `stageInstructionsBlock`, not in `systemInstructions`

#### Scenario: stage_instructions ordered last in userContent
- **WHEN** `userContent` is assembled for a turn with a non-empty `historyBlock`, `decisionsBlock`, and `stageInstructionsBlock`
- **THEN** the resulting string has `historyBlock` first, `decisionsBlock` second, `stageInstructionsBlock` third, and `resolvedPrompt` last, each separated by `"\n\n"`

### Requirement: stageInstructionsBlock is re-injected at transition and after compaction, not every turn
The system SHALL inject `stageInstructionsBlock` into `userContent` at column-transition time. On subsequent human turns within the same column, the system SHALL NOT re-inject `stageInstructionsBlock` unless a compaction event has occurred on that conversation since the last injection, mirroring the re-injection policy used by `DecisionContextInjector` for `decisionsBlock`.

#### Scenario: First turn after transition includes stage instructions
- **WHEN** a column transition occurs and the target column defines `stage_instructions`
- **THEN** the resulting execution's `userContent` includes a non-empty `stageInstructionsBlock`

#### Scenario: Ordinary subsequent turn omits stage instructions
- **WHEN** a human turn executes in the same column, with no compaction having occurred since the last stage-instructions injection
- **THEN** `userContent` does not include a `stageInstructionsBlock`

#### Scenario: Turn after compaction re-injects stage instructions
- **WHEN** a compaction event has occurred on the conversation since the last stage-instructions injection, and a human turn subsequently executes in a column with `stage_instructions` defined
- **THEN** `userContent` includes a non-empty `stageInstructionsBlock` for that turn
- **AND** the tracking state is updated to record the new compaction as the last-injected-after point

#### Scenario: No stage_instructions defined for the column
- **WHEN** the current column does not define `stage_instructions`
- **THEN** `stageInstructionsBlock` is omitted from `userContent` regardless of transition/compaction state

### Requirement: conversation_injection_state tracks per-conversation, per-injection-type re-injection state
The system SHALL provide a `conversation_injection_state` table keyed by `(conversation_id, injection_type)`, storing the id of the last `compaction_summary` message after which that injection type was last applied. This table SHALL be shared by the stage-instructions injector (`injection_type = 'stage_instructions'`) and the decisions injector (`injection_type = 'decisions'`), replacing the dedicated `conversations.decisions_injected_after_compaction_id` column.

#### Scenario: Migration creates table and backfills existing decisions tracking
- **WHEN** the migration introducing `conversation_injection_state` runs on an existing database
- **THEN** the table exists with columns `conversation_id`, `injection_type`, `last_injected_after_compaction_id`
- **AND** every existing non-null `conversations.decisions_injected_after_compaction_id` value is copied into a row with `injection_type = 'decisions'`

#### Scenario: Stage-instructions and decisions tracking are independent per conversation
- **WHEN** a conversation has both a `decisions` and a `stage_instructions` injection-state row
- **THEN** updating one `injection_type`'s `last_injected_after_compaction_id` does not affect the other's value

### Requirement: A single shared repository implements the re-injection state machine for all injection types
The system SHALL implement the re-injection state machine (first-turn/never-injected, already-injected-for-current-compaction, new-compaction-since-last-injection) exactly once, in a shared `ConversationInjectionStateRepository`-style component. Both the decisions injector and the stage-instructions injector SHALL delegate to this shared component rather than each independently implementing the same state-machine logic against the `conversation_injection_state` table.

#### Scenario: Same state-machine logic applies uniformly across injection types
- **WHEN** the shared repository's re-injection check is exercised with `injection_type = 'decisions'` and separately with `injection_type = 'stage_instructions'`, using equivalent conversation/compaction state for each
- **THEN** both calls produce equivalent injection-due/not-due outcomes, demonstrating one shared implementation rather than two independently-maintained copies

#### Scenario: DecisionRepository's public method signatures are unchanged
- **WHEN** `DecisionRepository.markDecisionsInjected(conversationId, compactionSummaryId)` or `getLastInjectedCompactionId(conversationId)` is called
- **THEN** the call succeeds with the same signature and return shape as before this change, internally delegating to the shared repository

### Requirement: A single shared collaborator assembles prompts for all execution call sites
The system SHALL provide one shared prompt-assembly collaborator used by `TransitionExecutor`, `HumanTurnExecutor` (both its normal path and its "Engine session lost" recovery/fallback branch), `RetryExecutor`, and `CodeReviewExecutor`, replacing each site's independent construction of a `SystemPromptAssembler` and manual `userContent` join.

#### Scenario: RetryExecutor includes stage instructions in its prompt
- **WHEN** `RetryExecutor` executes a retry attempt in a column with `stage_instructions` defined, and re-injection is due per the compaction-based policy
- **THEN** the retry prompt sent to the engine includes a `stageInstructionsBlock` prepended ahead of the retry prompt text

#### Scenario: CodeReviewExecutor includes stage instructions in its prompt
- **WHEN** `CodeReviewExecutor` executes a code-review turn in a column with `stage_instructions` defined, and re-injection is due per the compaction-based policy
- **THEN** the review prompt sent to the engine includes a `stageInstructionsBlock` prepended ahead of the review text

#### Scenario: HumanTurnExecutor fallback branch uses the same collaborator
- **WHEN** `HumanTurnExecutor`'s "Engine session lost" recovery branch builds execution params for the restarted execution
- **THEN** it uses the same shared prompt-assembly collaborator as the normal execution path, producing consistent `systemInstructions`/`userContent` behavior including `stageInstructionsBlock` re-injection semantics

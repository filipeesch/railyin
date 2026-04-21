## MODIFIED Requirements

### Requirement: Compaction_summary message renders as a divider only

The `compaction_summary` message type in the conversation UI SHALL render as a horizontal divider with the label "— Conversation compacted —". No summary content, collapsible details, or "Show summary" toggle SHALL be displayed.

The `compaction_summary` messages written by the new auto-compaction path SHALL have empty content. Existing messages with content SHALL still render as the same divider (content is ignored in the renderer).

#### Scenario: Compaction divider shown with no summary
- **WHEN** a `compaction_summary` message is present in the conversation
- **THEN** `MessageBubble` SHALL render a `.msg--compaction` divider with the label "— Conversation compacted —"
- **AND** no `<details>` element, "Show summary" toggle, or summary content SHALL be rendered

## ADDED Requirements

### Requirement: Auto-compaction for Claude and Copilot engines surfaces to the UI

The system SHALL surface auto-compaction lifecycle for Claude and Copilot engines using the abstract `compaction_start` / `compaction_done` engine events (see `compaction-ux` spec). This extends the existing compaction visibility (previously only available for NativeEngine) to all engines.

#### Scenario: Compaction spinner appears mid-turn for Copilot
- **WHEN** a Copilot session auto-compacts during an active execution
- **THEN** a system message "Compacting conversation…" SHALL appear in the conversation during compaction
- **AND** a `compaction_summary` divider SHALL replace it when compaction completes

#### Scenario: Compaction spinner appears mid-turn for Claude
- **WHEN** a Claude session auto-compacts during an active execution
- **THEN** a system message "Compacting conversation…" SHALL appear in the conversation during compaction
- **AND** a `compaction_summary` divider SHALL appear when compaction completes

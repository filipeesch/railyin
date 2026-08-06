## ADDED Requirements

### Requirement: User can manually compact a Cursor conversation
The system SHALL support manual compaction for the Cursor engine, exposing the existing "Compact conversation" UI button and the `tasks.compact` / `chatSessions.compact` / orchestrator path, and SHALL emit the compaction lifecycle so the conversation UI reflects it.

#### Scenario: Compact button appears for Cursor models
- **WHEN** a Cursor model is selected and the model is not currently running
- **THEN** `CursorEngine.listModels()` reports `supportsManualCompact: true`
- **AND** the `ContextPopover` "Compact conversation" button is visible

#### Scenario: Manual compact emits lifecycle events and a summary
- **WHEN** the user triggers `tasks.compact` (or `chatSessions.compact`) for a Cursor conversation
- **THEN** `CursorEngine.compact(...)` triggers compaction
- **AND** `compaction_start` and `compaction_done` stream events are emitted
- **AND** a `compaction_summary` message is persisted and a `message.new` event is broadcast

#### Scenario: Manual compact reuses the pooled/warm agent
- **WHEN** compaction is triggered while the conversation's agent is present in the pool
- **THEN** the adapter triggers compaction on the warm agent and returns it to the pool idle afterward (it is not closed by compaction)

### Requirement: Compaction auto-triggers when context usage is high
The system SHALL automatically compact a Cursor conversation when its estimated context usage crosses an auto-compact threshold after an execution completes, provided compaction is not already in progress and no run is active for that conversation.

#### Scenario: Auto-compact fires above the threshold
- **WHEN** a Cursor execution completes and the estimated context usage exceeds the auto-compact threshold (default ~80% of the model context window)
- **THEN** compaction is triggered automatically, emitting `compaction_start` / `compaction_done` and persisting a `compaction_summary`

#### Scenario: Auto-compact does not fire below the threshold
- **WHEN** a Cursor execution completes and estimated context usage is at or below the threshold
- **THEN** no compaction occurs

#### Scenario: Auto-compact is skipped while compacting or running
- **WHEN** an execution completes and a compaction is already in progress, or a run is still active for the same conversation
- **THEN** auto-compact does not fire (it must not race an in-flight run or evict an active pooled agent)

#### Scenario: Auto-compact failure is logged, not surfaced fatally
- **WHEN** an automatic compaction attempt fails
- **THEN** the failure is logged to the console and does not surface as a user-facing error

### Requirement: Cursor compaction reuses the existing summary flow unless the SDK provides a native path
The system SHALL perform Cursor compaction by first attempting an SDK-native `compact()`/summarize mechanism if the local `@cursor/sdk` exposes one. If no native mechanism exists, the system SHALL reuse Railyin's existing summarize-and-recreate flow (`compactConversation`/`compactMessages`), storing the structured `<summary>` output as the `compaction_summary` message and using it as the new starting context.

#### Scenario: SDK-native compact used when available
- **WHEN** the local `@cursor/sdk` agent exposes a native compaction/summarize method
- **THEN** Cursor compaction invokes it (mirroring Copilot `session.compact()`)

#### Scenario: Fallback to summarize-and-recreate when no native path
- **WHEN** the local SDK exposes no native compaction method
- **THEN** Cursor compaction uses the Railyin `compactConversation`/`compactMessages` flow: a model produces the structured summary, the `compaction_summary` message is stored, and the agent is recreated/reseeded with the summarized history
- **AND** the stored summary contains only the `<summary>` block (the `<analysis>` scratchpad is stripped)

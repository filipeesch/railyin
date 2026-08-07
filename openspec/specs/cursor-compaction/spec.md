# cursor-compaction Specification

## Purpose
TBD - created by archiving change cursor-agent-lifecycle-compaction. Update Purpose after archive.
## Requirements
### Requirement: User can manually compact a Cursor conversation
The system SHALL support manual compaction for the Cursor engine, exposing the existing "Compact conversation" UI button and the `tasks.compact` / `chatSessions.compact` / orchestrator path. The `@cursor/sdk` manages the Cursor agent's own context compaction autonomously, so Railyin's manual compact stores its own `compaction_summary` (which future Railyin-side context estimation and prompt assembly use) and keeps the conversation's pooled agent warm.

#### Scenario: Compact button appears for Cursor models
- **WHEN** a Cursor model is selected and the model is not currently running
- **THEN** `CursorEngine.listModels()` reports `supportsManualCompact: true`
- **AND** the `ContextPopover` "Compact conversation" button is visible

#### Scenario: Manual compact stores a compaction summary
- **WHEN** the user triggers `tasks.compact` (or `chatSessions.compact`) for a Cursor conversation
- **THEN** `CursorEngine.compact(...)` reuses the shared `compactConversation`/`compactMessages` summarizer to persist a `compaction_summary` message
- **AND** the orchestrator broadcasts a `message.new` event for that `compaction_summary`, so it renders as the compaction divider in the conversation UI
- **AND** the conversation's agent is returned to the pool idle afterward (it is not closed by compaction)

#### Scenario: Manual compact reuses the pooled/warm agent
- **WHEN** compaction is triggered while the conversation's agent is present in the pool
- **THEN** the adapter's `compact(agentId)` keeps the agent warm (a no-op hook — the `@cursor/sdk` manages the agent's context autonomously)
- **AND** compaction does not call `agent.close()`

### Requirement: Cursor compaction reuses the existing summary flow (no SDK-native compact)
The system SHALL perform Cursor compaction by reusing Railyin's existing summarize-and-recreate flow (`compactConversation`/`compactMessages`), because the local `@cursor/sdk` does not expose a native `compact()` method. The `compaction_summary` message stores the structured `<summary>` output (with the `<analysis>` scratchpad stripped) and is used as the new starting context for Railyin-side prompt assembly.

#### Scenario: Fallback to summarize-and-recreate flow
- **WHEN** manual compaction runs for a Cursor conversation
- **THEN** Cursor compaction uses the Railyin `compactConversation`/`compactMessages` flow: a model produces the structured summary, the `compaction_summary` message is stored, and future Railyin-side assembly uses it as the new starting context
- **AND** the stored summary contains only the `<summary>` block (the `<analysis>` scratchpad is stripped)

#### Scenario: No SDK-native compact required
- **WHEN** the local `@cursor/sdk` agent is inspected for a native compaction/summarize method
- **THEN** none is exposed (the SDK manages Cursor context compaction autonomously), so Railyin does not invoke any SDK-native compact method

### Requirement: Auto-compaction is out of scope (Cursor manages it autonomously)
The system SHALL NOT implement a Railyin-side automatic threshold-based compaction trigger for the Cursor engine. The `@cursor/sdk` manages the Cursor agent's context compaction autonomously, so Railyin does not need to reset the SDK agent's context or react to context-usage thresholds.

#### Scenario: No Railyin auto-compaction trigger
- **WHEN** a Cursor execution completes and estimated context usage is high
- **THEN** Railyin does not automatically call `CursorEngine.compact()`
- **AND** the Cursor agent's context compaction is handled autonomously by the `@cursor/sdk`


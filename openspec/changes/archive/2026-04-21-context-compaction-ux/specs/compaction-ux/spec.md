## Purpose

Surfaces auto-compaction events from Claude and Copilot engines to the UI in real-time, giving users visibility when the model's context is being compacted during a running task.

## Requirements

### Requirement: Engines emit abstract compaction_start and compaction_done events

The system SHALL define two new `EngineEvent` types: `compaction_start` and `compaction_done`. Each engine that supports auto-compaction SHALL emit these events during its streaming lifecycle.

#### Scenario: Copilot engine emits compaction_start on SDK event
- **WHEN** the Copilot SDK session emits a `session.compaction_start` event
- **THEN** the CopilotEngine SHALL emit an engine event `{ type: "compaction_start" }`

#### Scenario: Copilot engine emits compaction_done on SDK event
- **WHEN** the Copilot SDK session emits a `session.compaction_complete` event
- **THEN** the CopilotEngine SHALL emit an engine event `{ type: "compaction_done" }`

#### Scenario: Claude engine emits compaction_start via hook
- **WHEN** the Claude SDK `onCompactProgress` callback fires with `{ type: "compact_start" }`
- **THEN** the ClaudeEngine adapter SHALL emit an engine event `{ type: "compaction_start" }`

#### Scenario: Claude engine emits compaction_done via hook
- **WHEN** the Claude SDK `onCompactProgress` callback fires with `{ type: "compact_end" }`
- **THEN** the ClaudeEngine adapter SHALL emit an engine event `{ type: "compaction_done" }`

#### Scenario: Claude compaction_done fallback via stream event
- **WHEN** the Claude SDK emits a `system` message with `subtype === "compaction_summary"` and no `compaction_done` has already been emitted for the current compaction cycle
- **THEN** the Claude events translator SHALL emit an engine event `{ type: "compaction_done" }`

### Requirement: Orchestrator persists compaction lifecycle messages

The system SHALL handle `compaction_start` and `compaction_done` events in `consumeStream()` and persist conversation messages accordingly.

#### Scenario: compaction_start appends a system spinner message
- **WHEN** `consumeStream()` receives a `compaction_start` event
- **THEN** a `system` conversation message with content "Compacting conversation…" SHALL be appended to the task's conversation and delivered via `onNewMessage`

#### Scenario: compaction_done appends a compaction_summary divider
- **WHEN** `consumeStream()` receives a `compaction_done` event
- **THEN** a `compaction_summary` conversation message with empty content SHALL be appended to the task's conversation and delivered via `onNewMessage`

#### Scenario: Duplicate compaction_done is ignored
- **WHEN** `consumeStream()` receives a `compaction_done` event but no preceding `compaction_start` was active for this execution
- **THEN** no additional message SHALL be appended

#### Scenario: Context usage is refreshed after compaction_done
- **WHEN** `consumeStream()` processes a `compaction_done` event
- **THEN** the context usage for the task SHALL be re-fetched so the context ring gauge reflects the post-compaction token count

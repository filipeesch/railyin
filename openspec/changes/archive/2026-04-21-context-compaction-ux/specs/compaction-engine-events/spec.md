## ADDED Requirements

### Requirement: Engines emit compaction_start and compaction_done events
The system SHALL define `compaction_start` and `compaction_done` as members of the `EngineEvent` discriminated union in `src/bun/engine/types.ts`. Engines that perform or observe context compaction SHALL emit these events through their `execute()` async iterable.

#### Scenario: compaction_start emitted before compaction begins
- **WHEN** an engine detects or initiates context compaction during a running execution
- **THEN** the engine emits `{ type: "compaction_start" }` before any compaction work begins

#### Scenario: compaction_done emitted after compaction completes
- **WHEN** context compaction finishes (successfully or with a recoverable error)
- **THEN** the engine emits `{ type: "compaction_done" }` to signal completion

#### Scenario: compaction_done without prior compaction_start is tolerated
- **WHEN** `compaction_done` arrives in the stream without a preceding `compaction_start` (e.g. fallback path)
- **THEN** the orchestrator still appends the compaction divider message without error

### Requirement: Orchestrator handles compaction events uniformly for all non-native engines
The orchestrator's `consumeStream()` SHALL handle `compaction_start` and `compaction_done` events. On `compaction_start` it SHALL append a `system` message with content "Compacting conversation…" and relay it via `onNewMessage`. On `compaction_done` it SHALL append a `compaction_summary` message with empty content, relay it, and trigger a context usage refresh.

#### Scenario: compaction_start writes system message
- **WHEN** `consumeStream()` receives a `compaction_start` event
- **THEN** a `system` message "Compacting conversation…" is appended to the conversation and relayed to IPC

#### Scenario: compaction_done writes divider and refreshes gauge
- **WHEN** `consumeStream()` receives a `compaction_done` event
- **THEN** a `compaction_summary` message with empty content is appended, relayed to IPC, and context usage is re-fetched

### Requirement: Copilot engine translates SDK compaction events
The `translateCopilotStream()` function in `copilot/events.ts` SHALL map `session.compaction_start` SDK events to `{ type: "compaction_start" }` and `session.compaction_complete` SDK events to `{ type: "compaction_done" }`, regardless of the `success` field on the complete event.

#### Scenario: session.compaction_start maps to compaction_start
- **WHEN** the Copilot SDK emits a `session.compaction_start` event
- **THEN** `translateCopilotStream` yields `{ type: "compaction_start" }`

#### Scenario: session.compaction_complete maps to compaction_done
- **WHEN** the Copilot SDK emits a `session.compaction_complete` event (success or failure)
- **THEN** `translateCopilotStream` yields `{ type: "compaction_done" }`

### Requirement: Claude adapter emits compaction events via onCompactProgress hook
The `DefaultClaudeSdkAdapter._run()` SHALL pass an `onCompactProgress` callback in the `sdk.query()` options. On `compact_start` it SHALL emit `{ type: "compaction_start" }`. On `compact_end` it SHALL emit `{ type: "compaction_done" }`. The `hooks_start` event SHALL be silently ignored.

#### Scenario: compact_start hook emits compaction_start
- **WHEN** the Claude CLI fires `onCompactProgress({ type: "compact_start" })`
- **THEN** the adapter emits `{ type: "compaction_start" }` into the engine event stream

#### Scenario: compact_end hook emits compaction_done
- **WHEN** the Claude CLI fires `onCompactProgress({ type: "compact_end" })`
- **THEN** the adapter emits `{ type: "compaction_done" }` into the engine event stream

#### Scenario: system.subtype=compaction_summary is fallback for compaction_done
- **WHEN** a `system` message with `subtype: "compaction_summary"` arrives in the Claude stream
- **AND** no prior `compaction_done` was emitted for this compaction cycle
- **THEN** the event translator emits `{ type: "compaction_done" }`

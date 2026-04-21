## ADDED Requirements

### Requirement: ClaudeEngine wires onCompactProgress in sdk.query() options
`DefaultClaudeSdkAdapter._run()` SHALL pass an `onCompactProgress` callback in the options object passed to `sdk.query()`. The callback SHALL:
- Emit `{ type: "compaction_start" }` when called with `{ type: "compact_start" }`
- Emit `{ type: "compaction_done" }` when called with `{ type: "compact_end" }`
- Ignore other event types (e.g. `hooks_start`)

#### Scenario: onCompactProgress compact_start fires compaction_start event
- **WHEN** the Claude CLI invokes `onCompactProgress({ type: "compact_start" })`
- **THEN** the engine emits `{ type: "compaction_start" }` into the execution stream

#### Scenario: onCompactProgress compact_end fires compaction_done event
- **WHEN** the Claude CLI invokes `onCompactProgress({ type: "compact_end" })`
- **THEN** the engine emits `{ type: "compaction_done" }` into the execution stream

#### Scenario: Unknown onCompactProgress event types are ignored
- **WHEN** the Claude CLI invokes `onCompactProgress({ type: "hooks_start" })`
- **THEN** no engine event is emitted and no error is thrown

### Requirement: system.subtype=compaction_summary acts as fallback compaction_done
When translating Claude SDK messages, if a `system` message with `subtype: "compaction_summary"` is received AND no `compaction_done` was already emitted in the current compaction cycle (tracked by a local `pendingCompaction` flag), the translator SHALL emit `{ type: "compaction_done" }`. If `compaction_done` was already emitted via `onCompactProgress`, the `system` message SHALL be silently skipped (not forwarded as a `status` event).

#### Scenario: system.subtype=compaction_summary emits compaction_done as fallback
- **WHEN** a `system` message with `subtype: "compaction_summary"` arrives
- **AND** `pendingCompaction` is true (compact_start was seen, compact_end was not)
- **THEN** `compaction_done` is emitted and `pendingCompaction` is reset to false

#### Scenario: Duplicate compaction_done is suppressed
- **WHEN** `compact_end` from `onCompactProgress` already emitted `compaction_done`
- **AND** a `system.subtype=compaction_summary` message then arrives
- **THEN** no second `compaction_done` is emitted

#### Scenario: Orphan compaction_summary (no prior start) emits compaction_done anyway
- **WHEN** a `system.subtype=compaction_summary` message arrives with no prior `compaction_start`
- **THEN** `compaction_done` is emitted once (covers older CLI versions)

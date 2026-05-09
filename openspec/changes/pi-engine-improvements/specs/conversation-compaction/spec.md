## ADDED Requirements

### Requirement: Pi engine participates in compaction lifecycle
Pi engine tasks SHALL support both manual and auto-compaction via Pi SDK. Compaction MUST be forwarded to Railyin's stream processor so the conversation UI reflects the compaction lifecycle.

#### Scenario: Auto-compact fires when Pi SDK detects threshold
- **WHEN** the Pi SDK determines context usage has reached the configured auto-compact threshold during an active execution
- **THEN** Pi SDK emits `compaction_start { reason: "threshold" }`
- **AND** `PiEngine` forwards this as a `{ type: "compaction_start" }` EngineEvent
- **AND** after compaction completes, Pi SDK emits `compaction_end { aborted: false }`
- **AND** `PiEngine` forwards this as a `{ type: "compaction_done" }` EngineEvent
- **AND** the stream processor writes a `compaction_summary` message to the conversation

#### Scenario: Manual compact triggers via compact button
- **WHEN** the user clicks the compact button in the task drawer
- **AND** the `tasks.compact` RPC is called
- **AND** the task uses a Pi engine
- **THEN** `PiEngine.compact()` calls `session.compact()` on the active session
- **AND** the Pi session JSONL is compacted via the local LLM

#### Scenario: Overflow recovery compacts automatically
- **WHEN** the LLM returns a context overflow error during a Pi execution
- **AND** Pi SDK emits `compaction_start { reason: "overflow" }`
- **THEN** `PiEngine` forwards the compaction lifecycle events to Railyin's stream
- **AND** Pi SDK retries the prompt after compaction completes

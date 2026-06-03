## MODIFIED Requirements

### Requirement: CEC-injection-trigger
`CrossEngineContextInjector.prepareSwitch()` injects only when the engine type changes. Constructor signature is now `(db: Database, engineRegistry: EngineRegistry)`. The `sourceEngine` parameter is removed from `prepareSwitch()`.

#### Scenario: CEC-1 same engine — no injection
- **WHEN** `conversations.last_engine_type === targetEngineId`
- **THEN** `prepareSwitch()` returns `{ historyBlock: undefined }`

#### Scenario: CEC-2 null last_engine_type — no injection (first ever turn)
- **WHEN** `conversations.last_engine_type IS NULL`
- **THEN** `prepareSwitch()` returns `{ historyBlock: undefined }`

#### Scenario: CEC-3 engine type changes — context block returned
- **WHEN** `last_engine_type === "copilot"` and `targetEngineId === "claude"`
- **THEN** `prepareSwitch()` returns a `{ historyBlock: string }` where content contains `<message_history>`

#### Scenario: CEC-4 context block contains messages since last compaction anchor (inclusive)
- **WHEN** DB has a `compaction_summary` message and later assistant/user turns
- **THEN** the returned context block includes the compaction_summary row (as `<SUMMARY>`) AND the turns after it

---

### Requirement: CEC-compaction-threshold
Pre-switch compaction is triggered when token estimate exceeds 75% of target context window. The source engine is resolved internally from `last_engine_type` via `EngineRegistry`.

#### Scenario: CEC-5 no contextWindow on target — skip threshold check, inject
- **WHEN** `targetModelInfo.contextWindow` is `undefined`
- **THEN** compaction check is skipped; context is injected without pre-compaction; no compact() call on any engine

#### Scenario: CEC-6 under threshold — compact NOT called
- **WHEN** estimated tokens < 75% of target `contextWindow`
- **THEN** the source engine's `compact()` is NOT called

#### Scenario: CEC-7 over threshold, source HAS compact — compact called, messages re-fetched
- **WHEN** estimated tokens > 75% of target `contextWindow` AND the source engine has `compact()`
- **THEN** `compact()` is awaited on the source engine resolved from `last_engine_type`; messages are re-fetched from DB after compaction

#### Scenario: CEC-8 over threshold, source has NO compact — proceeds without compact
- **WHEN** estimated tokens > 75% AND the source engine has no `compact` method
- **THEN** injection proceeds with available messages (no compact, no error)

---

## ADDED Requirements

### Requirement: CEC-b-to-a-context-preservation
When switching back to a previously-used engine (e.g. Claude→Pi→Claude), all messages from the intermediate engine session SHALL appear in the history block.

#### Scenario: CEC-15 Pi messages visible when switching back to Claude
- **WHEN** `last_engine_type` is `"pi"` and the DB contains Pi assistant messages
- **THEN** `prepareSwitch()` returns a `historyBlock` that contains those Pi assistant messages inside `<ASSISTANT>` tags

#### Scenario: CEC-16 compaction_summary included as SUMMARY block
- **WHEN** a `compaction_summary` row is the most recent compaction anchor AND subsequent messages exist
- **THEN** `prepareSwitch()` returns a `historyBlock` that contains a `<SUMMARY>` section from the compaction row AND the subsequent turns

#### Scenario: CEC-17 in-flight user message absent from history block
- **WHEN** `excludeBeforeMsgId` is set to the ID of the just-appended user message
- **THEN** the returned `historyBlock` does NOT contain that user message's content; only prior turns are present

---

### Requirement: CEC-edge-cases
Additional edge cases for robustness.

#### Scenario: CEC-18 unknown source engine — default engine used, no compact, injection proceeds
- **WHEN** `last_engine_type` is a value not registered in `EngineRegistry` (e.g. `"unknown"`)
- **THEN** `prepareSwitch()` resolves to the default engine; no `compact()` is called; `historyBlock` is returned if messages exist

#### Scenario: CEC-19 three-way switch (A→B→C) — only B-session messages in block
- **WHEN** conversation has messages from engine A, then a compaction after A, then messages from engine B, and `last_engine_type = "engineB"`
- **THEN** `historyBlock` contains only messages since the last compaction anchor (engine B's session), not engine A messages

#### Scenario: CEC-20 only compaction_summary, no subsequent messages
- **WHEN** `compaction_summary` is the last message and no turns follow it
- **THEN** `historyBlock` contains only the `<SUMMARY>` block (no empty `<USER>`/`<ASSISTANT>` tags)

---

### Requirement: CEC-executor-engine-switch
HumanTurnExecutor and TransitionExecutor correctly inject cross-engine history on engine switch.

#### Scenario: HT-CE-1 HumanTurnExecutor injects historyBlock into prompt on engine switch
- **WHEN** `last_engine_type = "copilot"` and `conversation_model = "claude/sonnet"` and prior copilot messages exist
- **THEN** `ExecutionParams.prompt` contains `<message_history>`

#### Scenario: HT-CE-2 HumanTurnExecutor resolves sourceEngine from last_engine_type not conversation_model (BUG A regression guard)
- **WHEN** `last_engine_type = "pi"` and `conversation_model = "claude/sonnet"` (already updated to target) and session is large enough to exceed threshold
- **THEN** `compact()` is called on the pi engine (not on claude); no spurious compaction on empty session

#### Scenario: HT-CE-3 HumanTurnExecutor: in-flight user message absent from history block
- **WHEN** engine switches and the current user message was appended before `prepareSwitch`
- **THEN** the user message content does NOT appear inside `<message_history>` in `ExecutionParams.prompt`

#### Scenario: TE-CE-1 TransitionExecutor injects historyBlock into systemInstructions on engine switch
- **WHEN** `last_engine_type = "copilot"` and transition target engine is `"claude"` and prior copilot messages exist
- **THEN** `ExecutionParams.systemInstructions` starts with the engine-switch context header

#### Scenario: TE-CE-2 TransitionExecutor resolves sourceEngine from last_engine_type not conversation_model (BUG A regression guard)
- **WHEN** `last_engine_type = "pi"` and `conversation_model = "claude/sonnet"` and session exceeds compact threshold
- **THEN** `compact()` is called on the pi engine, not on claude

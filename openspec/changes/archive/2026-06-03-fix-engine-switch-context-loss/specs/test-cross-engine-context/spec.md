## ADDED Requirements

### Requirement: CEC-b-to-a-context-preservation
When switching back to a previously-used engine (e.g. Claude→Pi→Claude), all messages from the intermediate engine session SHALL appear in the history block.

#### Scenario: CEC-15 Pi messages visible when switching back to Claude
- **WHEN** `last_engine_type` is `"pi"` and the DB contains Pi assistant messages
- **THEN** `prepareSwitch()` returns a `historyBlock` that contains those Pi assistant messages inside `<ASSISTANT>` tags

#### Scenario: CEC-16 compaction_summary included as SUMMARY block
- **WHEN** a `compaction_summary` message is the anchor AND subsequent messages exist
- **THEN** `prepareSwitch()` returns a `historyBlock` that contains a `<SUMMARY>` section from the compaction row AND the subsequent turns

#### Scenario: CEC-17 in-flight user message absent from history block
- **WHEN** `excludeBeforeMsgId` is set to the ID of the just-appended user message
- **THEN** the returned `historyBlock` does NOT contain that user message's content; only prior turns are present

## MODIFIED Requirements

### Requirement: CEC-injection-trigger
`CrossEngineContextInjector.prepareSwitch()` injects only when the engine type changes. The constructor now accepts `(db: Database, engineRegistry: EngineRegistry)` — the `sourceEngine` parameter is removed from `prepareSwitch()`.

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
- **THEN** the returned context block includes the compaction_summary row AND the turns after it

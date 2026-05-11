## MODIFIED Requirements

### Requirement: Session lifecycle
One `AgentSession` is created per `conversationId` and reused across executions of the same conversation. When `compact()` is called and no live session exists for the conversation, the engine SHALL restore the session from the persisted `.jsonl` file at `~/.railyin/pi-sessions/<hash>.jsonl` via `getOrCreateSession()` rather than silently skipping. The restored session SHALL be stored in the session map so subsequent executions can reuse it. `compact()` SHALL check `session.isCompacting` before calling `session.compact()` and throw `"Compaction already in progress"` if true.

#### Scenario: Session creation on first execute
- **WHEN** `execute()` is called with a `conversationId` not yet in the session map
- **THEN** a new `AgentSession` is created via `SessionManager.open(sessionPath)` and stored in `Map<conversationId, AgentSession>`

#### Scenario: Session reuse on subsequent execute
- **WHEN** `execute()` is called with the same `conversationId` again
- **THEN** the existing `AgentSession` is reused (Pi retains its internal context/compaction state)

#### Scenario: Session disposal on task archive
- **WHEN** a task is archived or deleted
- **THEN** `session.dispose()` is called and the entry is removed from the session map

#### Scenario: compact() restores session from disk when not in memory
- **WHEN** `compact()` is called for a conversationId not in the session map
- **THEN** `getOrCreateSession()` is called to restore from `~/.railyin/pi-sessions/<hash>.jsonl`, the session is stored in the map, and compaction proceeds

#### Scenario: compact() throws when already compacting
- **WHEN** `compact()` is called and `session.isCompacting` returns true
- **THEN** `"Compaction already in progress"` is thrown

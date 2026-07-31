## MODIFIED Requirements

### Requirement: Session lifecycle
One `AgentSession` is created per `conversationId` and reused across executions of the same conversation. The engine SHALL maintain a mutable `CommonToolContext` ref per conversation (`commonCtxRefs: Map<conversationId, CommonToolContext>`), created on first execution and mutated in-place on reuse (mirroring the `harnessContexts` pattern). When `compact()` is called and no live session exists for the conversation, the engine SHALL restore the session from the persisted `.jsonl` file at `~/.railyin/pi-sessions/<hash>.jsonl` via `getOrCreateSession()` rather than silently skipping. The restored session SHALL be stored in the session map so subsequent executions can reuse it. `compact()` SHALL check `session.isCompacting` before calling `session.compact()` and throw `"Compaction already in progress"` if true.

On session reuse, the engine SHALL call `session.setActiveToolsByName(names)` to update the active tool set instead of assigning directly to `agent.state.tools`. The engine SHALL NOT call `buildAllTools()` on session reuse — tool closures remain valid because they close over the mutable `CommonToolContext` ref. The `runtime.worktreePath`, `runtime.lspManager`, and all `workflow` callback fields SHALL be updated in-place on the stored `commonCtxRef` before each execution.

`PiSessionManager` SHALL track the qualified model id (`QualifiedModelId` string) that each stored session was built/last-refreshed with, alongside the `AgentSession` in its internal session map. On `getOrCreate(conversationId, model, tools, systemPrompt, cwd, qualifiedModelId)`, when reusing an existing session, `agent.state.systemPrompt` SHALL be overwritten with the incoming `systemPrompt` value ONLY IF the incoming `qualifiedModelId` differs from the qualified model id the session was previously built/refreshed with. When the qualified model id is unchanged, `agent.state.systemPrompt` SHALL NOT be modified, regardless of what `systemPrompt` value is passed. `agent.state.model` and the active tool set SHALL continue to be updated on every reuse call as today, independent of this comparison.

#### Scenario: Session creation on first execute
- **WHEN** `execute()` is called with a `conversationId` not yet in the session map
- **THEN** a new `AgentSession` is created via `SessionManager.open(sessionPath)` and stored in the session map alongside the qualified model id it was built with
- **AND** a `CommonToolContext` is created and stored in `commonCtxRefs` for that `conversationId`

#### Scenario: Session reuse on subsequent execute with same model
- **WHEN** `execute()` is called with the same `conversationId` again, resolving to the same qualified model id as the stored session
- **THEN** the existing `AgentSession` is reused (Pi retains its internal context/compaction state)
- **AND** `agent.state.systemPrompt` is NOT modified, even if a non-undefined `systemPrompt` value is passed
- **AND** `session.setActiveToolsByName()` is called to sync the active tool set from the SDK registry
- **AND** `agent.state.tools` is NOT directly assigned
- **AND** `buildAllTools()` is NOT called again

#### Scenario: Session reuse with a changed qualified model id refreshes systemPrompt
- **WHEN** `execute()` is called for a conversation whose stored session was built with qualified model id `A`, and the newly resolved qualified model id is `B` (`B !== A`)
- **THEN** `agent.state.systemPrompt` is overwritten with the incoming `systemPrompt` value
- **AND** the session's stored qualified model id is updated to `B`

#### Scenario: Pure column transition on the same model does not touch systemPrompt
- **WHEN** a task transitions between columns that resolve to the same qualified model id, and `getOrCreate()` is called as part of that transition's execution
- **THEN** `agent.state.systemPrompt` is left unchanged from its previously set value

#### Scenario: CommonToolContext mutable fields updated on reuse
- **WHEN** `execute()` is called for a conversation that already has a `commonCtxRef`
- **THEN** `commonCtxRef.runtime.worktreePath` is updated to the current working directory
- **AND** `commonCtxRef.runtime.lspManager` is updated to the current LSP manager
- **AND** `commonCtxRef.workflow` callbacks are updated to the current execution's callbacks
- **AND** tool closures see these updated values without rebuilding

#### Scenario: SDK built-in tools remain active on turn 2+
- **WHEN** `execute()` is called for a second time on the same conversation
- **THEN** the `read`, `grep`, `find`, and `ls` SDK built-in tools remain callable
- **AND** no "tool not found" error is returned for these tools

#### Scenario: Session disposal on task archive
- **WHEN** a task is archived or deleted
- **THEN** `session.dispose()` is called and the entry is removed from the session map
- **AND** the corresponding `commonCtxRef` is removed from `commonCtxRefs`

#### Scenario: compact() restores session from disk when not in memory
- **WHEN** `compact()` is called for a conversationId not in the session map
- **THEN** `getOrCreateSession()` is called to restore from the path resolved by the injected `SessionPathResolver`, the session is stored in the map, and compaction proceeds

#### Scenario: compact() throws when already compacting
- **WHEN** `compact()` is called and `session.isCompacting` returns true
- **THEN** `"Compaction already in progress"` is thrown

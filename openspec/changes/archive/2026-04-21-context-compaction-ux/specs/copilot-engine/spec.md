## ADDED Requirements

### Requirement: CopilotEngine implements compact() via SDK
`CopilotEngine` SHALL implement the optional `compact?(taskId: number): Promise<void>` method from `ExecutionEngine`. It SHALL call `session.compaction.compact()` on the active session for the given task. The resulting compaction events (`session.compaction_start` / `session.compaction_complete`) SHALL flow through `translateCopilotStream()` and be yielded as `compaction_start` / `compaction_done` events.

#### Scenario: compact() calls SDK compaction
- **WHEN** `CopilotEngine.compact(taskId)` is called for a task with an active session
- **THEN** `session.compaction.compact()` is invoked on the session

#### Scenario: compact() on task with no active session throws
- **WHEN** `CopilotEngine.compact(taskId)` is called and no active session exists
- **THEN** the method rejects with an error and no compaction events are emitted

### Requirement: CopilotEngine reports supportsManualCompact on all models
`CopilotEngine.listModels()` SHALL return `supportsManualCompact: true` on every `EngineModelInfo` entry it returns.

#### Scenario: listModels includes supportsManualCompact true
- **WHEN** `CopilotEngine.listModels()` is called
- **THEN** all returned model entries have `supportsManualCompact: true`

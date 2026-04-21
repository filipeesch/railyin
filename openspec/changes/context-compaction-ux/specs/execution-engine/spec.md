## ADDED Requirements

### Requirement: ExecutionEngine exposes optional compact() method
The `ExecutionEngine` interface SHALL include an optional `compact?(taskId: number): Promise<void>` method. Engines that support explicit context compaction SHALL implement it. Engines that do not support manual compaction SHALL leave it undefined. The orchestrator SHALL expose `tasks.compact` RPC only for engines where `compact` is defined.

#### Scenario: Engine with compact() responds to tasks.compact RPC
- **WHEN** `tasks.compact` is called for a task whose engine implements `compact()`
- **THEN** the engine's `compact()` method is invoked and the result (including any emitted compaction events) flows through the normal stream consumer

#### Scenario: Engine without compact() — no compact button shown
- **WHEN** the task's model does not have `supportsManualCompact: true`
- **THEN** the ContextPopover does not render a "Compact conversation" button

## ADDED Requirements

### Requirement: EngineModelInfo includes supportsManualCompact
`EngineModelInfo` in `src/bun/engine/types.ts` SHALL include `supportsManualCompact?: boolean`. `ProviderModelList` model entries in `src/shared/rpc-types.ts` SHALL also include `supportsManualCompact?: boolean`. The `models.listEnabled` RPC SHALL propagate this field to the frontend.

#### Scenario: Copilot models report supportsManualCompact true
- **WHEN** `CopilotEngine.listModels()` is called
- **THEN** all returned models have `supportsManualCompact: true`

#### Scenario: Claude models omit supportsManualCompact
- **WHEN** `ClaudeEngine.listModels()` is called
- **THEN** returned models have `supportsManualCompact` as `undefined` or `false`

## ADDED Requirements

### Requirement: EngineEvent union includes compaction_start and compaction_done
The `EngineEvent` discriminated union SHALL include `{ type: "compaction_start" }` and `{ type: "compaction_done" }` as valid event types. These SHALL be handled in `consumeStream()` but SHALL NOT be persisted as stream events — only their DB side effects (system message and compaction_summary message) are persisted.

#### Scenario: compaction events handled in consumeStream
- **WHEN** `consumeStream()` receives a `compaction_start` or `compaction_done` event
- **THEN** the appropriate DB message is written and no unhandled-event warning is logged

## Purpose

Allows users to explicitly trigger conversation compaction for engines that support it, via a button in the context popover.

## Requirements

### Requirement: ExecutionEngine interface supports optional compact method

The system SHALL add an optional `compact(taskId: number): Promise<void>` method to the `ExecutionEngine` interface. Engines that support explicit compaction SHALL implement it.

#### Scenario: Copilot engine implements compact()
- **WHEN** `CopilotEngine.compact(taskId)` is called
- **THEN** the engine SHALL call `session.compaction.compact()` on the active session for that task

#### Scenario: Claude engine does not implement compact()
- **WHEN** `ClaudeEngine` is instantiated
- **THEN** it SHALL NOT have a `compact` method, leaving the field undefined

### Requirement: tasks.compact RPC triggers engine-level compaction

The system SHALL expose a `tasks.compact` RPC handler that calls `engine.compact(taskId)` if the engine supports it.

#### Scenario: compact RPC calls engine compact method
- **WHEN** `tasks.compact({ taskId })` is called and the engine for that task implements `compact()`
- **THEN** the engine's `compact(taskId)` SHALL be invoked

#### Scenario: compact RPC returns error when engine doesn't support it
- **WHEN** `tasks.compact({ taskId })` is called and the engine does not implement `compact()`
- **THEN** the RPC SHALL throw an error indicating manual compaction is not supported for this engine

### Requirement: Model info exposes supportsManualCompact capability flag

The system SHALL add an optional `supportsManualCompact?: boolean` field to the `ProviderModelList.models` array shape in `rpc-types.ts`. Each engine SHALL set this field in its `listModels()` response.

#### Scenario: Copilot models report supportsManualCompact true
- **WHEN** `CopilotEngine.listModels()` returns its model list
- **THEN** each model entry SHALL include `supportsManualCompact: true`

#### Scenario: Claude models report supportsManualCompact false
- **WHEN** `ClaudeEngine.listModels()` returns its model list
- **THEN** each model entry SHALL NOT include `supportsManualCompact` (field omitted, treated as falsy)

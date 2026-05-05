## MODIFIED Requirements

### Requirement: Engine resolver instantiates the correct engine from workspace config

The system SHALL resolve the execution engine from the workspace that owns the task being executed, not from a single global workspace config. Supported engine types SHALL include `copilot`, `claude`, and `opencode`.

#### Scenario: Task execution uses owning workspace config

- **WHEN** a task belongs to a board in workspace A
- **THEN** `resolveEngine` uses workspace A's resolved config for that execution

#### Scenario: Copilot engine resolved from config

- **WHEN** `workspace.yaml` has `engine.type: copilot`
- **THEN** `resolveEngine` returns an instance of `CopilotEngine`

#### Scenario: Claude engine resolved from config

- **WHEN** `workspace.yaml` has `engine.type: claude`
- **THEN** `resolveEngine` returns an instance of `ClaudeEngine`

#### Scenario: OpenCode engine resolved from config

- **WHEN** `workspace.yaml` has `engine.type: opencode`
- **THEN** `resolveEngine` returns an instance of `OpenCodeEngine`

#### Scenario: Unknown engine type rejected

- **WHEN** `workspace.yaml` has `engine.type: unsupported`
- **THEN** `resolveEngine` throws an error indicating the engine type is not supported

#### Scenario: Concurrent executions use different supported workspace engines

- **WHEN** one running task belongs to a `copilot` workspace and another running task belongs to a `claude` workspace
- **THEN** both executions proceed concurrently using their own workspace-specific engine instances and config

## ADDED Requirements

### Requirement: Engine identification fields accept any engine type string

The system SHALL define `RawModelMessage.engine` and `EngineLeaseMetadata.engine` as `string` rather than a closed literal union, so that new engine types can be added without requiring changes to the shared `types.ts` contract.

#### Scenario: OpenCode raw messages use engine identifier string

- **WHEN** `OpenCodeEngine` emits a raw model message via `onRawModelMessage`
- **THEN** the `engine` field is set to `"opencode"` and the orchestrator persists it without error

#### Scenario: Existing engines unaffected by type widening

- **WHEN** `ClaudeEngine` or `CopilotEngine` emits a raw model message
- **THEN** the `engine` field continues to be set to `"claude"` or `"copilot"` respectively, and all existing consumers behave identically

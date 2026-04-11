## MODIFIED Requirements

### Requirement: Engine resolver instantiates the correct engine from workspace config
The system SHALL resolve the execution engine from the workspace that owns the task being executed, not from a single global workspace config. Supported engine types remain `native` and `copilot`.

#### Scenario: Task execution uses owning workspace config
- **WHEN** a task belongs to a board in workspace A
- **THEN** `resolveEngine` uses workspace A's resolved config for that execution

#### Scenario: Concurrent executions use different workspace engines
- **WHEN** one running task belongs to a `native` workspace and another running task belongs to a `copilot` workspace
- **THEN** both executions proceed concurrently using their own workspace-specific engine instances and config

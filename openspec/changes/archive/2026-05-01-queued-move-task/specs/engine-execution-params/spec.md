## ADDED Requirements

### Requirement: ExecutionParams carries onTransition and onHumanTurn callbacks
`ExecutionParams` SHALL include two optional callback fields: `onTransition?: (taskId: number, toState: string) => void` and `onHumanTurn?: (taskId: number, message: string) => void`. Both engines (Claude and Copilot) SHALL read these from params and pass them into `commonToolContext` on every execution, defaulting to `() => {}` if absent. The Orchestrator SHALL populate these callbacks when building params via `ExecutionParamsBuilder`.

#### Scenario: onTransition injected into commonToolContext
- **WHEN** `ClaudeEngine.execute(params)` or `CopilotEngine.execute(params)` is called with a non-null `params.onTransition`
- **THEN** `commonToolContext.onTransition` is the same function reference as `params.onTransition`

#### Scenario: onHumanTurn injected into commonToolContext
- **WHEN** an engine executes with a non-null `params.onHumanTurn`
- **THEN** `commonToolContext.onHumanTurn` is the same function reference as `params.onHumanTurn`

#### Scenario: Callbacks default to no-op when absent from params
- **WHEN** an engine executes without `onTransition` or `onHumanTurn` set in params
- **THEN** `commonToolContext.onTransition` and `commonToolContext.onHumanTurn` are functions that do nothing when called

#### Scenario: Orchestrator provides real implementations
- **WHEN** the Orchestrator builds ExecutionParams for a task execution
- **THEN** `onTransition` is wired to `void transitionExecutor.execute(taskId, toState)`
- **AND** `onHumanTurn` is wired to `void humanTurnExecutor.execute(taskId, message)`

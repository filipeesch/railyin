## MODIFIED Requirements

### Requirement: Workflow column can declare a preferred model as a fully-qualified ID
The system SHALL allow each workflow column to declare an optional `model` field in the workflow YAML. When a task transitions into a column, the effective model SHALL be resolved in priority order: `column.model → task.model → engine.model → ""`. Column model takes precedence over all other sources. When a column has no model configured, `task.model` is preserved; the `engine.model` from workspace config is used as a fallback only when `task.model` is also null.

#### Scenario: Column model applied on entry as fully-qualified ID
- **WHEN** a task transitions into a column that has `model: "anthropic/claude-opus-4-5"` defined
- **THEN** the task's `model` is updated to `"anthropic/claude-opus-4-5"` before any execution is started

#### Scenario: Column model applied on entry (Claude)
- **WHEN** a task transitions into a column that has `model: "claude-sonnet-4-6"` and the active engine is Claude
- **THEN** the task's `model` is updated to `"claude-sonnet-4-6"` and passed to the Claude engine

#### Scenario: Task model preserved when column has no model
- **WHEN** a task transitions into a column with no `model` field and the task has `model: "gpt-4.1"` set
- **THEN** the task's `model` remains `"gpt-4.1"` and subsequent executions use that model

#### Scenario: Column default falls back to engine.model when task model is null
- **WHEN** a task transitions into a column with no `model` field, `task.model` is null, and `engine.model` is set to `"gpt-4.1"` in workspace config
- **THEN** the task's `model` is set to `"gpt-4.1"` before execution

#### Scenario: Column default falls back to null when neither column nor task nor engine specifies a model
- **WHEN** a task transitions into a column with no `model` field, `task.model` is null, and `engine.model` is not set in workspace config
- **THEN** the task's `model` is left unchanged (null) and the engine uses its built-in default

### Requirement: New tasks inherit workspace engine model on creation
The system SHALL set a newly created task's `model` to the workspace `engine.model` when no explicit model is specified at creation time and `engine.model` is configured. This applies to tasks created via the `tasks.create` RPC handler.

#### Scenario: Task created without explicit model gets engine.model as default
- **WHEN** `tasks.create` is called and workspace has `engine.model: "gpt-4.1"` configured
- **THEN** the new task's `model` field is set to `"gpt-4.1"`

#### Scenario: Task created without model and no engine.model stays null
- **WHEN** `tasks.create` is called and workspace has no `engine.model` configured
- **THEN** the new task's `model` field is `null`

## ADDED Requirements

### Requirement: Human turn and retry executions fall back to engine.model when task model is null
The system SHALL resolve `engine.model` as a fallback in `HumanTurnExecutor` and `RetryExecutor` when `task.model` is null at execution time. When `engine.model` is used as the fallback, the resolved model SHALL be written back to `task.model` in the database so subsequent executions find it without re-resolving from config.

#### Scenario: Human turn uses engine.model when task model is null
- **WHEN** a user sends a message to a task whose `model` is null and `engine.model` is set to `"claude-sonnet-4-6"`
- **THEN** the execution uses `"claude-sonnet-4-6"` as the model
- **AND** `task.model` is updated to `"claude-sonnet-4-6"` in the database

#### Scenario: Human turn preserves task model when set
- **WHEN** a user sends a message to a task whose `model` is `"gpt-4.1"`
- **THEN** the execution uses `"gpt-4.1"` as the model regardless of `engine.model`

#### Scenario: Retry uses engine.model when task model is null
- **WHEN** a retry is triggered on a task whose `model` is null and `engine.model` is set to `"gpt-4.1"`
- **THEN** the retry execution uses `"gpt-4.1"` as the model
- **AND** `task.model` is updated to `"gpt-4.1"` in the database

### Requirement: Model resolution uses a single canonical utility function
The system SHALL use a single `resolveTaskModel(columnModel, taskModel, engineConfig)` pure function as the canonical implementation of the model priority chain across all task execution paths. The function SHALL return a `string` (empty string when all sources are null/undefined).

#### Scenario: resolveTaskModel returns column model when set
- **WHEN** `columnModel` is `"gpt-4.1"`, `taskModel` is `"claude-sonnet-4-6"`, and `engineConfig.model` is `"other-model"`
- **THEN** `resolveTaskModel` returns `"gpt-4.1"`

#### Scenario: resolveTaskModel returns task model when column is null
- **WHEN** `columnModel` is null, `taskModel` is `"claude-sonnet-4-6"`, and `engineConfig.model` is `"other-model"`
- **THEN** `resolveTaskModel` returns `"claude-sonnet-4-6"`

#### Scenario: resolveTaskModel returns engine model when column and task are null
- **WHEN** `columnModel` is null, `taskModel` is null, and `engineConfig.model` is `"gpt-4.1"`
- **THEN** `resolveTaskModel` returns `"gpt-4.1"`

#### Scenario: resolveTaskModel returns empty string when all sources are null
- **WHEN** `columnModel` is null, `taskModel` is null, and `engineConfig` has no `model` property
- **THEN** `resolveTaskModel` returns `""`

## MODIFIED Requirements

### Requirement: Workspace AI model is optional in configuration
The system SHALL NOT require `ai.model` to be set in `workspace.yaml`. When absent, task execution SHALL use the model set on the task itself. If neither is set, the AI provider call proceeds without an explicit model field (provider uses its default).

#### Scenario: Workspace starts without default_model set
- **WHEN** `workspace.yaml` has no `default_model` field
- **THEN** the system loads without a configuration error

#### Scenario: Task model used when workspace model absent
- **WHEN** a task has a model set and `default_model` is absent from workspace config
- **THEN** the task's model is used for AI calls

#### Scenario: Column default falls back to workspace default_model when column has no model
- **WHEN** a task transitions into a column with no `model` field and `default_model` is set in workspace config
- **THEN** the task's model is set to the workspace `default_model` value

#### Scenario: Column default falls back to null when neither column nor workspace specifies a model
- **WHEN** a task transitions into a column with no `model` field and `default_model` is not set in workspace config
- **THEN** the task's model is left unchanged (not overridden)

### Requirement: Workflow column can declare a preferred model as a fully-qualified ID
The system SHALL allow each workflow column to declare an optional `model` field in the workflow YAML. This value SHALL be a fully-qualified model ID (`providerId/modelId`) and is used as the default for tasks entering that column. Column model takes precedence over workspace `default_model`.

#### Scenario: Column model applied on entry as fully-qualified ID
- **WHEN** a task transitions into a column that has `model: "anthropic/claude-opus-4-5"` defined
- **THEN** the task's `model` is updated to `"anthropic/claude-opus-4-5"` before any execution is started

#### Scenario: Column model takes precedence over workspace default_model
- **WHEN** a task transitions into a column that has `model: "anthropic/claude-opus-4-5"` defined and workspace has `default_model: "openrouter/gpt-4o"`
- **THEN** the task's `model` is set to `"anthropic/claude-opus-4-5"` (column wins)

## ADDED Requirements

### Requirement: New tasks inherit workspace default_model on creation
The system SHALL set a newly created task's `model` to the workspace `default_model` when no explicit model is specified at creation time and `default_model` is configured.

#### Scenario: Task created without explicit model gets workspace default
- **WHEN** `create_task` is called without an `args.model` and workspace has `default_model: "anthropic/claude-sonnet-4-5"`
- **THEN** the new task's `model` field is set to `"anthropic/claude-sonnet-4-5"`

#### Scenario: Task created with explicit model ignores workspace default
- **WHEN** `create_task` is called with `args.model: "openrouter/gpt-4o"` and workspace has `default_model: "anthropic/claude-sonnet-4-5"`
- **THEN** the new task's `model` field is set to `"openrouter/gpt-4o"`

#### Scenario: Task created without model and no workspace default stays null
- **WHEN** `create_task` is called without an `args.model` and workspace has no `default_model`
- **THEN** the new task's `model` field is `null`

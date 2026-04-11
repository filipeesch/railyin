## MODIFIED Requirements

### Requirement: Workflow column can declare a preferred model as a fully-qualified ID
The system SHALL allow each workflow column to declare an optional `model` field in the workflow YAML. This value SHALL be a fully-qualified model ID for the native engine, and a plain engine-native model name for non-native engines such as Copilot and Claude.

#### Scenario: Column model applied on entry (Claude)
- **WHEN** a task transitions into a column that has `model: "claude-sonnet-4-6"` and the active engine is Claude
- **THEN** the task's `model` is updated to `"claude-sonnet-4-6"` and passed to the Claude engine

### Requirement: Available models are fetched dynamically from the provider
The system SHALL expose a `models.list` RPC that delegates to the active engine's `listModels()` method. For the Claude engine, this returns models available through the Claude Agent SDK in the same provider-grouped shape used by the rest of the product, with a single Claude provider group.

#### Scenario: Claude engine returns available models
- **WHEN** the active engine is Claude and `models.list` is called
- **THEN** the engine returns models available through the Claude SDK in the shared grouped model format with a single `claude` provider group

### Requirement: Workspace AI model is optional in configuration
The system SHALL NOT require a default model to be set in engine config. For the Claude engine, `engine.model` is optional and the SDK may use its own default behavior when no task or column model is set.

#### Scenario: Claude engine starts without default model
- **WHEN** `workspace.yaml` has `engine: { type: claude }` and a task has no explicit model
- **THEN** the system loads successfully and the Claude engine uses SDK-default model behavior until a task or column model is chosen

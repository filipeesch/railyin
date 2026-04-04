## MODIFIED Requirements

### Requirement: Available models are fetched dynamically from the provider
The system SHALL expose a `models.list` RPC that calls `GET {base_url}/v1/models` on the configured provider endpoint and returns a structured list of available models including their context window sizes where known.

#### Scenario: Models returned with context window when endpoint responds
- **WHEN** the provider supports `/v1/models` and responds with a valid models list
- **THEN** `models.list` returns an array of `{ id: string, contextWindow: number | null }` objects, where `contextWindow` is populated from the `context_length` field of each model object if present, or `null` if absent

#### Scenario: Empty list returned when endpoint fails
- **WHEN** the `/v1/models` request fails (network error, 404, or non-JSON response)
- **THEN** `models.list` returns an empty array without throwing

### Requirement: Workspace AI model is optional in configuration
The system SHALL NOT require `ai.model` to be set in `workspace.yaml`. When absent, task execution SHALL use the model set on the task itself. If neither is set, the AI provider call proceeds without an explicit model field (provider uses its default).

#### Scenario: Workspace starts without ai.model set
- **WHEN** `workspace.yaml` has no `ai.model` field
- **THEN** the system loads without a configuration error

#### Scenario: Task model used when workspace model absent
- **WHEN** a task has a model set and `ai.model` is absent from workspace config
- **THEN** the task's model is used for AI calls

#### Scenario: Column default falls back to null when workspace model absent
- **WHEN** a task transitions into a column with no `model` field and `ai.model` is not set in workspace config
- **THEN** the task's model is set to null, and the AI call proceeds without an explicit model override

## ADDED Requirements

### Requirement: Context window tokens config is a fallback override only
The `ai.context_window_tokens` field in `workspace.yaml` SHALL serve as a manual override for the model's context window size. It is used only when the model's context window cannot be determined from the `/v1/models` response.

#### Scenario: API context window takes precedence over config
- **WHEN** the selected model has a `contextWindow` value from `models.list`
- **THEN** that value is used for context usage estimation and gauge display, ignoring `context_window_tokens` from config

#### Scenario: Config value used when API context window is null
- **WHEN** the selected model's `contextWindow` is `null` and `ai.context_window_tokens` is set in workspace.yaml
- **THEN** `context_window_tokens` is used as the effective context window

#### Scenario: Default used when both API and config are absent
- **WHEN** the selected model's `contextWindow` is null and `ai.context_window_tokens` is not set
- **THEN** 128,000 tokens is used as the default context window

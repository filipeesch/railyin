## Purpose
The multi-provider configuration allows users to configure multiple named AI providers in `workspace.yaml`. Each provider has a type, connection details, and an optional default model. The system resolves which provider to use based on the fully-qualified model ID prefix.

## Requirements

### Requirement: Workspace config supports a providers list with typed entries
The system SHALL read an optional `providers:` list from `workspace.yaml`. Each entry SHALL have a unique `id` field and a `type` field. Type-specific fields are required per type:
- `anthropic`: `api_key`
- `openrouter`: `base_url`, `api_key`
- `lmstudio`: `base_url`
- `openai-compatible`: `base_url`, optional `api_key`
- `fake`: no additional fields (used for testing)

#### Scenario: Multiple providers configured
- **WHEN** `workspace.yaml` has a `providers:` list with two entries (one `anthropic`, one `openrouter`)
- **THEN** both providers are instantiated at startup and available for model resolution

#### Scenario: Duplicate provider IDs rejected
- **WHEN** `workspace.yaml` has two provider entries with the same `id`
- **THEN** the system logs a warning and ignores the duplicate entry

### Requirement: Old ai: block is auto-migrated to a single providers list entry in memory
The system SHALL detect a legacy `ai:` block in `workspace.yaml` (with `base_url`, `api_key`, `model`) and automatically convert it to a single-entry `providers:` list in memory at load time. No file is written to disk.

#### Scenario: Legacy ai block used without providers list
- **WHEN** `workspace.yaml` has `ai: { base_url: "...", api_key: "...", model: "..." }` and no `providers:` key
- **THEN** the provider registry is initialized with a single `openai-compatible` entry with `id: "default"` matching the `ai:` values; the workspace.yaml file is not modified

#### Scenario: providers list takes precedence when both exist
- **WHEN** `workspace.yaml` has both an `ai:` block and a `providers:` list
- **THEN** the `providers:` list is used and the `ai:` block is ignored

### Requirement: Provider IDs are unique and used as model prefixes
The system SHALL require that each provider's `id` is unique within the workspace. When a model is selected as a fully-qualified ID (`{providerId}/{modelId}`), `resolveProvider` parses the prefix to find the matching provider instance.

#### Scenario: Provider resolved from fully-qualified model ID
- **WHEN** the task model is `"openrouter/anthropic/claude-3-5-sonnet"` and a provider with `id: "openrouter"` is configured
- **THEN** `resolveProvider` returns the OpenRouter provider and model `"anthropic/claude-3-5-sonnet"`

#### Scenario: Unregistered prefix throws UnresolvableProviderError
- **WHEN** the task model has prefix `"acme"` and no provider with `id: "acme"` is configured
- **THEN** `resolveProvider` throws `UnresolvableProviderError`

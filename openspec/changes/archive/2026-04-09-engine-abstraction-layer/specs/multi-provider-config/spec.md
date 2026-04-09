## MODIFIED Requirements

### Requirement: Workspace config supports a providers list with typed entries
The system SHALL read an optional `providers:` list from the `engine:` block when `engine.type` is `native`. Each entry SHALL have a unique `id` field and a `type` field. Type-specific fields are required per type:
- `anthropic`: `api_key`
- `openrouter`: `base_url`, `api_key`
- `lmstudio`: `base_url`
- `openai-compatible`: `base_url`, optional `api_key`
- `fake`: no additional fields (used for testing)

The `providers:` list SHALL NOT exist at the workspace root level. It is scoped under the `engine:` block for the native engine only.

#### Scenario: Multiple providers configured under engine block
- **WHEN** `workspace.yaml` has `engine.type: native` with a `providers:` list containing two entries (one `anthropic`, one `openrouter`)
- **THEN** both providers are instantiated at startup and available for model resolution

#### Scenario: Duplicate provider IDs rejected
- **WHEN** `workspace.yaml` has two provider entries with the same `id` under the engine block
- **THEN** the system logs a warning and ignores the duplicate entry

#### Scenario: Providers list ignored for non-native engines
- **WHEN** `workspace.yaml` has `engine.type: copilot`
- **THEN** the `providers:` field is not read or required

### Requirement: Old top-level config is auto-migrated to engine.type: native format in memory
The system SHALL detect a legacy workspace config with top-level `providers:`, `default_model:`, `ai:`, `anthropic:`, `search:`, or `lsp:` fields and automatically wrap them under `engine: { type: native, ... }` in memory at load time. No file is written to disk. This supersedes the previous `ai:` block migration.

#### Scenario: Legacy top-level providers list migrated
- **WHEN** `workspace.yaml` has `providers: [...]` at the root level and no `engine:` key
- **THEN** the config is migrated in memory to `engine: { type: native, providers: [...] }` and the workspace.yaml file is not modified

#### Scenario: Legacy ai block migrated to engine.type: native
- **WHEN** `workspace.yaml` has `ai: { base_url: "...", api_key: "...", model: "..." }` and no `engine:` or `providers:` key
- **THEN** the config is migrated in memory to `engine: { type: native, providers: [{ id: "default", type: "openai-compatible", ... }] }`

#### Scenario: engine block takes precedence when both exist
- **WHEN** `workspace.yaml` has both top-level `providers:` and an `engine:` block
- **THEN** the `engine:` block is used and top-level provider fields are ignored

### Requirement: Provider IDs are unique and used as model prefixes
The system SHALL require that each provider's `id` is unique within the native engine's provider list. When a model is selected as a fully-qualified ID (`{providerId}/{modelId}`), `resolveProvider` parses the prefix to find the matching provider instance.

#### Scenario: Provider resolved from fully-qualified model ID
- **WHEN** the task model is `"openrouter/anthropic/claude-3-5-sonnet"` and a provider with `id: "openrouter"` is configured
- **THEN** `resolveProvider` returns the OpenRouter provider and model `"anthropic/claude-3-5-sonnet"`

#### Scenario: Unregistered prefix throws UnresolvableProviderError
- **WHEN** the task model has prefix `"acme"` and no provider with `id: "acme"` is configured
- **THEN** `resolveProvider` throws `UnresolvableProviderError`

### Requirement: Provider config supports an optional fallback model
The system SHALL allow each provider config entry to declare an optional `fallback_model` field containing a fully-qualified model ID (e.g., `"anthropic/claude-sonnet-4-20250514"`). When present, the engine resolves the fallback model's provider and passes it to retry wrappers for use during 529 exhaustion. When absent, no fallback behavior is enabled.

#### Scenario: Fallback model configured
- **WHEN** a provider config contains `fallback_model: "anthropic/claude-sonnet-4-20250514"`
- **THEN** the engine resolves the fallback provider and passes it to `retryStream`/`retryTurn`

#### Scenario: No fallback model configured
- **WHEN** a provider config omits `fallback_model`
- **THEN** the `fallbackProvider` parameter passed to retry wrappers is `null`

#### Scenario: Invalid fallback model ignored gracefully
- **WHEN** `fallback_model` references an unconfigured provider (e.g., `"openai/gpt-4o"` but no `openai` provider is configured)
- **THEN** the fallback is treated as `null` with a warning log; the primary retry behavior proceeds normally

## ADDED Requirements

### Requirement: Engine config uses a single engine block with type discriminator
The `workspace.yaml` SHALL support a top-level `engine:` block with a required `type` field that discriminates the config schema. For `type: native`, the block contains `providers`, `default_model`, `anthropic`, `search`, and `lsp` sub-fields. For `type: copilot`, the block contains an optional `model` field and no provider/API configuration.

#### Scenario: Native engine config structure
- **WHEN** `workspace.yaml` has `engine: { type: native, providers: [...], default_model: "anthropic/claude-opus-4-1" }`
- **THEN** the system loads the native engine with the specified providers and default model

#### Scenario: Copilot engine config structure
- **WHEN** `workspace.yaml` has `engine: { type: copilot, model: gpt-5 }`
- **THEN** the system loads the copilot engine with the specified model

#### Scenario: Missing engine block defaults to native
- **WHEN** `workspace.yaml` has no `engine:` key and no legacy fields
- **THEN** the system defaults to `engine: { type: native }` with empty provider list

#### Scenario: Engine type is required when engine block is present
- **WHEN** `workspace.yaml` has `engine: {}` without a `type` field
- **THEN** the system logs a warning and defaults to `type: native`

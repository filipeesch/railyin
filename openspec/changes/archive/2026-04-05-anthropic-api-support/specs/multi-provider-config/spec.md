## ADDED Requirements

### Requirement: Workspace supports multiple AI providers configured simultaneously
The system SHALL allow users to configure multiple AI providers in `workspace.yaml` using a `providers:` list. Each provider entry SHALL have a unique `id`, a `type` field, and type-specific connection fields. Supported types are: `anthropic`, `openrouter`, `lmstudio`, `openai-compatible`, and `fake`.

#### Scenario: Multiple providers listed in workspace.yaml
- **WHEN** `workspace.yaml` contains a `providers:` array with two or more entries
- **THEN** the system loads all providers successfully and makes all their models available

#### Scenario: Anthropic provider entry requires only id, type, and api_key
- **WHEN** a provider entry has `type: anthropic` and a valid `api_key`
- **THEN** the provider is usable without a `base_url` field (Anthropic's base URL is hardcoded)

#### Scenario: OpenAI-compatible provider entry requires base_url
- **WHEN** a provider entry has `type: lmstudio` or `type: openai-compatible` and a valid `base_url`
- **THEN** the provider is usable; `api_key` is optional

### Requirement: Old single `ai:` block is auto-migrated to `providers:` on load
The system SHALL accept the old `ai:` block format in `workspace.yaml` and transparently convert it to a single-entry `providers:` list at config load time. No file is written — the migration is in-memory only.

#### Scenario: Old ai block loaded without providers list
- **WHEN** `workspace.yaml` has an `ai:` block and no `providers:` key
- **THEN** the config loads as `providers: [{id: "default", type: <provider>, ...}]` without error

#### Scenario: Both ai block and providers list present
- **WHEN** `workspace.yaml` has both `ai:` and `providers:` keys
- **THEN** `providers:` takes precedence and `ai:` is ignored

### Requirement: Provider IDs are unique within the workspace
The system SHALL reject a configuration where two providers share the same `id` field, logging an error and falling back to using only the first occurrence.

#### Scenario: Duplicate provider id detected
- **WHEN** two entries in `providers:` have the same `id`
- **THEN** the config loader logs a warning and uses only the first entry with that id

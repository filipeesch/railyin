## MODIFIED Requirements

### Requirement: Workspace config supports a providers list with typed entries
The system SHALL read the `providers:` list only when `engine.type` is `native`. For non-native engines such as `copilot` and `claude`, provider/API configuration fields are neither required nor used.

#### Scenario: Providers list ignored for Claude engine
- **WHEN** `workspace.yaml` has `engine.type: claude`
- **THEN** the `providers:` field is not read or required

### Requirement: Engine config uses a single engine block with type discriminator
The `workspace.yaml` SHALL support a top-level `engine:` block with a required `type` field that discriminates the config schema. Supported engine types SHALL include:
- `native` — provider-based Railyin engine config
- `copilot` — Copilot SDK config with optional `model`
- `claude` — Claude Agent SDK config with optional `model`

No Claude API keys, provider lists, or base URLs are stored in the Claude engine block.

#### Scenario: Claude engine config structure
- **WHEN** `workspace.yaml` has `engine: { type: claude, model: claude-sonnet-4-6 }`
- **THEN** the system loads the Claude engine with that default model

#### Scenario: Minimal Claude config is valid
- **WHEN** `workspace.yaml` has `engine: { type: claude }`
- **THEN** the system loads the Claude engine with SDK defaults and no provider configuration

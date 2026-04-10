## Purpose
Provider args passthrough allows workspace-level configuration of provider-specific request body fields. This enables features like OpenRouter routing preferences without requiring changes to Railyin's core provider logic.

## Requirements

### Requirement: Provider config accepts passthrough request body args
The system SHALL support an optional `provider_args` field on any `ProviderConfig` entry in `workspace.yaml`. When present, its value SHALL be merged into the request body as the `provider` key on every call made by `OpenAICompatibleProvider`. The field SHALL be typed as `Record<string, unknown>` and passed through opaquely without validation.

#### Scenario: provider_args forwarded on stream request
- **WHEN** a provider entry in `workspace.yaml` has `provider_args: { ignore: ["google-vertex", "azure"] }`
- **THEN** every streaming request to that provider includes `"provider": { "ignore": ["google-vertex", "azure"] }` in the JSON body

#### Scenario: provider_args forwarded on non-streaming turn request
- **WHEN** a provider entry has `provider_args` configured
- **THEN** every non-streaming `turn()` request to that provider includes the `provider` key in the JSON body

#### Scenario: no provider_args — request body unchanged
- **WHEN** a provider entry does not have `provider_args` configured
- **THEN** the request body contains no `provider` key and behaviour is identical to before this change

#### Scenario: provider_args not applied to AnthropicProvider
- **WHEN** a provider entry with `type: anthropic` has `provider_args` configured
- **THEN** the `provider_args` field is ignored and no extra key is added to Anthropic API requests

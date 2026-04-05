## MODIFIED Requirements

### Requirement: AI provider uses OpenAI-compatible chat completions format
The system SHALL communicate with OpenAI-compatible providers using the OpenAI chat completions API format (`POST /v1/chat/completions`). The provider endpoint is configured per-provider entry in the `providers:` list, each with `base_url`, `api_key`, and optional `model`. A new `AnthropicProvider` communicates with Anthropic's native `/v1/messages` API instead. The `createProvider(config)` factory is replaced by `resolveProvider(qualifiedModel, providers)` which selects the correct provider instance from the configured list.

#### Scenario: OpenRouter configured as provider
- **WHEN** `workspace.yaml` has a provider entry with `type: openrouter` and `base_url: https://openrouter.ai/api/v1` with a valid API key
- **THEN** all AI calls for models prefixed `openrouter/` are sent to OpenRouter using the OpenAI format

#### Scenario: Ollama used as local provider
- **WHEN** `workspace.yaml` has a provider entry with `type: openai-compatible` and `base_url: http://localhost:11434/v1` with no API key
- **THEN** all AI calls for models prefixed with that provider's `id` are sent to the local Ollama instance with no authentication header

#### Scenario: Anthropic configured as provider
- **WHEN** `workspace.yaml` has a provider entry with `type: anthropic` and a valid `api_key`
- **THEN** all AI calls for models prefixed `anthropic/` are sent to `https://api.anthropic.com/v1/messages`

### Requirement: AI provider abstraction supports multiple named providers simultaneously
The system SHALL maintain a registry of named `AIProvider` instances, one per configured provider entry. Provider instances SHALL be cached and reused across executions. The registry is keyed by provider `id`. `resolveProvider(qualifiedModel)` returns `{ provider: AIProvider, model: string }` where `model` is the un-prefixed model ID.

#### Scenario: Provider resolved from qualified model string
- **WHEN** a task has `model: "anthropic/claude-3-5-sonnet-20241022"`
- **THEN** `resolveProvider` returns the `AnthropicProvider` instance and model string `claude-3-5-sonnet-20241022`

#### Scenario: Unknown provider prefix causes resolution failure
- **WHEN** a task has `model: "unknownprovider/some-model"` and no provider with `id: "unknownprovider"` is configured
- **THEN** `resolveProvider` throws `UnresolvableProviderError`

#### Scenario: Null or missing model causes resolution failure
- **WHEN** a task has `model: null`
- **THEN** `resolveProvider` throws `UnresolvableProviderError`

### Requirement: Task moves to awaiting_user when model cannot be resolved
The system SHALL catch `UnresolvableProviderError` in the workflow engine and set the task status to `awaiting_user`. A system message SHALL be appended to the task's conversation explaining that the user must select a valid model from the dropdown before execution can proceed.

#### Scenario: Unresolvable model triggers awaiting_user status
- **WHEN** the engine attempts to execute a task with a model prefix that matches no configured provider
- **THEN** the task status is set to `awaiting_user` and a system message is appended: "No provider found for model '...'. Please select a model to continue."

#### Scenario: Null model triggers awaiting_user status
- **WHEN** the engine attempts to execute a task with `model: null`
- **THEN** the task status is set to `awaiting_user` and a system message is appended prompting the user to select a model

### Requirement: models.list RPC aggregates models from all configured providers
The system SHALL fan out `models.list` to all configured providers in parallel using `Promise.allSettled`. Each provider's model IDs SHALL be prefixed with its `id`. Failures from individual providers SHALL be silently skipped. The result is a flat list sorted by provider id then model id.

#### Scenario: Models from multiple providers merged in flat list
- **WHEN** two providers are configured and both respond to their model list endpoints
- **THEN** `models.list` returns a flat array with models from both, each prefixed with their provider's id

#### Scenario: Failed provider skipped without error
- **WHEN** one provider's model list endpoint returns an error or times out
- **THEN** `models.list` still returns models from the remaining providers without throwing

#### Scenario: Empty list when all providers fail
- **WHEN** all configured providers fail to return a model list
- **THEN** `models.list` returns an empty array

## ADDED Requirements

### Requirement: AI call assembles full execution context with provider-agnostic messages
The system SHALL continue to assemble `AIMessage[]` in the internal OpenAI-like format inside `compactMessages()` and `assembleMessages()`. Each `AIProvider` concrete implementation is responsible for adapting that format to its own wire format. The engine and message-assembly code SHALL have no provider-specific branching.

#### Scenario: Engine passes same AIMessage[] regardless of provider type
- **WHEN** the engine calls `provider.stream(messages, options)`
- **THEN** `messages` is always the internal `AIMessage[]` format and the provider handles any required wire format transformation

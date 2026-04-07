## MODIFIED Requirements

### Requirement: AI provider uses OpenAI-compatible chat completions format
The system SHALL communicate with OpenAI-compatible providers using the OpenAI chat completions API format (`POST /v1/chat/completions`). The provider endpoint is configured per-provider entry in the `providers:` list, each with `base_url`, `api_key`, optional `model`, and optional `provider_args`. A new `AnthropicProvider` communicates with Anthropic's native `/v1/messages` API instead. The `createProvider(config)` factory is replaced by `resolveProvider(qualifiedModel, providers)` which selects the correct provider instance from the configured list. Both providers SHALL throw `ProviderError` (with a numeric `status` field and optional `retryAfter`) for any non-2xx HTTP response instead of a plain `Error`. When `provider_args` is set on a provider entry, `OpenAICompatibleProvider` SHALL merge it as the `provider` key in every request body; `AnthropicProvider` SHALL ignore it.

#### Scenario: OpenRouter configured as provider
- **WHEN** `workspace.yaml` has a provider entry with `type: openrouter` and `base_url: https://openrouter.ai/api/v1` with a valid API key
- **THEN** all AI calls for models prefixed `openrouter/` are sent to OpenRouter using the OpenAI format

#### Scenario: Ollama used as local provider
- **WHEN** `workspace.yaml` has a provider entry with `type: openai-compatible` and `base_url: http://localhost:11434/v1` with no API key
- **THEN** all AI calls for models prefixed with that provider's `id` are sent to the local Ollama instance with no authentication header

#### Scenario: Anthropic configured as provider
- **WHEN** `workspace.yaml` has a provider entry with `type: anthropic` and a valid `api_key`
- **THEN** all AI calls for models prefixed `anthropic/` are sent to `https://api.anthropic.com/v1/messages`

#### Scenario: Provider throws ProviderError on non-2xx response
- **WHEN** the upstream API returns a non-2xx HTTP status (e.g., 429, 529, 500)
- **THEN** the provider throws `ProviderError` with the numeric `status` and optional `retryAfter` parsed from the `retry-after` response header; never a plain `Error`

#### Scenario: OpenRouter provider_args routing preferences applied
- **WHEN** `workspace.yaml` has a provider entry with `type: openrouter` and `provider_args: { ignore: ["google-vertex", "azure"] }`
- **THEN** every request to OpenRouter includes `"provider": { "ignore": ["google-vertex", "azure"] }` in the body, preventing routing to those backends

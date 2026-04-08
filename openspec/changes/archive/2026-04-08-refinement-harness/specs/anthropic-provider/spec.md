## MODIFIED Requirements

### Requirement: Anthropic provider sends requests to the native Messages API
The system SHALL implement `AnthropicProvider` that sends requests to the configured base URL (defaulting to `https://api.anthropic.com`) at path `/v1/messages` with:
- `x-api-key: <api_key>` header
- `anthropic-version: 2023-06-01` header
- Request body in Anthropic Messages format (not OpenAI format)

When a provider config entry of type `anthropic` includes a `base_url` field, `instantiateProvider()` SHALL pass it to the `AnthropicProvider` constructor, overriding the default `https://api.anthropic.com`.

#### Scenario: Valid request sent with correct headers
- **WHEN** the engine calls `provider.stream(messages, options)` on an `AnthropicProvider` instance with no custom base_url
- **THEN** the HTTP request is sent to `https://api.anthropic.com/v1/messages` with `x-api-key` and `anthropic-version` headers present and no `Authorization` header

#### Scenario: Custom base_url in provider config
- **WHEN** a provider config has `{ type: "anthropic", api_key: "fake", base_url: "http://localhost:8999" }`
- **THEN** `instantiateProvider()` creates an `AnthropicProvider` with `baseUrl = "http://localhost:8999"` and requests are sent to `http://localhost:8999/v1/messages`

#### Scenario: No base_url in config uses default
- **WHEN** a provider config has `{ type: "anthropic", api_key: "sk-ant-..." }` without a `base_url` field
- **THEN** `instantiateProvider()` creates an `AnthropicProvider` with the default `baseUrl = "https://api.anthropic.com"`

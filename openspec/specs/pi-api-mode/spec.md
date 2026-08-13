# Pi API Mode

## Purpose
Config-driven selection of the OpenAI-compatible API mode (`/v1/chat/completions` vs `/v1/responses`) for the Pi engine, applied to both the pi-ai `Model.api` and the `ModelRuntime` provider registration.

## Requirements

### Requirement: Engine-level API mode with per-provider override
The Pi engine SHALL accept an `api` config key at the engine root (`PiEngineConfig.api`) and an optional override per provider (`PiProviderConfig.api`), with valid values limited to `"openai-completions"` and `"openai-responses"`. The effective mode for a model SHALL resolve as `providers.<providerName>.api ?? config.api ?? "openai-responses"`.

#### Scenario: Engine default applies to all providers
- **WHEN** an engine config declares `api: openai-responses` and two providers without their own `api`
- **THEN** both providers resolve to `openai-responses`

#### Scenario: Provider override wins over engine default
- **WHEN** an engine config declares `api: openai-responses` and `providers.lmstudio.api: openai-completions`
- **THEN** models on provider `lmstudio` resolve to `openai-completions` and models on other providers resolve to `openai-responses`

#### Scenario: No api key configured defaults to openai-responses
- **WHEN** an engine config declares neither engine-level nor provider-level `api`
- **THEN** the effective mode is `openai-responses`

#### Scenario: Unknown api value rejected at construction
- **WHEN** an engine or provider config declares `api: chat-completions`
- **THEN** engine construction fails with a descriptive error listing the valid values

#### Scenario: Unknown provider name falls back to engine default
- **WHEN** a model references a provider that is not present in `providers` and the engine root declares `api: openai-responses`
- **THEN** the effective mode is `openai-responses`

#### Scenario: Unconfigured provider prefix falls back to engine default
- **WHEN** a model id has a provider prefix but the engine declares no `providers` map at all and no engine-level `api`
- **THEN** the effective mode is `openai-responses` (the default)

#### Scenario: Unprefixed model provider resolves from engine default
- **WHEN** a model id has no provider prefix (the `"default"` provider) and no provider-level `api` applies
- **THEN** the effective mode is the engine-level `api` (or the default when absent)

### Requirement: Model and provider registration use the resolved mode
The pi-ai `Model` object built for an execution SHALL set its `api` field to the resolved mode, and the `ModelRuntime` provider registration SHALL use the same resolved mode for the corresponding provider.

#### Scenario: Responses model built from resolved mode
- **WHEN** an execution resolves mode `openai-responses` for provider `vllm`
- **THEN** the built `Model` has `api: "openai-responses"` and the registered provider runtime entry has the same api

#### Scenario: Completions model built from resolved mode
- **WHEN** an execution resolves mode `openai-completions` for provider `lmstudio`
- **THEN** the built `Model` has `api: "openai-completions"` and the provider runtime entry has the same api

#### Scenario: Default fallback provider registered with resolved mode
- **WHEN** an execution targets an unprefixed model whose provider is not explicitly configured
- **THEN** the `"default"` provider is registered in the runtime with the resolved api (and the fallback baseUrl) so auth resolution succeeds

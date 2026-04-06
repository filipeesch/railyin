## Why

OpenRouter routes Anthropic Claude models through Azure/Vertex backends that reject assistant message prefill, causing 400 errors. Users currently have no way to pass provider routing preferences (e.g. `ignore`, `only`, `order`) to OpenRouter or other OpenAI-compatible APIs without code changes.

## What Changes

- Add optional `provider_args` field to `ProviderConfig` in the workspace YAML schema
- `OpenAICompatibleProvider` merges `provider_args` as the `provider` key in every request body when present
- Update `workspace.yaml.sample` and embedded default config to document the field
- No new provider classes needed — purely declarative passthrough

## Capabilities

### New Capabilities
- `provider-args-passthrough`: Workspace YAML accepts a `provider_args` object on any provider entry; its contents are forwarded verbatim as the `provider` field in every OpenAI-compatible API request body

### Modified Capabilities
- `ai-provider`: `ProviderConfig` gains an optional `provider_args` field (additive, non-breaking)

## Impact

- `src/bun/config/index.ts`: `ProviderConfig` interface gains `provider_args?: Record<string, unknown>`
- `src/bun/ai/openai-compatible.ts`: `OpenAICompatibleProvider` constructor accepts and stores `providerArgs`; both `turn()` and `stream()` spread it into the request body
- `src/bun/ai/index.ts`: `instantiateProvider` passes `config.provider_args` when constructing `OpenAICompatibleProvider`
- `config/workspace.yaml` and `config/workspace.yaml.sample`: document `provider_args` usage for OpenRouter

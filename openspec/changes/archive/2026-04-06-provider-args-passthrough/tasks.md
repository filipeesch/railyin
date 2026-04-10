## 1. Config type update

- [x] 1.1 Add optional `provider_args?: Record<string, unknown>` field to `ProviderConfig` interface in `src/bun/config/index.ts`

## 2. Provider implementation

- [x] 2.1 Add `providerArgs` parameter to `OpenAICompatibleProvider` constructor and store as instance field
- [x] 2.2 Merge `provider_args` as `body.provider` in `turn()` when `providerArgs` is set
- [x] 2.3 Merge `provider_args` as `body.provider` in `stream()` when `providerArgs` is set

## 3. Provider instantiation

- [x] 3.1 Pass `config.provider_args` to `OpenAICompatibleProvider` constructor in `instantiateProvider()` in `src/bun/ai/index.ts`

## 4. Config documentation

- [x] 4.1 Add `provider_args` example to `config/workspace.yaml` under the openrouter entry with `ignore: [google-vertex, azure]`
- [x] 4.2 Add `provider_args` commented example to `config/workspace.yaml.sample`
- [x] 4.3 Add `provider_args` to the embedded default config string in `src/bun/config/index.ts` (comment only)

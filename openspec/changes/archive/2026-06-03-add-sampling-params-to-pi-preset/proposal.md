## Why

The Pi engine's `SamplingPreset` only exposes four sampling parameters (`temperature`, `top_p`, `top_k`, `presence_penalty`), leaving out widely-supported params like `repetition_penalty`, `frequency_penalty`, `seed`, and `min_p`. Users running vLLM, SGLang, or OpenRouter cannot tune these from `engines.yaml` config, even though the forwarding mechanism already works for any defined field.

Additionally, `filterDefined()` in `sampling-params.ts` currently leaks `label` and `description` (UI-only metadata) into every LLM API request body, which is semantically incorrect.

## What Changes

- Add four optional numeric fields to `SamplingPreset` in both `src/bun/config/index.ts` and `src/shared/rpc-types.ts`:
  - `repetition_penalty?: number` — penalizes token repetition by a multiplier (range: 1.0–1.2 typical); vLLM, SGLang, OpenRouter
  - `frequency_penalty?: number` — proportional repetition penalty based on token frequency (OpenAI standard); vLLM, SGLang, OpenRouter
  - `seed?: number` — enables reproducible outputs; vLLM, SGLang, OpenRouter, Ollama
  - `min_p?: number` — minimum probability filter, stable alternative to top_p; vLLM, SGLang
- Extract a `SamplingParams` type in `sampling-params.ts` containing only LLM-facing fields (no `label`/`description`). `filterDefined` returns `SamplingParams` filtered by an explicit `SAMPLING_KEYS` allowlist — fixes the UI metadata leak.
- Update `engines.yaml.sample` with documented examples for all new params.
- Update the `pi-sampling-presets` spec to reflect the expanded field set and the `SamplingParams` payload type contract.

## Capabilities

### New Capabilities

_(none — this extends an existing capability)_

### Modified Capabilities

- `pi-sampling-presets`: Adds four new optional fields to `SamplingPreset`; introduces `SamplingParams` as the payload-only type returned by `resolveSamplingPreset`; the `filterDefined` contract now strips UI-only fields before payload injection.

## Impact

- `src/bun/config/index.ts` — `SamplingPreset` interface gains 4 fields
- `src/shared/rpc-types.ts` — `SamplingPreset` interface gains 4 fields (frontend display also benefits from richer param detail lines in the preset selector)
- `src/bun/engine/pi/sampling-params.ts` — new `SamplingParams` type, `SAMPLING_KEYS` set, updated `filterDefined` return type
- `config/engines.yaml.sample` — documentation update only
- `src/bun/test/pi-sampling-params.test.ts` — existing tests updated; new tests added for all four params and label/description stripping

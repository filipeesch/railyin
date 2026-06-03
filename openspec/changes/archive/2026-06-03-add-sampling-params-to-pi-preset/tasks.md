## 1. Expand SamplingPreset interface

- [x] 1.1 Add `repetition_penalty?: number`, `frequency_penalty?: number`, `seed?: number`, `min_p?: number` to `SamplingPreset` in `src/bun/config/index.ts`
- [x] 1.2 Add the same four fields to `SamplingPreset` in `src/shared/rpc-types.ts`

## 2. Introduce SamplingParams type and fix filterDefined

- [x] 2.1 In `src/bun/engine/pi/sampling-params.ts`, export a new `SamplingParams` type containing only the eight LLM-facing numeric fields (`temperature`, `top_p`, `top_k`, `presence_penalty`, `repetition_penalty`, `frequency_penalty`, `seed`, `min_p`)
- [x] 2.2 Add a `SAMPLING_KEYS` constant (`Set<keyof SamplingParams>`) listing all eight keys
- [x] 2.3 Update `filterDefined` to filter by both `v !== undefined` and `SAMPLING_KEYS.has(k)`, returning `SamplingParams` instead of `SamplingPreset`
- [x] 2.4 Update `resolveSamplingPreset` return type to `SamplingParams | undefined`

## 3. Update sample config

- [x] 3.1 Add documented examples for `repetition_penalty`, `frequency_penalty`, `seed`, and `min_p` to the sampling presets block in `config/engines.yaml.sample`, with per-backend support notes in comments

## 4. Update tests

- [x] 4.1 In `src/bun/test/pi-sampling-params.test.ts`, update PS-2 to assert `label` and `description` are not present in the returned object
- [x] 4.2 Update PS-3 to assert all four new params when all eight are defined in a preset
- [x] 4.3 Add a test: preset with `repetition_penalty` returns it in resolved params
- [x] 4.4 Add a test: preset with `frequency_penalty` returns it in resolved params
- [x] 4.5 Add a test: preset with `seed` returns it in resolved params
- [x] 4.6 Add a test: preset with `min_p` returns it in resolved params
- [x] 4.7 Add a test: preset with `label` and `description` defined — neither appears in resolved `SamplingParams`

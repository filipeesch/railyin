## 1. Type Definitions

- [ ] 1.1 Add `SamplingPreset` interface to `src/bun/config/index.ts` with optional fields: `temperature`, `top_p`, `top_k`, `presence_penalty`
- [ ] 1.2 Extend `PiEngineConfig` in `src/bun/config/index.ts` with `sampling_presets?: Record<string, SamplingPreset>` and `default_sampling_preset?: string`
- [ ] 1.3 Add `sampling_preset?: string` to `WorkflowColumnConfig` in `src/bun/config/index.ts`
- [ ] 1.4 Add `samplingPresetName?: string` to `ExecutionParams` in `src/bun/engine/types.ts`
- [ ] 1.5 Add `samplingPreset?: string` to `WorkflowColumn` in `src/shared/rpc-types.ts`

## 2. Sampling Resolver

- [ ] 2.1 Create `src/bun/engine/pi/sampling-params.ts` with `resolveSamplingPreset(presetName, config)` pure function
- [ ] 2.2 Implement fallback chain in `resolveSamplingPreset`: column preset → engine default → `undefined`
- [ ] 2.3 Implement `filterDefined()` helper (or reuse existing) to strip `undefined` fields before merging into `onPayload`
- [ ] 2.4 Log a warning when a referenced preset name is not found in `config.sampling_presets`

## 3. Execution Wiring

- [ ] 3.1 In `TransitionExecutor` (`src/bun/engine/execution/transition-executor.ts`), populate `ExecutionParams.samplingPresetName` from `column.sampling_preset`
- [ ] 3.2 Extract `_applyPresetToSession(session, presetName?)` private method in `PiEngine` that calls `resolveSamplingPreset()` and sets `session.agent.onPayload`
- [ ] 3.3 Set `session.agent.onPayload` to a merge function when a preset resolves (inside `_applyPresetToSession`)
- [ ] 3.4 Set `session.agent.onPayload = undefined` when no preset resolves (inside `_applyPresetToSession`, clears prior execution's value)
- [ ] 3.5 Call `_applyPresetToSession(session, params.samplingPresetName)` from `createManagedExecution()` after session is obtained

## 4. Config Sample

- [ ] 4.1 Update `config/engines.yaml.sample` with commented Pi engine example showing `sampling_presets` with at least two named presets and `default_sampling_preset`
- [ ] 4.2 Update `config/workspace.yaml.sample` (if it references column schema) to show `sampling_preset` field on a column example

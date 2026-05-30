## 1. Pure Unit Tests — resolveSamplingPreset

- [ ] 1.1 Create `src/bun/test/pi-sampling-params.test.ts` with import of `resolveSamplingPreset` from `@bun/engine/pi/sampling-params.ts`
- [ ] 1.2 PS-1: known preset name returns exact values
- [ ] 1.3 PS-2: partial preset — only defined fields in returned object
- [ ] 1.4 PS-3: all four params returned when all defined
- [ ] 1.5 PS-4: `undefined` name + no engine default → `undefined`
- [ ] 1.6 PS-5: `undefined` name + engine default set → returns default preset
- [ ] 1.7 PS-6: explicit name takes priority over engine default
- [ ] 1.8 PS-7: unknown preset name → logs warning, falls back to engine default
- [ ] 1.9 PS-8: unknown preset + no default → `undefined` (no throw)
- [ ] 1.10 PS-9: missing `sampling_presets` map is safe (no throw)
- [ ] 1.11 PS-10: `temperature: 0` is preserved (falsy ≠ undefined safety check)

## 2. PiEngine _applyPresetToSession Unit Tests

- [ ] 2.1 Extend `MockAgentSession.agent` in `pi-engine.test.ts` with `onPayload?: (payload: unknown, model: unknown) => unknown`
- [ ] 2.2 PE-PRESET-1: resolved preset → `session.agent.onPayload` is set to a function
- [ ] 2.3 PE-PRESET-2: `onPayload` function merges only defined preset fields into the payload
- [ ] 2.4 PE-PRESET-3: no resolvable preset → `session.agent.onPayload` is `undefined`
- [ ] 2.5 PE-PRESET-4: second call with different preset → `onPayload` updated (not stale)
- [ ] 2.6 PE-PRESET-5: session reuse leakage — preset then no-preset → `onPayload` cleared to `undefined`

## 3. TransitionExecutor Integration Tests

- [ ] 3.1 Add workflow YAML fixture with a column that has `sampling_preset: balanced` to `transition-executor.test.ts`
- [ ] 3.2 TE-PRESET-1: column with `sampling_preset` → `ExecutionParams.samplingPresetName === "balanced"`
- [ ] 3.3 TE-PRESET-2: column without `sampling_preset` → `ExecutionParams.samplingPresetName` is `undefined`

## 4. ExecutionParamsBuilder Passthrough Tests

- [ ] 4.1 EPB-PRESET-1: `samplingPresetName` passes through `build()` unchanged
- [ ] 4.2 EPB-PRESET-2: absent `samplingPresetName` → field is `undefined`

## 5. Config Parsing Tests

- [ ] 5.1 CC-PRESET-1: column YAML with `sampling_preset: precise` → `getColumnConfig()` returns column with `sampling_preset === "precise"`
- [ ] 5.2 CC-PRESET-2: column without `sampling_preset` → field is `undefined`
- [ ] 5.3 CC-PRESET-3: `engines.yaml` Pi entry with `sampling_presets` block → `PiEngineConfig` populated correctly
- [ ] 5.4 CC-PRESET-4: `engines.yaml` Pi entry without sampling fields → loads without error

## 6. Run and Verify

- [ ] 6.1 Run `bun test src/bun/test --timeout 20000` and confirm all new tests pass with no pre-existing failures introduced

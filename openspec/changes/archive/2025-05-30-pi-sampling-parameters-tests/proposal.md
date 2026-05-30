## Why

The `pi-sampling-parameters` change introduces a pure resolver function, a private wiring method, config type extensions, and a new field in `ExecutionParams`. None of these are covered by existing tests. Without a dedicated test suite, regressions in the fallback chain (especially the session-reuse leakage scenario) would be silent.

## What Changes

- **New**: `src/bun/test/pi-sampling-params.test.ts` — pure unit tests for `resolveSamplingPreset()`
- **Modified**: `src/bun/test/pi-engine.test.ts` — extend `MockAgentSession.agent` with `onPayload` field; add `PE-PRESET-*` suite testing `_applyPresetToSession()` via bracket notation
- **Modified**: `src/bun/test/transition-executor.test.ts` — add `TE-PRESET-*` cases verifying `samplingPresetName` flows through `ExecutionParams`
- **Modified**: `src/bun/test/execution-params-builder.test.ts` — add `EPB-PRESET-*` cases verifying field passthrough
- **Modified**: `src/bun/test/column-config.test.ts` — add `CC-PRESET-*` cases verifying YAML parsing of `sampling_preset` on columns and `sampling_presets` on engine config

No Playwright specs are needed — this feature has no UI surface.

## Capabilities

### New Capabilities

- `pi-sampling-parameters-test-coverage`: Vitest test coverage for the sampling parameters feature — resolver unit tests, engine wiring tests, params builder passthrough, config parsing, and TransitionExecutor integration

### Modified Capabilities

*(none — all test files are additions or non-behavior-changing extensions to existing suites)*

## Impact

- `src/bun/test/pi-sampling-params.test.ts` — new file
- `src/bun/test/pi-engine.test.ts` — extended (MockAgentSession + new describe block)
- `src/bun/test/transition-executor.test.ts` — extended (two new it() cases)
- `src/bun/test/execution-params-builder.test.ts` — extended (two new it() cases)
- `src/bun/test/column-config.test.ts` — extended (four new it() cases)
- No production code changes
- Depends on: `pi-sampling-parameters` change implemented first

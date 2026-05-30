## Why

The Pi engine currently has no way to control LLM sampling behavior (temperature, top_p, top_k, presence_penalty) per workflow stage. Different columns benefit from different creativity/precision tradeoffs — for example, an exploration column benefits from higher temperature while a code-writing column benefits from lower. Today those parameters are locked to provider defaults.

## What Changes

- **New**: `sampling_presets` map under the Pi engine entry in `engines.yaml` — named groups of sampling parameters
- **New**: `default_sampling_preset` field on the Pi engine config — fallback preset when a column specifies none
- **New**: `sampling_preset: <name>` field on workflow columns — lets each column opt into a specific sampling behavior
- **New**: `resolveSamplingPreset()` pure function in `src/bun/engine/pi/sampling-params.ts` — decoupled preset resolver
- **Modified**: `ExecutionParams` gains `samplingPresetName?: string` — preset name flows from column config through to the Pi engine
- **Modified**: `PiEngine.createManagedExecution()` wires `session.agent.onPayload` per execution to inject resolved sampling values into raw LLM API payloads
- **Refactored**: Extract `_applyPresetToSession(session, presetName?)` private helper from `createManagedExecution()` — separates wiring responsibility and creates a test seam consistent with existing `simulateGetOrCreate` pattern

Parameters supported: `temperature`, `top_p`, `top_k`, `presence_penalty`.

## Capabilities

### New Capabilities

- `pi-sampling-presets`: Config-driven sampling parameter presets for the Pi engine — definition format in `engines.yaml`, column reference syntax, resolution and injection logic, fallback behavior

### Modified Capabilities

- `pi-engine`: Pi engine must accept and apply a `samplingPresetName` from `ExecutionParams`, injecting resolved values via `session.agent.onPayload` per execution
- `engines-config`: `engines.yaml` format extended with `sampling_presets` and `default_sampling_preset` fields under Pi engine entries

## Impact

- `src/bun/config/index.ts` — `PiEngineConfig` and `WorkflowColumnConfig` types extended
- `src/bun/engine/types.ts` — `ExecutionParams` extended with `samplingPresetName`
- `src/shared/rpc-types.ts` — `WorkflowColumn` extended with `samplingPreset`
- `src/bun/engine/execution/transition-executor.ts` — passes `column.sampling_preset` into `ExecutionParams`
- `src/bun/engine/pi/engine.ts` — wires `onPayload` per execution
- `src/bun/engine/pi/sampling-params.ts` — new file (pure resolver)
- `config/engines.yaml.sample` — updated with preset examples
- No DB migrations required (config-driven only)

# Pi Model Config Resolution

## Purpose
Documents how the Pi engine resolves a per-model config from a qualified model id (`{engineId}/{providerId?}/{modelId}`) in the **run path** (`execute()` → `createManagedExecution()`), and why provider-bearing ids must be normalized to their native form before the `config.models` lookup. This is a new requirement because the run path previously dropped configured entries for 3-part and 4-part ids, defaulting reasoning to "off".

## Requirements

### Requirement: Run path resolves per-model config from the native model id
The Pi engine's run path SHALL resolve the per-model config (`modelCfg`) from the **native** model id — the full qualified id with the engine segment removed (`QualifiedModelId.nativeModelId()`), falling back to the raw string when it is not parseable — rather than from the full qualified id directly. This SHALL match the resolution performed by `PiModelBuilder.build()` and `PiEngine.listModels()`. When the native id itself still carries a provider segment, `resolvePiModelConfig` SHALL apply its existing single-segment-strip fallback so the bare or family-prefixed config key is reached.

#### Scenario: 3-part qualified id resolves engine-keyed config
- **WHEN** a conversation runs the model `pi-local/vllm/deepseek-v4-flash` and the engine config keys a model as `deepseek-v4-flash`
- **THEN** the native id resolves to `vllm/deepseek-v4-flash`, the single-segment fallback looks up `deepseek-v4-flash`, and `modelCfg` is the configured entry
- **AND** `modelCfg.reasoning`, `modelCfg.thinkingFormat`, and `modelCfg.variants` are those configured for `deepseek-v4-flash`

#### Scenario: 4-part qualified id resolves family-prefixed config
- **WHEN** a conversation runs the model `pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731` and the engine config keys a model as `deepseek/deepseek-v4-flash-0731`
- **THEN** the native id resolves to `openrouter/deepseek/deepseek-v4-flash-0731`, the single-segment fallback looks up `deepseek/deepseek-v4-flash-0731`, and `modelCfg` is the configured entry

#### Scenario: 2-part qualified id still resolves
- **WHEN** a conversation runs the model `pi-lmstudio/qwen3-8b` and the engine config keys a model as `qwen3-8b`
- **THEN** the native id resolves to `qwen3-8b` (no provider segment) and `modelCfg` is the configured entry

#### Scenario: Unparseable model string falls back to raw string
- **WHEN** the model string is not a valid `QualifiedModelId`
- **THEN** the native id used for lookup is the raw string itself, preserving current fallback behavior

#### Scenario: Configured key unreachable resolves to undefined
- **WHEN** the normalized native id (and any single-segment-stripped variant) does not match a `config.models` key
- **THEN** `modelCfg` is `undefined` and the engine applies its existing defaults (reasoning "off")

### Requirement: Native-id normalization is shared and consistent
The Pi engine SHALL derive the native model id through a single shared helper used by both `PiModelBuilder.build()` and the run-path config resolution, so the two never diverge again. The helper SHALL return `QualifiedModelId.tryParse(str)?.nativeModelId() ?? str`.

#### Scenario: Builder and run path agree
- **WHEN** `PiModelBuilder.build()` and the run-path config resolution both process the same qualified model id
- **THEN** both use the same native id (via the shared helper) and resolve to the same `modelCfg`

#### Scenario: Helper is pure and total
- **WHEN** the shared helper is called with any valid or invalid qualified id string
- **THEN** it returns a non-empty string without throwing (invalid strings fall back to the input)

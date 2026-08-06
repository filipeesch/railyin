## Why

The Pi engine cannot configure models individually: `reasoning` is hardcoded `true`, `maxTokens` is fixed at 8192, reasoning is disabled at the session level (`thinkingLevel = "off"` in engine.ts, session-manager.ts, and child-session.ts), and sampling presets are engine-wide. Users need per-model control over reasoning levels, custom per-request params (e.g. Laguna's `chat_template_kwargs.enable_thinking: true`), sampling presets, and limits — mirroring opencode's `provider.models` config shape, while surfacing them through Railyin's existing generic axis contract (`ModelSettingAxis[]` + `modelParams`).

## What Changes

- Add a per-model config map to `PiEngineConfig` (`models.<id>`), mirroring opencode's `ProviderConfig.models` shape: `name`, `reasoning`, `tool_call`, `interleaved`, `limit{context,output}`, `options`, `variants`, plus Pi-specific `sampling_presets` + `default_sampling_preset`, and an optional `axes` presentation override.
- **BREAKING** Remove engine-level `sampling_presets` / `default_sampling_preset`; sampling presets become per-model.
- Internally translate each model's config into `ModelSettingAxis[]` for the existing chat UI (variants → Mode axis respecting `disabled:true`, sampling presets → Sampling axis, reasoning-capable models → Reasoning/Mode axis, optional `axes` node for presentation overrides).
- Wire runtime application in `execute()`: resolve the active axis value (UI override → default) and merge it into the request body over the base `options`; map `limit.context/output` to Pi `model.contextWindow/maxTokens`; set the session thinking level.
- Child (delegate) sessions inherit the parent reasoning level instead of hardcoded `"off"`.
- `listModels()` synthesizes `settings` + per-model `availablePresets`; `handlers/models.ts` builds presets per model; `model-params-policy` treats `variant`/`sampling` axes on model switch.

## Capabilities

### New Capabilities
- `pi-per-model-config`: per-model reasoning, sampling, custom request options, and limits for the Pi engine, translated from opencode-shaped config to Railyin's generic axis contract.

### Modified Capabilities
- `pi-engine`: Pi models now expose `settings: ModelSettingAxis[]` and per-model `availablePresets` from `listModels()`, and `execute()` applies axis values to the SDK request body and session thinking level.
- `model-settings-metadata`: Pi-engine models now carry normalized `settings` axes (Mode/Sampling/Reasoning) derived from per-model config.
- `pi-sampling-presets`: sampling presets move from engine-level to per-model and are exposed as a per-model Sampling axis.
- `sampling-preset-ui`: preset selector is driven by the active model's `sampling_presets` instead of engine-wide presets.

## Impact

- **Code**: `src/bun/config/index.ts` (types + validation), new `src/bun/engine/pi/model-config.ts` (config→axes translator), `model-builder.ts`, `engine.ts` (`listModels` axes synthesis + `execute` payload merge), `handlers/models.ts` (per-model presets), `model-params-policy.ts` (variant/sampling axis handling), `child-session.ts` (inherit reasoning level), docs.
- **Tests**: config validation, translator precedence, listModels axes synthesis, execute payload merge, child inheritance.
- **API/RPC**: no new surface — reuses `model_params`, `conversations.setModelParams`, `sampling_preset_override`.
- **DB**: no schema change.

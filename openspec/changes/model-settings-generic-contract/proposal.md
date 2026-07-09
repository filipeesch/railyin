## Why

The current model settings implementation stores and displays effort/reasoning controls but never passes the selected value to the engine at runtime — the SDK call is unaffected by user selection. Additionally, the `ModelSettingsInfo` shape hard-codes a single `reasoningMode` axis, which cannot represent Cursor's fully generic `parameters[]` system or accommodate future multi-axis models. A generic contract is needed so that any engine can expose any number of named setting axes, each driven entirely by what the SDK returns — without special-casing model identity in Railyin code.

## What Changes

- **BREAKING** `ModelSettingsInfo.reasoningMode` replaced with `ModelSettingsInfo.settings: ModelSettingAxis[]` — a generic list of named, multi-option axes
- **BREAKING** `conversations.reasoning_mode_override TEXT` column replaced with `conversations.model_params JSON` — persists `[{id, value}]` pairs mirroring Cursor's `ModelSelection.params` shape
- **BREAKING** `Task.reasoningModeOverride` / `ChatSession.reasoningModeOverride` RPC fields replaced with `modelParams: ModelParamValue[]`
- `ExecutionParams` gains a `modelParams?: ModelParamValue[]` field, injected by `ExecutionParamsEnricher` from the DB
- Claude engine adapter maps `modelParams` → `effort` SDK field at runtime
- Copilot engine maps `modelParams` → `reasoningEffort` SDK field at runtime
- Cursor engine passes `modelParams` directly as `ModelSelection.params` at runtime (zero transformation)
- `model-settings-normalizer.ts` refactored: synthesizes `ModelSettingAxis[]` from each SDK's native shape (Claude: `supportedEffortLevels[]`, Copilot: `supportedReasoningEfforts[]`, Cursor: `parameters[]` or `variants[]` fallback)
- `reasoning-mode-policy.ts` renamed to `model-params-policy.ts` and updated to operate on `settings[]` + `model_params` JSON
- Frontend `ConversationInput` reasoning selector replaced with a generic `ModelSettingsSelector` component driven by `settings[]`
- New DB migration: add `model_params JSON`, remove `reasoning_mode_override`

## Capabilities

### New Capabilities
- `model-settings-generic-contract`: Generic per-conversation model parameter contract — axes, options, defaults, and runtime wiring from SDK metadata through to SDK call

### Modified Capabilities
- `model-settings-metadata`: `ModelSettingsInfo` shape changes from single `reasoningMode` axis to `settings: ModelSettingAxis[]`; raw metadata fields on `EngineModelInfo` updated accordingly
- `model-selection`: `Task` and `ChatSession` RPC types replace `reasoningModeOverride: string|null` with `modelParams: ModelParamValue[]`
- `chat-session`: Chat session RPC response updated to carry `modelParams` instead of `reasoningModeOverride`
- `task`: Task RPC response updated to carry `modelParams` instead of `reasoningModeOverride`
- `conversation`: DB schema change — `model_params JSON` replaces `reasoning_mode_override TEXT`

## Impact

- **DB**: New migration (drop `reasoning_mode_override`, add `model_params`)
- **API**: `models.listEnabled` response shape changes (`ModelSettingsInfo`); `tasks.list` / `tasks.get` / `chatSessions.list` responses change (`modelParams` field)
- **Engine layer**: All three engine `execute()` adapters must read and apply `modelParams`
- **Frontend**: `ConversationInput` and related Pinia stores updated
- **Tests**: All tests referencing `reasoningModeOverride`, `reasoning_mode_override`, or `supportedReasoningModes` need updating

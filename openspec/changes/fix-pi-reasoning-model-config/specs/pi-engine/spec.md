# Pi Engine

## MODIFIED Requirements

### Requirement: Per-model config application is extracted into a service
PiEngine SHALL delegate Mode/sampling/axis resolution and `onPayload` assembly to an injectable `PiModelConfigApplier` service rather than implementing it inline in the engine class. The applier SHALL expose `buildSettings(modelCfg)` (Mode/Sampling/axes axes) and `applyToSession(session, modelCfg, modelStr, presetName, modelParams)`. Before calling `applyToSession`, the Pi engine SHALL resolve `modelCfg` from the **native** model id (the qualified id with the engine segment removed). When the conversation's model is addressed by a provider-bearing qualified id (e.g. `pi-local/vllm/deepseek-v4-flash` or `pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731`), the engine SHALL pass the native id to `resolvePiModelConfig` so the configured per-model entry (`deepseek-v4-flash` / `deepseek/deepseek-v4-flash-0731`) is found and its Mode variants, `thinkingFormat`, `reasoning`, and `options` reach the applier.

#### Scenario: applier is injectable for testing
- **WHEN** a test constructs `PiEngine` with a fake `PiModelConfigApplier`
- **THEN** the fake is used for settings/onPayload resolution, allowing isolated unit tests without a real SDK session

#### Scenario: 3-part provider-bearing id reaches the applier with its config
- **WHEN** a conversation runs `pi-local/vllm/deepseek-v4-flash` whose engine config keys a model as `deepseek-v4-flash` (reasoning/thinkingFormat/variants configured)
- **THEN** the engine resolves `modelCfg` from the native id `vllm/deepseek-v4-flash` (fallback key `deepseek-v4-flash`), and `applyToSession` receives that `modelCfg`

#### Scenario: 4-part provider-bearing id reaches the applier with its config
- **WHEN** a conversation runs `pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731` whose engine config keys a model as `deepseek/deepseek-v4-flash-0731`
- **THEN** the engine resolves `modelCfg` from the native id `openrouter/deepseek/deepseek-v4-flash-0731` (fallback key `deepseek/deepseek-v4-flash-0731`), and `applyToSession` receives that `modelCfg`

## ADDED Requirements

### Requirement: Variant reasoning is driven by direct request-body injection
The Pi engine SHALL let each Mode variant control reasoning via **direct, verbatim request-body injection** rather than by a Pi canonical `thinkingLevel`/`reasoningEffort` normalization. A variant MAY declare:
- `thinking: boolean` — when present, an `thinking: { type: "enabled" | "disabled" }` object is injected into the outgoing request body (overriding the SDK's own default toggle, since `onPayload` runs after `buildParams`).
- `options.*` — arbitrary fields merged verbatim into the outgoing request body. The engine SHALL **not** strip `reasoning_effort`/`reasoningEffort` from variant `options` (these are legitimate wire values, e.g. ds4/DeepSeek `reasoning_effort` `none`|`high`|`max`).

The variant node name is an opaque key (the Mode axis value); the user provides the exact reasoning kwargs the target provider needs, so behavior is model-agnostic (DS4 `reasoning_effort`, booleans like `enable_thinking`, `chat_template_kwargs`, etc.).

#### Scenario: Max variant sends reasoning_effort "max" and enabled thinking
- **WHEN** the selected `max` variant is `{ label: "Max", thinking: true, options: { reasoning_effort: "max" } }`
- **THEN** the outgoing request body contains `thinking: { type: "enabled" }` and `reasoning_effort: "max"`

#### Scenario: Normal variant sends reasoning_effort "high"
- **WHEN** the selected `normal` variant is `{ label: "Normal", thinking: true, options: { reasoning_effort: "high" } }`
- **THEN** the outgoing request body contains `thinking: { type: "enabled" }` and `reasoning_effort: "high"`

#### Scenario: None variant disables thinking
- **WHEN** the selected `none` variant is `{ label: "Off", thinking: false, options: { reasoning_effort: "none" } }`
- **THEN** the outgoing request body contains `thinking: { type: "disabled" }` and `reasoning_effort: "none"`

#### Scenario: boolean-only reasoning model
- **WHEN** a variant declares `options: { enable_thinking: true }` without a `thinking` field and without `reasoning_effort`
- **THEN** `onPayload` injects `enable_thinking: true` verbatim and does not add `thinking` or `reasoning_effort`

#### Scenario: reasoning_effort is not stripped from options
- **WHEN** a variant's `options` contains `reasoning_effort` (e.g. `"max"`)
- **THEN** `onPayload` preserves `reasoning_effort` in the merged request body (it is no longer deleted)

### Requirement: Per-model reasoning config wired into the SDK model
The Pi model builder SHALL read per-model config when constructing the `@earendil-works/pi-ai` SDK `Model`: `reasoning` (default `true`) maps to `model.reasoning`; `thinkingFormat` (renamed from `interleaved`) maps to `model.compat.thinkingFormat` when set; when `thinkingFormat` is `"deepseek"`, `model.compat.requiresReasoningContentOnAssistantMessages` SHALL be set to `true`. When `thinkingFormat` is `"openrouter"` **and** the model's native id contains `deepseek` (case-insensitive), `model.compat.requiresReasoningContentOnAssistantMessages` SHALL also be set to `true`. The builder SHALL NOT hardcode `model.reasoning = true` regardless of config.

#### Scenario: reasoning flag from config
- **WHEN** a model config declares `reasoning: false`
- **THEN** the built SDK model has `reasoning: false`
- **AND** the SDK's `getSupportedThinkingLevels(model)` returns only the `off` level

#### Scenario: thinkingFormat wired for DeepSeek
- **WHEN** a model config declares `thinkingFormat: "deepseek"`
- **THEN** the built SDK model has `compat.thinkingFormat === "deepseek"` and `compat.requiresReasoningContentOnAssistantMessages === true`

#### Scenario: OpenRouter-served DeepSeek gets coherence replay flag
- **WHEN** a model config declares `thinkingFormat: "openrouter"` and the model id contains `deepseek` (e.g. `deepseek/deepseek-v4-flash-0731`)
- **THEN** the built SDK model has `compat.thinkingFormat === "openrouter"` and `compat.requiresReasoningContentOnAssistantMessages === true`

#### Scenario: OpenRouter-non-DeepSeek does not get the flag
- **WHEN** a model config declares `thinkingFormat: "openrouter"` and the model id does not contain `deepseek`
- **THEN** the built SDK model has `compat.thinkingFormat === "openrouter"` and `compat.requiresReasoningContentOnAssistantMessages` is not set to `true`

#### Scenario: thinkingFormat omitted uses SDK auto-detection
- **WHEN** a model config omits `thinkingFormat`
- **THEN** the SDK model lets `compat.thinkingFormat` be auto-detected from the provider/baseUrl

# Pi Engine

## MODIFIED Requirements

### Requirement: Per-model config application is extracted into a service
PiEngine SHALL delegate Mode/sampling/axis resolution and `onPayload` assembly to an injectable `PiModelConfigApplier` service rather than implementing it inline in the engine class. The applier SHALL expose `buildSettings(modelCfg)` (Mode/Sampling/axes axes) and `applyToSession(session, modelCfg, modelStr, presetName, modelParams)`. Before calling `applyToSession`, the Pi engine SHALL resolve `modelCfg` from the **native** model id (the qualified id with the engine segment removed). When the conversation's model is addressed by a provider-bearing qualified id (e.g. `pi-local/vllm/deepseek-v4-flash` or `pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731`), the engine SHALL pass the native id to `resolvePiModelConfig` so the configured per-model entry (`deepseek-v4-flash` / `deepseek/deepseek-v4-flash-0731`) is found and its Mode variants, `thinkingFormat`, `reasoning`, and `options` reach the applier.

#### Scenario: applier resolves Mode and canonical level
- **WHEN** `applyToSession` is called with a Mode variant selected
- **THEN** it sets the canonical `session.agent.state.thinkingLevel` from the variant's `reasoningEffort` and assembles the `onPayload` merge

#### Scenario: applier is injectable for testing
- **WHEN** a test constructs `PiEngine` with a fake `PiModelConfigApplier`
- **THEN** the fake is used for settings/onPayload resolution, allowing isolated unit tests without a real SDK session

#### Scenario: 3-part provider-bearing id reaches the applier with its config
- **WHEN** a conversation runs `pi-local/vllm/deepseek-v4-flash` whose engine config keys a model as `deepseek-v4-flash` (reasoning/thinkingFormat/variants configured)
- **THEN** the engine resolves `modelCfg` from the native id `vllm/deepseek-v4-flash` (fallback key `deepseek-v4-flash`), and `applyToSession` receives that `modelCfg`
- **AND** a Mode variant with `reasoningEffort: "xhigh"` yields `thinkingLevel === "xhigh"`

#### Scenario: 4-part provider-bearing id reaches the applier with its config
- **WHEN** a conversation runs `pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731` whose engine config keys a model as `deepseek/deepseek-v4-flash-0731`
- **THEN** the engine resolves `modelCfg` from the native id `openrouter/deepseek/deepseek-v4-flash-0731` (fallback key `deepseek/deepseek-v4-flash-0731`), and `applyToSession` receives that `modelCfg`
- **AND** a Mode variant with `reasoningEffort: "xhigh"` yields `thinkingLevel === "xhigh"`

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

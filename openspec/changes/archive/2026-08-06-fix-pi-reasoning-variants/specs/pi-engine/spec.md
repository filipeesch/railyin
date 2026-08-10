## ADDED Requirements

### Requirement: Per-model reasoning config wired into the SDK model
The Pi model builder SHALL read per-model config when constructing the `@earendil-works/pi-ai` SDK `Model`: `reasoning` (default `true`) maps to `model.reasoning`; `thinkingFormat` (renamed from `interleaved`) maps to `model.compat.thinkingFormat` when set; when `thinkingFormat` is `"deepseek"`, `model.compat.requiresReasoningContentOnAssistantMessages` SHALL be set to `true`. The builder SHALL NOT hardcode `model.reasoning = true` regardless of config.

#### Scenario: reasoning flag from config
- **WHEN** a model config declares `reasoning: false`
- **THEN** the built SDK model has `reasoning: false`
- **AND** the SDK's `getSupportedThinkingLevels(model)` returns only the `off` level

#### Scenario: thinkingFormat wired for DeepSeek
- **WHEN** a model config declares `thinkingFormat: "deepseek"`
- **THEN** the built SDK model has `compat.thinkingFormat === "deepseek"` and `compat.requiresReasoningContentOnAssistantMessages === true`

#### Scenario: thinkingFormat omitted uses SDK auto-detection
- **WHEN** a model config omits `thinkingFormat`
- **THEN** the SDK model lets `compat.thinkingFormat` be auto-detected from the provider/baseUrl

### Requirement: "interleaved" config key is removed in favor of "thinkingFormat"
The `PiModelConfig` SHALL expose `thinkingFormat` and SHALL NOT expose `interleaved` (**BREAKING** rename). Config validation SHALL reject an `interleaved` key with an error indicating it was renamed to `thinkingFormat`, and SHALL reject an invalid `thinkingFormat` value.

#### Scenario: legacy interleaved key rejected with guidance
- **WHEN** a Pi model config contains `interleaved: "reasoning_content"`
- **THEN** validation fails with an error naming `thinkingFormat` as the replacement

#### Scenario: invalid thinkingFormat rejected
- **WHEN** a Pi model config contains `thinkingFormat: "not-a-format"`
- **THEN** validation fails with a descriptive error

### Requirement: Per-model config application is extracted into a service
PiEngine SHALL delegate Mode/sampling/axis resolution and `onPayload` assembly to an injectable `PiModelConfigApplier` service rather than implementing it inline in the engine class. The applier SHALL expose `buildSettings(modelCfg)` (Mode/Sampling/axes axes) and `applyToSession(session, modelCfg, modelStr, presetName, modelParams)`.

#### Scenario: applier resolves Mode and canonical level
- **WHEN** `applyToSession` is called with a Mode variant selected
- **THEN** it sets the canonical `session.agent.state.thinkingLevel` from the variant's `reasoningEffort` and assembles the `onPayload` merge

#### Scenario: applier is injectable for testing
- **WHEN** a test constructs `PiEngine` with a fake `PiModelConfigApplier`
- **THEN** the fake is used for settings/onPayload resolution, allowing isolated unit tests without a real SDK session

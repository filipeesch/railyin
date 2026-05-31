## MODIFIED Requirements

### Requirement: ExecutionParamsBuilder.build() is a pure function
`ExecutionParamsBuilder` SHALL NOT accept or use a `DecisionRepository` parameter. `build()` and `buildForChat()` SHALL NOT call any decision repository method and SHALL NOT append any decision block to `systemInstructions`. `ExecutionParamsBuilder` SHALL NOT apply `contextWindowOverride` or `samplingPresetName` — these are applied by `ExecutionParamsEnricher` after the builder returns. All other behavior (AbortSignal, prompt resolution, attachments) remains unchanged.

#### Scenario: build() does not append decision block
- **WHEN** `build(task, conversationId, executionId, prompt, systemInstructions, workingDirectory, signal, attachments?)` is called
- **THEN** `systemInstructions` in the returned `ExecutionParams` does not contain any decision-related content

#### Scenario: buildForChat() does not append decision block
- **WHEN** `buildForChat(conversationId, executionId, prompt, workingDirectory, model, signal, enabledMcpTools?, attachments?)` is called
- **THEN** `systemInstructions` in the returned `ExecutionParams` does not contain any decision-related content

#### Scenario: build() returns params without contextWindowOverride
- **WHEN** `ExecutionParamsBuilder.build()` is called
- **THEN** the returned `ExecutionParams.contextWindowOverride` is `undefined` (to be set by enricher)

#### Scenario: build() returns params without samplingPresetName
- **WHEN** `ExecutionParamsBuilder.build()` is called
- **THEN** the returned `ExecutionParams.samplingPresetName` is `undefined` (to be set by enricher)

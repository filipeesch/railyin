## ADDED Requirements

### Requirement: Sampling preset applied via onPayload per execution
PiEngine SHALL resolve the sampling preset for each execution from `ExecutionParams.samplingPresetName` against its own `config.sampling_presets`, falling back to `config.default_sampling_preset`. When a preset resolves, PiEngine SHALL set `session.agent.onPayload` to a function that merges the preset's defined fields into the raw LLM API request body. When no preset resolves, PiEngine SHALL set `session.agent.onPayload = undefined` to clear any value from a prior execution on the same reused session.

#### Scenario: onPayload injects resolved preset fields
- **WHEN** `createManagedExecution()` runs with `ExecutionParams.samplingPresetName = "creative"` and `config.sampling_presets.creative = { temperature: 1.2, top_p: 0.98 }`
- **THEN** `session.agent.onPayload` is set to a function that returns `{ ...payload, temperature: 1.2, top_p: 0.98 }`

#### Scenario: onPayload cleared when no preset resolves
- **WHEN** `createManagedExecution()` runs with no resolvable preset after a prior execution that had set `onPayload`
- **THEN** `session.agent.onPayload` is set to `undefined`, preventing prior execution's values from leaking

#### Scenario: Only defined preset fields are injected
- **WHEN** a preset defines `temperature: 0.5` but omits `top_p`, `top_k`, and `presence_penalty`
- **THEN** only `temperature` is merged into the payload; `top_p`, `top_k`, and `presence_penalty` are not present in the merged object

### Requirement: samplingPresetName flows through ExecutionParams
`ExecutionParams` SHALL include an optional `samplingPresetName?: string` field. `TransitionExecutor` SHALL populate this field from `column.sampling_preset` when building `ExecutionParams`. PiEngine is the only consumer that resolves the name to values; other engines SHALL ignore `samplingPresetName`.

#### Scenario: TransitionExecutor passes column sampling_preset as samplingPresetName
- **WHEN** the column config has `sampling_preset: balanced`
- **THEN** `ExecutionParams.samplingPresetName` equals `"balanced"` after `TransitionExecutor` builds the params

#### Scenario: samplingPresetName is undefined when column has no preset
- **WHEN** the column config has no `sampling_preset` field
- **THEN** `ExecutionParams.samplingPresetName` is `undefined`

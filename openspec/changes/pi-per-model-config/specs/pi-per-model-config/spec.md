## ADDED Requirements

### Requirement: Per-model config mirrors opencode's `models.<id>` shape
The Pi engine config `models` map SHALL accept entries keyed by bare model id or `provider/model`, each carrying `name`, `reasoning`, `tool_call`, `interleaved`, `limit{context,output}`, `options` (default request-body params), `variants` (named bundles of `options`, each may set `disabled: true` to hide one), `sampling_presets`, `default_sampling_preset`, and optional `axes` presentation overrides. Config validation SHALL reject unknown keys and invalid combinations.

#### Scenario: Config with a single model is parsed
- **WHEN** `engines.yaml` contains a Pi engine entry with `models: { "deepseek-v4-flash": { name, reasoning: true, options: { reasoning_effort: high }, limit: { context: 524288, output: 65536 } } }`
- **THEN** `PiEngineConfig.models` contains that entry with resolved defaults and no validation error

#### Scenario: Bare model id and provider/model keys both resolve
- **WHEN** a model is referenced as `qwen3-8b` and as `lmstudio/qwen3-8b`
- **THEN** both keys resolve to the same effective model config (provider/model precedence over bare id)

### Requirement: Internal translation to `ModelSettingAxis[]`
A config→axis translator SHALL derive `EngineModelInfo.settings` per model: `variants` (respecting `disabled:true`) become a "Mode" select axis; `sampling_presets` become a "Sampling" select axis; reasoning-capable models without variants get a "Reasoning"/"Mode" axis over documented levels derived from `options.reasoning_effort`/`thinking`; an explicit `axes` node overrides presentation. These pass through `normalizeModelSettings` unchanged so the existing chat UI renders them.

#### Scenario: Variants produce a Mode axis
- **WHEN** a model has `variants: { none: {...}, normal: {...}, max: {...} }` and `low/medium/high` variants with `disabled: true`
- **THEN** `settings` contains a Mode axis with options `none`, `normal`, `max` (disabled variants hidden)

#### Scenario: Sampling presets produce a Sampling axis
- **WHEN** a model has `sampling_presets: { balanced, precise }`
- **THEN** `settings` contains a Sampling axis with those preset names as options

### Requirement: Runtime application of axis values in `execute()`
`execute()` SHALL resolve each axis's active value (`params.modelParams` override wins over config default), then apply it: Mode/thinkingLevel → `session.agent.state.thinkingLevel` and the provider-specific payload knob (`reasoning_effort`, `enable_thinking`, `chat_template_kwargs`); Sampling axis → merged sampling params (`temperature`, `top_p`, etc.); static `options` deep-merged as the base request body. Child (delegate) sessions SHALL inherit the parent session's resolved thinking level.

#### Scenario: UI override wins over config default
- **WHEN** a conversation sets `modelParams: [{id: "mode", value: "max"}]` while the model's default is `normal`
- **THEN** the request body uses the `max` variant's options

#### Scenario: No override applies config default
- **WHEN** a conversation has no `modelParams` for the Mode axis
- **THEN** the request body uses the model config's default variant

#### Scenario: Child session inherits thinking level
- **WHEN** a delegate child session is created from a parent whose resolved thinking level is `high`
- **THEN** the child's `thinkingLevel` is `high`, not the previous hardcoded `"off"`

### Requirement: Sampling presets are per-model
Engine-level `sampling_presets`/`default_sampling_preset` SHALL be removed. Each model owns `sampling_presets`; `handlers/models.ts` SHALL build `availablePresets` from the active model's set. Workflow-column preset names and conversation `sampling_preset_override` SHALL resolve against the active model's preset set, falling back to `default_sampling_preset`, else engine default, else send nothing.

#### Scenario: availablePresets reflect active model
- **WHEN** `listModels()` returns a Pi model with `sampling_presets: { balanced, precise }`
- **THEN** `availablePresets` contains `balanced` and `precise` only

#### Scenario: Preset override falls back to model default
- **WHEN** a conversation's `sampling_preset_override` names a preset absent from the active model
- **THEN** a warning is logged and the model's `default_sampling_preset` is applied

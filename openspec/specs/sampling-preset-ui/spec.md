## Purpose
Defines the UI contract for exposing the per-conversation sampling preset selector — how available presets are surfaced through `ModelInfo`, how `ConversationInput` renders the selector, and how parent views persist changes via RPC.

## Requirements

### Requirement: ModelInfo exposes available presets for Pi models
`ModelInfo` in `src/shared/rpc-types.ts` SHALL include an optional field `availablePresets?: Array<{ name: string; params: SamplingPreset }>`. When the model's engine type is `pi` (identified by `config.type === "pi"`, regardless of engine id), the `models.listEnabled` handler SHALL populate this field from `PiEngineConfig.sampling_presets`. The `params` object includes the full `SamplingPreset` shape including optional `label` and `description` fields. For non-Pi models the field is `undefined`.

#### Scenario: Pi model info includes preset list
- **WHEN** `models.listEnabled` is called and a Pi model is enabled
- **THEN** that model's `ModelInfo.availablePresets` contains one entry per preset defined in `engines.yaml` `sampling_presets`, each with `name` and `params` (including `label` and `description` if present)

#### Scenario: Non-Pi model info has no presets
- **WHEN** `models.listEnabled` is called and a non-Pi model is returned
- **THEN** that model's `ModelInfo.availablePresets` is `undefined`

#### Scenario: Pi model with no presets configured returns empty array
- **WHEN** `models.listEnabled` is called and a Pi model's engine config has no `sampling_presets`
- **THEN** `availablePresets` is an empty array

#### Scenario: Pi engine with custom id (not "pi") is matched by type
- **WHEN** an engine entry has `id: "pi-local"` and `type: pi` in `engines.yaml`
- **THEN** models from that engine are treated as Pi models and `availablePresets` is populated

### Requirement: ConversationInput renders preset selector for Pi engine only
`ConversationInput.vue` SHALL render a preset `Select` dropdown in the model row when and only when `availablePresets` is non-empty (backend only populates it for pi-type engines). The selector SHALL accept a `samplingPresetOverride` prop (string or null) and emit `update:samplingPresetOverride` on change. When `availablePresets` is empty or undefined, the selector is not rendered.

#### Scenario: Preset selector visible for Pi engine
- **WHEN** `ConversationInput` renders with a Pi engine model selected (any engine id whose type is pi)
- **THEN** a preset selector element is present in the model row

#### Scenario: Preset selector hidden for non-Pi engine
- **WHEN** `ConversationInput` renders with a Claude or Copilot model selected
- **THEN** no preset selector element is present in the model row

#### Scenario: Auto option shown as default
- **WHEN** the preset selector renders with `samplingPresetOverride` prop equal to null
- **THEN** the selector displays "Auto" as the selected value

#### Scenario: Preset option shows label (or key) and description
- **WHEN** the preset dropdown is opened
- **THEN** each non-Auto option displays `params.label ?? name` as the title, `params.description` as a subtitle (if present), and a detail line with its numeric parameter values (e.g., `temp: 0.3  top_p: 1.0`)

#### Scenario: Closed selector shows label not key
- **WHEN** a preset with `label: "Creative / Design"` and key `design` is selected
- **THEN** the closed selector trigger shows "Creative / Design" not "design"

#### Scenario: Closed selector falls back to key when no label
- **WHEN** a preset with no `label` field and key `balanced` is selected
- **THEN** the closed selector trigger shows "balanced"

### Requirement: Parent views persist preset change via RPC
`TaskChatView.vue` and `SessionChatView.vue` SHALL handle the `update:samplingPresetOverride` event from `ConversationInput` by calling `conversations.setSamplingPreset` and updating the local task/session state so the selector reflects the new value immediately.

#### Scenario: TaskChatView persists preset selection
- **WHEN** the user selects a named preset in the ConversationInput preset selector
- **THEN** `conversations.setSamplingPreset` is called with the task's `conversationId` and the selected preset name, and `task.samplingPresetOverride` is updated in the local store

#### Scenario: Selecting Auto clears the override
- **WHEN** the user selects "Auto" in the preset selector
- **THEN** `conversations.setSamplingPreset` is called with `preset: null`

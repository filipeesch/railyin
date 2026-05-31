## Purpose
Defines the UI contract for exposing the per-conversation sampling preset selector — how available presets are surfaced through `ModelInfo`, how `ConversationInput` renders the selector, and how parent views persist changes via RPC.

## Requirements

### Requirement: ModelInfo exposes available presets for Pi models
`ModelInfo` in `src/shared/rpc-types.ts` SHALL include an optional field `availablePresets?: Array<{ name: string; params: SamplingPreset }>`. When the model's engine is `pi`, the `models.listEnabled` handler SHALL populate this field from `PiEngineConfig.sampling_presets`. For non-Pi models the field is `undefined`.

#### Scenario: Pi model info includes preset list
- **WHEN** `models.listEnabled` is called and a Pi model is enabled
- **THEN** that model's `ModelInfo.availablePresets` contains one entry per preset defined in `engines.yaml` `sampling_presets`, each with `name` and `params`

#### Scenario: Non-Pi model info has no presets
- **WHEN** `models.listEnabled` is called and a non-Pi model is returned
- **THEN** that model's `ModelInfo.availablePresets` is `undefined`

#### Scenario: Pi model with no presets configured returns empty array
- **WHEN** `models.listEnabled` is called and a Pi model's engine config has no `sampling_presets`
- **THEN** `availablePresets` is an empty array

### Requirement: ConversationInput renders preset selector for Pi engine only
`ConversationInput.vue` SHALL render a preset `Select` dropdown in the model row when and only when the active model's `engineId` is `"pi"`. The selector SHALL accept a `samplingPresetOverride` prop (string or null) and emit `update:samplingPresetOverride` on change. When `availablePresets` is empty or undefined, the selector is not rendered.

#### Scenario: Preset selector visible for Pi engine
- **WHEN** `ConversationInput` renders with a Pi engine model selected
- **THEN** a preset selector element is present in the model row

#### Scenario: Preset selector hidden for non-Pi engine
- **WHEN** `ConversationInput` renders with a Claude or Copilot model selected
- **THEN** no preset selector element is present in the model row

#### Scenario: Auto option shown as default
- **WHEN** the preset selector renders with `samplingPresetOverride` prop equal to null
- **THEN** the selector displays "Auto" as the selected value

#### Scenario: Preset option shows name and parameter details
- **WHEN** the preset dropdown is opened
- **THEN** each non-Auto option displays the preset name and a detail line with its parameter key=value pairs (e.g., `temp=0.3  top_p=1.0`)

### Requirement: Parent views persist preset change via RPC
`TaskChatView.vue` and `SessionChatView.vue` SHALL handle the `update:samplingPresetOverride` event from `ConversationInput` by calling `conversations.setSamplingPreset` and updating the local task/session state so the selector reflects the new value immediately.

#### Scenario: TaskChatView persists preset selection
- **WHEN** the user selects a named preset in the ConversationInput preset selector
- **THEN** `conversations.setSamplingPreset` is called with the task's `conversationId` and the selected preset name, and `task.samplingPresetOverride` is updated in the local store

#### Scenario: Selecting Auto clears the override
- **WHEN** the user selects "Auto" in the preset selector
- **THEN** `conversations.setSamplingPreset` is called with `preset: null`

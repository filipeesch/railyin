## MODIFIED Requirements

### Requirement: Preset selector is driven by the active model
`ConversationInput`'s sampling preset selector SHALL populate its options from the active Pi model's `sampling_presets` (per model), instead of an engine-wide preset list. Selecting a preset persists a `sampling_preset_override` per conversation.

#### Scenario: Selector options match the active model
- **WHEN** a conversation selects a Pi model with `sampling_presets: { balanced, precise }`
- **THEN** the preset selector lists `balanced` and `precise` only

#### Scenario: Override persists per conversation
- **WHEN** the user selects `precise`
- **THEN** `sampling_preset_override` is persisted for that conversation

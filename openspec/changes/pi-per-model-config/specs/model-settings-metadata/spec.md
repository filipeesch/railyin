## MODIFIED Requirements

### Requirement: Pi-engine models carry normalized settings axes
`models.listEnabled` metadata SHALL expose `ModelSettingAxis[]` for Pi-engine models synthesized from per-model config: a Mode/Reasoning axis from `variants` (or derived levels when reasoning-capable without variants), and a Sampling axis from `sampling_presets`. `normalizeModelSettings` SHALL pass these through unchanged so the chat UI renders them without special-casing Pi.

#### Scenario: Pi model metadata includes Mode and Sampling axes
- **WHEN** `models.listEnabled` returns a Pi model with `variants` and `sampling_presets`
- **THEN** its `settings` contains a Mode axis and a Sampling axis alongside provider-native axes

#### Scenario: Disabled variants are hidden from the Mode axis
- **WHEN** a model's `variants` includes entries with `disabled: true`
- **THEN** those entries are omitted from the Mode axis options

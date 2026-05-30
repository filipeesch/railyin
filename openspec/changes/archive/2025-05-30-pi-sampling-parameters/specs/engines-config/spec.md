## ADDED Requirements

### Requirement: Pi engine entry supports sampling_presets and default_sampling_preset
The `engines.yaml` format for Pi engine entries SHALL accept two new optional fields: `sampling_presets` (a map of preset name to sampling parameter object) and `default_sampling_preset` (a string naming the default preset). Each preset object MAY contain any subset of: `temperature` (number), `top_p` (number), `top_k` (number), `presence_penalty` (number). The `config/engines.yaml.sample` file SHALL be updated to document these fields with example presets.

#### Scenario: engines.yaml.sample documents sampling_presets with examples
- **WHEN** a user reads `config/engines.yaml.sample`
- **THEN** they find a commented Pi engine example showing `sampling_presets` with at least two named presets and `default_sampling_preset` referencing one of them

#### Scenario: Pi engine entry with sampling fields parses without error
- **WHEN** `engines.yaml` contains a Pi entry with `sampling_presets: { balanced: { temperature: 0.8 } }` and `default_sampling_preset: balanced`
- **THEN** the config loader constructs a valid `PiEngineConfig` with `sampling_presets` and `default_sampling_preset` populated

#### Scenario: Omitting sampling fields remains valid
- **WHEN** `engines.yaml` has a Pi entry with no `sampling_presets` or `default_sampling_preset` fields
- **THEN** the config loader succeeds and `PiEngineConfig.sampling_presets` defaults to empty / `default_sampling_preset` defaults to undefined

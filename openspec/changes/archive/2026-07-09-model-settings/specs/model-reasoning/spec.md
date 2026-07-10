## ADDED Requirements

### Requirement: V1 reasoning-mode control SHALL cover Copilot, Claude, and Cursor
The v1 conversation model-setting control SHALL be available for models discovered from Copilot, Claude, and Cursor engines only. The control SHALL be rendered using normalized metadata and provider-native option values.

#### Scenario: Copilot model exposes reasoning options
- **WHEN** Copilot discovery reports supported reasoning efforts/default for a model
- **THEN** the model returns populated normalized setting metadata
- **AND** the chat UI renders the control for that model

#### Scenario: Claude model exposes effort/adaptive support
- **WHEN** Claude discovery reports effort-level support for a model
- **THEN** normalized setting metadata includes discovered options/default
- **AND** the chat UI renders the control for that model

### Requirement: Cursor variants SHALL map to v1 reasoning-mode options when semantically eligible
Cursor-discovered variants/parameters SHALL be mapped to v1 setting options when discovery metadata indicates speed/depth mode semantics. This mapping SHALL be metadata-driven and SHALL NOT rely on hardcoded model IDs.

#### Scenario: Cursor fast/normal variants produce setting options
- **WHEN** Cursor discovery returns eligible variants labeled `Fast` and `Normal`
- **THEN** normalized setting metadata includes both values as selectable options

#### Scenario: Non-eligible variants are not exposed as reasoning-mode
- **WHEN** Cursor discovery returns variants that do not satisfy eligibility semantics
- **THEN** those variants are not mapped to v1 reasoning-mode options

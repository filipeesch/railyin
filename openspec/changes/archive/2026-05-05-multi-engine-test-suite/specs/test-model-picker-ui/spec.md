## ADDED Requirements

### Requirement: MP-grouping
Model picker groups models by engine when multiple engines are configured.

#### Scenario: MP-1 models grouped by engine prefix
- **WHEN** `models.listEnabled` returns models with `copilot/`, `claude/`, and `opencode/` prefixes
- **THEN** model picker renders three distinct groups labeled by engine name

#### Scenario: MP-2 search filters across all engine groups
- **WHEN** user types in the model picker search field
- **THEN** matching models from all engine groups are shown; unmatched groups are hidden

---

### Requirement: MP-opencode-persistence
Selecting an OpenCode model persists the full 3-part qualified ID.

#### Scenario: MP-3 opencode model ID persisted as qualified string
- **WHEN** user selects `"opencode/anthropic/claude-sonnet-4-5"` from the model picker
- **THEN** `tasks.setModel` (or `chatSessions.setModel`) is called with `model === "opencode/anthropic/claude-sonnet-4-5"`

---

### Requirement: MP-allowed-engines-filter
Model picker only shows engines allowed by workspace configuration.

#### Scenario: MP-4 allowed_engines=[copilot] hides other engine groups
- **WHEN** workspace config allows only copilot and `models.listEnabled` reflects this filter
- **THEN** model picker renders only the Copilot group; Claude and OpenCode groups are absent

---

### Requirement: MP-engine-badge
Model picker value displays engine context when multiple engines active.

#### Scenario: MP-5 engine prefix visible in selected model display
- **WHEN** user has selected an `opencode/` model and the picker is closed
- **THEN** the picker trigger shows text that identifies the model (display name from `models.listEnabled`)

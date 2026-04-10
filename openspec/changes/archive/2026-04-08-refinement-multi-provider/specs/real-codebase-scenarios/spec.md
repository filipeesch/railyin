## ADDED Requirements

### Requirement: Codebase-type scenario YAML field
Scenarios SHALL support a `codebase` field. When set to `railyin`, the scenario uses the Railyin worktree as its working directory instead of fixture files. Scenarios with `codebase: railyin` SHALL NOT have `fixtures` or `script` fields.

#### Scenario: Scenario declares codebase type
- **WHEN** a scenario YAML contains `codebase: railyin`
- **THEN** the engine-runner uses the provider's worktree path as the working directory

#### Scenario: Fixture-based scenario unchanged
- **WHEN** a scenario YAML contains `fixtures: basic-typescript` and no `codebase` field
- **THEN** the engine-runner creates a temp git repo with fixture files as before

#### Scenario: Validation rejects conflicting fields
- **WHEN** a scenario YAML contains both `codebase: railyin` and `fixtures: basic-typescript`
- **THEN** scenario loading fails with "Scenario '<name>' cannot have both 'codebase' and 'fixtures' fields"

### Requirement: export-markdown scenario
The `export-markdown` scenario SHALL be a real-codebase scenario that tasks the model with adding a Markdown export feature to Railyin's board view.

#### Scenario: export-markdown scenario content
- **WHEN** the `export-markdown.yaml` scenario is loaded
- **THEN** it has `codebase: railyin`, a prompt describing adding a "Export board as Markdown" feature, `column_tools: [read, write, search]`, and `expected_behavior.max_rounds: 15`

### Requirement: cost-tracking-ui scenario
The `cost-tracking-ui` scenario SHALL be a real-codebase scenario that tasks the model with adding a cost tracking display to the conversation view.

#### Scenario: cost-tracking-ui scenario content
- **WHEN** the `cost-tracking-ui.yaml` scenario is loaded
- **THEN** it has `codebase: railyin`, a prompt describing adding per-message cost display, `column_tools: [read, write, search]`, and `expected_behavior.max_rounds: 15`

### Requirement: new-tool scenario
The `new-tool` scenario SHALL be a real-codebase scenario that tasks the model with implementing a new tool in the Railyin tool system.

#### Scenario: new-tool scenario content
- **WHEN** the `new-tool.yaml` scenario is loaded
- **THEN** it has `codebase: railyin`, a prompt describing implementing a hypothetical `count_lines` tool, `column_tools: [read, write, search]`, and `expected_behavior.max_rounds: 15`

### Requirement: retry-config scenario
The `retry-config` scenario SHALL be a real-codebase scenario that tasks the model with adding configurable retry settings to the AI provider.

#### Scenario: retry-config scenario content
- **WHEN** the `retry-config.yaml` scenario is loaded
- **THEN** it has `codebase: railyin`, a prompt describing adding retry count and backoff configuration, `column_tools: [read, write, search]`, and `expected_behavior.max_rounds: 15`

### Requirement: Real-codebase scenarios use metric assertions only
Real-codebase scenarios (`codebase: railyin`) SHALL use only metric-based assertions (`cost_under`, `max_tokens_initial`) and behavioral expectations (`max_rounds`, `must_complete`). They SHALL NOT use cache-deterministic assertions (`cache_prefix_stable`, `tools_hash_stable`) which require scripted mock ordering.

#### Scenario: Real-codebase scenario has metric assertions
- **WHEN** a real-codebase scenario is loaded
- **THEN** its assertions array contains only `cost_under` and/or `max_tokens_initial` types

#### Scenario: Real-codebase scenario has no cache assertions
- **WHEN** a real-codebase scenario is loaded with an assertion of type `cache_prefix_stable`
- **THEN** scenario validation warns "cache_prefix_stable assertion is not meaningful for real-codebase scenarios"

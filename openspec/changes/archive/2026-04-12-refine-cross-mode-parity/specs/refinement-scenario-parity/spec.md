## ADDED Requirements

### Requirement: Scenario YAML prompt field for local/live execution
Each scenario YAML SHALL support a `prompt:` field containing the natural language task prompt used when running in local or live mode. The engine-runner SHALL use this prompt instead of extracting user messages from `script:` when mode is local or live.

#### Scenario: Local mode uses prompt field
- **WHEN** a scenario has both `script:` and `prompt:` fields and is run in local mode
- **THEN** the engine-runner sends `prompt:` as the user message to `handleHumanTurn`, ignoring `script:` user entries

#### Scenario: Mock mode ignores prompt field
- **WHEN** a scenario has both `script:` and `prompt:` fields and is run in mock mode
- **THEN** the engine-runner uses `script:` entries as before, ignoring `prompt:`

### Requirement: Expected behavior definition for local/live scenarios
Each scenario YAML SHALL support an `expected_behavior:` block that defines behavioral assertions for local and live mode runs. Mock mode SHALL ignore `expected_behavior:`.

#### Scenario: Expected behavior with must_call
- **WHEN** a scenario specifies `expected_behavior.must_call: [search_text, edit_file]` and the model only calls `read_file` in local mode
- **THEN** the behavioral assertion `must_call` fails with a message listing the uncalled tools

#### Scenario: Expected behavior with must_not_call
- **WHEN** a scenario specifies `expected_behavior.must_not_call: [run_command]` and the model calls `run_command`
- **THEN** the behavioral assertion `must_not_call` fails

#### Scenario: Expected behavior with max_rounds
- **WHEN** a scenario specifies `expected_behavior.max_rounds: 8` and the model uses 10 round trips
- **THEN** the behavioral assertion `max_rounds` fails

#### Scenario: Expected behavior with must_complete
- **WHEN** a scenario specifies `expected_behavior.must_complete: true` and the model reaches `stop_reason: "end_turn"`
- **THEN** the behavioral assertion `must_complete` passes

#### Scenario: Expected behavior with must_complete failure
- **WHEN** a scenario specifies `expected_behavior.must_complete: true` and the model hits `max_tokens` without ending the turn
- **THEN** the behavioral assertion `must_complete` fails

### Requirement: Soft metrics in expected behavior
The `expected_behavior:` block SHALL support soft metrics that are collected for analysis but do not cause assertion failures: `ideal_rounds` (number) and `ideal_tool_sequence` (array of tool names).

#### Scenario: Ideal rounds recorded but not asserted
- **WHEN** a scenario specifies `expected_behavior.ideal_rounds: 3` and the model uses 5 rounds
- **THEN** the behavioral report notes `actual_rounds: 5, ideal_rounds: 3, delta: +2` but does not fail the scenario

#### Scenario: Ideal tool sequence compared
- **WHEN** a scenario specifies `expected_behavior.ideal_tool_sequence: [search_text, read_file, edit_file]` and the model calls `[search_text, read_file, read_file, edit_file]`
- **THEN** the behavioral report notes the extra `read_file` call but does not fail the scenario

### Requirement: All scenarios run in all modes
Every scenario YAML SHALL be executable in mock, local, and live modes. The `modes:` field in scenario YAML SHALL be removed. Scenarios that previously had `modes: [mock]` SHALL be updated with `prompt:` and `expected_behavior:` fields.

#### Scenario: Former mock-only scenario runs in local mode
- **WHEN** `spawn-agent-cache-sharing.yaml` (previously `modes: [mock]`) is run in local mode
- **THEN** the engine-runner uses the scenario's `prompt:` field and the real model responds with tool calls

#### Scenario: No scenario is filtered by mode
- **WHEN** `loadAllScenarios()` is called with any mode (mock, local, or live)
- **THEN** all scenarios are returned; no filtering by `modes:` field occurs

### Requirement: Scenario fixture directories
Each scenario YAML SHALL support a `fixtures:` field referencing a directory under `refinement/fixtures/`. The engine-runner SHALL copy fixture files into the temp git repo before running the scenario in local or live mode.

#### Scenario: Fixtures copied for local mode run
- **WHEN** a scenario specifies `fixtures: basic-typescript` and runs in local mode
- **THEN** the engine-runner copies `refinement/fixtures/basic-typescript/` into the temp git repo before calling `handleHumanTurn`

#### Scenario: Mock mode skips fixture copy
- **WHEN** a scenario specifies `fixtures: basic-typescript` and runs in mock mode
- **THEN** the engine-runner does not copy fixture files (mock uses scripted responses, not real file access)

#### Scenario: Fixture directory does not exist
- **WHEN** a scenario specifies `fixtures: nonexistent` and no such directory exists
- **THEN** the engine-runner logs a warning and continues with the default empty repo

### Requirement: Two runs per scenario in local and live modes
The runner SHALL execute each scenario twice in local and live modes. Each run SHALL be stored independently under `requests/<scenario>/run-1/` and `requests/<scenario>/run-2/`. Mock mode SHALL continue with a single run.

#### Scenario: Two runs stored independently for local mode
- **WHEN** a scenario completes in local mode
- **THEN** the report directory contains `requests/<scenario>/run-1/` and `requests/<scenario>/run-2/` with independent capture files

#### Scenario: Mock mode runs once
- **WHEN** a scenario completes in mock mode
- **THEN** the report directory contains `requests/<scenario>/001.json`, `002.json`, etc. (single run, no run-1/run-2 subdirectories)

#### Scenario: Aggregation across two runs
- **WHEN** two local mode runs complete for a scenario with run-1 having 3 rounds and run-2 having 5 rounds
- **THEN** the scenario report includes `avg_rounds: 4`, `rounds_variance: 1.0`, `min_rounds: 3`, `max_rounds: 5`

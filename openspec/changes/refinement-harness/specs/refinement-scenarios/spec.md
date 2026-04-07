## ADDED Requirements

### Requirement: Scenarios are defined in YAML files
The system SHALL support scenario definitions as YAML files in `refinement/scenarios/`. Each file SHALL have a `name`, `description`, and an `assertions` array. Files in mock mode SHALL additionally have a `script` array defining the conversation turns.

#### Scenario: Valid scenario file parsed
- **WHEN** the runner loads `refinement/scenarios/edit-file-flow.yaml` containing `name`, `description`, `assertions`, and `script`
- **THEN** the scenario is parsed successfully with all fields accessible

#### Scenario: Missing required fields rejected
- **WHEN** a scenario file lacks the `name` field
- **THEN** the runner rejects it with a descriptive error message

### Requirement: Scenarios define scripted conversation for mock mode
Each scenario MAY include a `script` array where entries define the mock conversation flow. User messages have `role: user` with `content`. Model responses have `respond_with: tool_use` (with `tool` and `input`) or `respond_with: text` (with `content`).

#### Scenario: Multi-turn scripted conversation
- **WHEN** a scenario script has 3 entries: user message, tool_use response, text response
- **THEN** the mock proxy returns the tool_use response on the first model turn and the text response on the second

### Requirement: Scenarios define assertions for validation
Each scenario SHALL include an `assertions` array where each entry has a `type` and type-specific fields. Supported assertion types SHALL include:
- `cache_prefix_stable`: All sub-agent requests have the same tools_hash as the parent
- `tools_include`: Specified tools are present in the request's tools array
- `tools_exclude`: Specified tools are absent from the request's tools array
- `max_tokens_initial`: The first request's max_tokens matches the expected value
- `tool_result_max_chars`: A specific tool's result does not exceed the given character limit
- `tools_count`: The total number of tools in the request matches the expected count

#### Scenario: tools_exclude assertion passes
- **WHEN** a scenario has assertion `{ type: "tools_exclude", names: ["list_dir", "delete_file"] }` and the request's tools do not include those names
- **THEN** the assertion passes

#### Scenario: tools_exclude assertion fails
- **WHEN** a scenario has assertion `{ type: "tools_exclude", names: ["list_dir"] }` and the request's tools include `list_dir`
- **THEN** the assertion fails with a message indicating `list_dir` was found unexpectedly

#### Scenario: cache_prefix_stable assertion passes
- **WHEN** a scenario has assertion `{ type: "cache_prefix_stable" }` and all requests in the execution have the same tools_hash
- **THEN** the assertion passes

#### Scenario: cache_prefix_stable assertion fails on sub-agent mismatch
- **WHEN** a parent request has tools_hash "abc" and a sub-agent request has tools_hash "def"
- **THEN** the assertion fails with a message showing the hash mismatch between parent and sub-agent

### Requirement: Scenarios support mode filtering
Each scenario MAY include a `modes` field (array of `mock`, `local`, `live`). If present, the scenario SHALL only run when the runner's mode matches one of the listed modes. If absent, the scenario runs in all modes.

#### Scenario: Mode-filtered scenario skipped
- **WHEN** a scenario has `modes: [mock]` and the runner is in `local` mode
- **THEN** the scenario is skipped with a log message

#### Scenario: Mode-filtered scenario executed
- **WHEN** a scenario has `modes: [mock, local]` and the runner is in `local` mode
- **THEN** the scenario is executed normally

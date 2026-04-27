## MODIFIED Requirements

### Requirement: Workflow columns are defined in YAML configuration
The system SHALL load workflow column definitions from YAML files. Each column definition SHALL include at minimum an `id`, `label`, and optionally an `on_enter_prompt`, `stage_instructions`, and `tools`. The workflow template itself SHALL optionally include a `workflow_instructions` field. The `on_enter_prompt` field SHALL accept either inline text or a slash reference in the form `/stem [argument]`. The `stage_instructions` and `workflow_instructions` fields SHALL contain inline text only. The `tools` array SHALL accept built-in group names (`read`, `write`, `search`, `web`, `shell`, `interactions`, `agents`) and individual tool names interchangeably — both resolve to tool definitions.

#### Scenario: Columns load from YAML at startup
- **WHEN** the application starts
- **THEN** workflow templates are read from YAML files and available for board assignment

#### Scenario: Column without on_enter_prompt is valid
- **WHEN** a column is defined in YAML without an `on_enter_prompt`
- **THEN** tasks moved into that column have their `execution_state` set to `idle` and no AI call is made

#### Scenario: Column tools config with group name resolves to all tools in that group
- **WHEN** a column's `tools` array contains a group name (e.g. `write`)
- **THEN** `resolveToolsForColumn` expands it to all tool definitions belonging to that group

#### Scenario: Column tools config with individual name still works
- **WHEN** a column's `tools` array contains an individual tool name (e.g. `read_file`)
- **THEN** `resolveToolsForColumn` includes that specific tool definition as before

#### Scenario: Mixed group and individual names are both resolved
- **WHEN** a column's `tools` array contains both group names and individual tool names
- **THEN** `resolveToolsForColumn` expands groups and includes individual tools, deduplicating if a tool appears in both

#### Scenario: Slash reference in on_enter_prompt is resolved before execution
- **WHEN** a column defines `on_enter_prompt: /opsx-propose add-dark-mode`
- **THEN** the engine resolves the reference to the prompt file body (with `$input` substituted) before constructing the AI request

#### Scenario: stage_instructions is inline text passed as system message
- **WHEN** a column defines `stage_instructions: "You are a planning assistant."`
- **THEN** the engine injects that text as the system message for every AI call in that column (after any workflow_instructions)

### Requirement: Stage instructions are injected into every AI call in a column
The system SHALL inject a column's `stage_instructions` as a system message into every AI call made while a task is in that column. `workflow_instructions` from the parent workflow template SHALL be merged before `stage_instructions` (workflow-level first, column-level appended). This applies to both `on_enter_prompt` executions and subsequent human turn messages. Both fields are inline text only.

#### Scenario: Stage instructions injected on prompt execution
- **WHEN** the on_enter_prompt runs for a column with stage_instructions configured
- **THEN** the AI request includes the stage_instructions as the system message (after any workflow_instructions)

#### Scenario: Stage instructions injected on human turn
- **WHEN** a user sends a follow-up message in the task chat while the task is in a column with stage_instructions
- **THEN** the AI request includes the stage_instructions as a system message (after any workflow_instructions)

#### Scenario: No stage_instructions means no injection
- **WHEN** a column does not define stage_instructions
- **THEN** no column-level system message is prepended to AI calls for tasks in that column (workflow_instructions may still be present)

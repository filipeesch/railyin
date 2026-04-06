## MODIFIED Requirements

### Requirement: Workflow columns are defined in YAML configuration
The system SHALL load workflow column definitions from YAML files. Each column definition SHALL include at minimum an `id`, `label`, and optionally an `on_enter_prompt`, `stage_instructions`, and `tools`. The `on_enter_prompt` and `stage_instructions` fields SHALL accept either inline text or a slash reference in the form `/namespace:command [argument]`. The `tools` array SHALL accept built-in group names (`read`, `write`, `search`, `web`, `shell`, `interactions`, `agents`) and individual tool names interchangeably — both resolve to tool definitions.

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
- **WHEN** a column defines `on_enter_prompt: /opsx:propose add-dark-mode`
- **THEN** the engine resolves the reference to the prompt file body (with `$input` substituted) before constructing the AI request

#### Scenario: Slash reference in stage_instructions is resolved before injection
- **WHEN** a column defines `stage_instructions: /opsx:explore`
- **THEN** the engine resolves the reference and injects the resolved body as the system message for every AI call in that column

## ADDED Requirements

### Requirement: Human turn slash references invoke prompt files mid-conversation
The system SHALL detect when a user's chat message begins with a `/namespace:command` pattern and resolve it as a slash reference using the task's project worktree. The resolved prompt body (with `$input` substituted) SHALL replace the user's raw message text before it is sent to the AI.

#### Scenario: User message starting with slash pattern is resolved
- **WHEN** a user sends `/opsx:sync` in the task chat
- **THEN** the engine resolves `.github/prompts/opsx-sync.prompt.md` from the worktree, strips frontmatter, substitutes `$input`, and uses the resolved body as the user turn content sent to the AI

#### Scenario: User message with slash and argument passes argument as $input
- **WHEN** a user sends `/opsx:explore caching strategy` in the task chat
- **THEN** `$input` inside the resolved prompt body is substituted with `caching strategy`

#### Scenario: Unresolvable slash message returns error to user
- **WHEN** a user sends a message starting with `/namespace:command` and the file is not found
- **THEN** the system returns an error message to the user in the conversation and does NOT forward the message to the AI

#### Scenario: Regular messages are not affected
- **WHEN** a user sends a message that does not begin with a `/namespace:command` pattern
- **THEN** the message is forwarded to the AI unchanged

## MODIFIED Requirements

### Requirement: Claude engine uses Claude built-in tools plus Railyin common tools
The Claude engine SHALL rely on Claude's built-in tools for file, shell, search, edit, and agent operations. Railyin SHALL register only its engine-agnostic task-management tools with the Claude engine. Tool results emitted by the Claude engine SHALL include structured `writtenFiles` metadata when file changes can be determined reliably from Claude tool activity.

#### Scenario: Common task-management tools are available in Claude engine
- **WHEN** the Claude engine starts an execution
- **THEN** tools such as `create_task`, `move_task`, and `list_tasks` are available to the model through the SDK integration

#### Scenario: File and shell tools are not shadowed by Railyin duplicates
- **WHEN** the Claude engine is active
- **THEN** Railyin does NOT register duplicate `read_file`, `write_file`, `run_command`, or search tools because Claude's built-in tools already provide those capabilities

#### Scenario: Claude tool result includes structured written files when available
- **WHEN** Claude tool activity provides enough information to identify changed files
- **THEN** the emitted `tool_result` includes `writtenFiles` for those changes

#### Scenario: Claude tool result remains valid when only partial file detail is available
- **WHEN** Claude tool activity confirms file changes but does not include deterministic hunk detail
- **THEN** the emitted `writtenFiles` omits unavailable optional fields while still identifying changed files

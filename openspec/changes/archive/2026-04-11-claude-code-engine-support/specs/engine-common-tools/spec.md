## MODIFIED Requirements

### Requirement: Common tools are task management handlers shared across all engines
The system SHALL keep board/task management tool handlers in the shared common-tools capability across all engines. For the Claude engine, those tools SHALL be registered through the Claude SDK while Claude's own built-in tools continue to own file, shell, search, edit, and agent operations.

#### Scenario: Common tools are available in Claude engine
- **WHEN** the Claude engine runs an execution
- **THEN** the shared task-management tools are registered with the SDK and available for the model to call

### Requirement: All non-common tools remain engine-internal
Tools not in the common-tools set remain internal to the engine that defines them. The Claude engine SHALL rely on Claude's built-in toolset for file-system, shell, search, and editing behavior instead of re-registering Railyin-native equivalents.

#### Scenario: Claude engine does not register native-only file and shell tools
- **WHEN** the Claude engine creates a session/query
- **THEN** it does NOT register duplicate `read_file`, `write_file`, `patch_file`, `run_command`, or search tools because Claude Code mode already provides those capabilities

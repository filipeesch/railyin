## ADDED Requirements

### Requirement: MCP tools controls work in standalone sessions
The chat drawer SHALL expose the MCP tools button and popover in standalone session chat as well as task chat.

#### Scenario: Session drawer shows MCP tools button
- **WHEN** a standalone chat session is open and MCP tools are available for the workspace
- **THEN** the shared input toolbar shows the MCP tools button in the same position and style used in task chat

#### Scenario: Session drawer shows MCP tool status
- **WHEN** the standalone session input renders the MCP tools button
- **THEN** the button reflects the same active and warning indicators used in task chat

### Requirement: MCP tool selection is session compatible
The system SHALL allow MCP tool enablement for standalone sessions without requiring a task ID.

#### Scenario: Session tool selection persists without task context
- **WHEN** the user enables or disables an MCP tool from a standalone session
- **THEN** the tool selection is persisted through a session-compatible or conversation-compatible backend path

#### Scenario: Session tool selection affects subsequent turns
- **WHEN** the user changes enabled MCP tools in a standalone session
- **THEN** subsequent session executions run with the updated tool selection


## Requirements

### Requirement: list_boards tool returns available boards
The system SHALL provide a `list_boards` common tool that returns the available boards in the workspace. The tool SHALL return an array of objects containing `id` (number) and `name` (string) for each board. The tool SHALL require no parameters.

#### Scenario: list_boards returns board id and name
- **WHEN** the agent calls `list_boards` with no arguments
- **THEN** the tool returns a JSON array of `{ id, name }` objects for all boards

#### Scenario: list_boards returns empty array when no boards exist
- **WHEN** no boards exist in the database
- **AND** the agent calls `list_boards`
- **THEN** the tool returns an empty JSON array `[]`

#### Scenario: list_boards is available in cards_read tool group
- **WHEN** a column configures `tools: [cards_read]`
- **THEN** `list_boards` is included in the tools offered to the agent

### Requirement: list_boards tool definition includes description hinting at usage
The `list_boards` tool definition SHALL include a description that explains its purpose: discovering boards before calling board tools from chat sessions. The description SHALL mention that board tools require `board_id` and recommend using `list_boards` first.

#### Scenario: Tool description guides agents to use list_boards before board tools
- **WHEN** the agent inspects the `list_boards` tool definition
- **THEN** the description mentions using it to find boards before calling board tools

### Requirement: Board tool error messages reference list_boards
When board tools fail because `board_id` is missing in a chat session context, the error message SHALL mention `list_boards` as the tool to use for discovering available boards.

#### Scenario: create_card error references list_boards
- **WHEN** `create_card` is called without `board_id` in a chat session (no board context)
- **THEN** the error message mentions `list_boards` as the tool to discover boards

#### Scenario: list_cards error references list_boards
- **WHEN** `list_cards` is called without `board_id` in a chat session (no board context)
- **THEN** the error message mentions `list_boards` as the tool to discover boards

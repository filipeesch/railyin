## ADDED Requirements

### Requirement: create_note and update_note descriptions require explicit user intent
`create_note` and `update_note` tool descriptions in `COMMON_TOOL_DEFINITIONS` SHALL include a warning that the tool is only to be used when the user EXPLICITLY asks (mirroring the board tool pattern). `create_note` SHALL start with "⚠️ NOTE TOOL — use ONLY when the user EXPLICITLY asks to create a note." `update_note` SHALL start with "⚠️ NOTE TOOL — use ONLY when the user EXPLICITLY asks to edit or update a note."

#### Scenario: create_note description requires explicit intent
- **WHEN** `COMMON_TOOL_DEFINITIONS` finds the `create_note` tool
- **THEN** the description contains "EXPLICITLY asks"

#### Scenario: update_note description requires explicit intent
- **WHEN** `COMMON_TOOL_DEFINITIONS` finds the `update_note` tool
- **THEN** the description contains "EXPLICITLY asks"

#### Scenario: create_note retains functional description
- **WHEN** `COMMON_TOOL_DEFINITIONS` finds the `create_note` tool
- **THEN** the description still explains note scope, content, and visibility

#### Scenario: update_note retains functional description
- **WHEN** `COMMON_TOOL_DEFINITIONS` finds the `update_note` tool
- **THEN** the description still explains updating content/tags and calling list_notes first

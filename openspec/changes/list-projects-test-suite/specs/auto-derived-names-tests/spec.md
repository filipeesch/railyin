## ADDED Requirements

### Requirement: Tests verify COMMON_TOOL_NAMES is auto-derived
The test suite SHALL verify that `COMMON_TOOL_NAMES` is auto-derived from `COMMON_TOOL_DEFINITIONS` — no manual name enumeration exists. Adding a tool to definitions SHALL automatically include it in names.

#### Scenario: COMMON_TOOL_NAMES matches COMMON_TOOL_DEFINITIONS
- **WHEN** `COMMON_TOOL_NAMES` and `COMMON_TOOL_DEFINITIONS` are compared in tests
- **THEN** every name in `COMMON_TOOL_DEFINITIONS` is present in `COMMON_TOOL_NAMES`
- **AND** `COMMON_TOOL_NAMES` contains no extra names not in `COMMON_TOOL_DEFINITIONS`

#### Scenario: No manual name strings in COMMON_TOOL_NAMES construction
- **WHEN** the source code of `COMMON_TOOL_NAMES` is inspected in tests
- **THEN** it uses `COMMON_TOOL_DEFINITIONS.map(t => t.name)` — not a manual array of strings

### Requirement: Tests verify CHILD_COMMON_TOOL_NAMES is auto-derived from childAllowed
The test suite SHALL verify that `CHILD_COMMON_TOOL_NAMES` is auto-derived from `COMMON_TOOL_DEFINITIONS` by filtering for `childAllowed === true`. Adding `childAllowed: true` to any tool SHALL automatically include it in child names.

#### Scenario: CHILD_COMMON_TOOL_NAMES contains exactly 6 todo tools
- **WHEN** `CHILD_COMMON_TOOL_NAMES` is inspected in tests
- **THEN** it contains exactly 6 names: `create_todo`, `edit_todo`, `list_todos`, `get_todo`, `reorganize_todos`, `update_todo_status`

#### Scenario: Todo tools have childAllowed true in definitions
- **WHEN** `COMMON_TOOL_DEFINITIONS` is inspected for todo tools
- **THEN** each of the 6 todo tools has `childAllowed: true`

#### Scenario: Non-todo tools are not in CHILD_COMMON_TOOL_NAMES
- **WHEN** `CHILD_COMMON_TOOL_NAMES` is inspected in tests
- **THEN** it does NOT contain `list_projects`, `decision_request`, `list_decisions`, `create_note`, or any non-todo tool

#### Scenario: Adding childAllowed to a tool auto-adds it to CHILD_COMMON_TOOL_NAMES
- **WHEN** a tool definition in `COMMON_TOOL_DEFINITIONS` is updated to include `childAllowed: true`
- **THEN** `CHILD_COMMON_TOOL_NAMES.has(toolName)` returns `true` without manual update

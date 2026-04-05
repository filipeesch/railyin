## ADDED Requirements

### Requirement: Ask user options support description and recommended flag
The system SHALL extend the `ask_me` tool option schema to support optional `description` (explanatory text) and `recommended` (boolean) fields per option. The UI SHALL render descriptions beneath their option label and SHALL visually distinguish the recommended option.

#### Scenario: Option with description renders explanation text
- **WHEN** an `ask_user_prompt` message contains an option with a `description` field
- **THEN** the description is displayed below the option label in the question widget

#### Scenario: Recommended option is visually highlighted
- **WHEN** an `ask_user_prompt` message contains an option with `recommended: true`
- **THEN** that option is visually distinguished (e.g., a "Recommended" badge) in the question widget

#### Scenario: Missing description and recommended fields render normally
- **WHEN** an option has no `description` or `recommended` field
- **THEN** the option renders identically to the current behavior (label only)

### Requirement: Ask user options support markdown preview
The system SHALL support an optional `preview` field on options containing a markdown string. When any option in a question has a preview, the UI SHALL display the preview content alongside the option list — showing the preview of the currently selected or hovered option.

#### Scenario: Preview pane appears when any option has preview content
- **WHEN** an `ask_user_prompt` question has at least one option with a `preview` field
- **THEN** a preview pane is rendered showing the preview of the focused/selected option

#### Scenario: Preview renders as markdown
- **WHEN** a preview pane is shown
- **THEN** the content is rendered as formatted markdown (code blocks, inline code, etc.)

#### Scenario: No preview pane when no options have preview
- **WHEN** no options in a question have a `preview` field
- **THEN** the layout is identical to the current single-column option list

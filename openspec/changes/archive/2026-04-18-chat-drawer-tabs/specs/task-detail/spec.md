## MODIFIED Requirements

### Requirement: Task detail drawer body uses a full-width single-column layout
The system SHALL render the task detail drawer body as a single full-width column containing the active tab content. The two-column layout (conversation + side panel) SHALL be removed.

#### Scenario: Chat tab body is full width
- **WHEN** the Chat tab is active
- **THEN** the conversation timeline occupies the full drawer width with no side panel

#### Scenario: Side panel is not rendered
- **WHEN** the task detail drawer is open
- **THEN** no metadata side panel (workflow state, branch, execution stats, session notes, transition buttons) is rendered alongside the conversation

## REMOVED Requirements

### Requirement: Side panel displays workflow state, execution info, branch, and transition buttons
**Reason**: The side panel is replaced by the Info tab and the toolbar workflow select. Workflow transitions move to the toolbar select. Branch and worktree info moves to the Info tab. Execution state is shown via the header badge only.
**Migration**: Use the Info tab for metadata. Use the toolbar workflow select for transitions.

### Requirement: Edit button is shown in the drawer header
**Reason**: The edit button moves to the Info tab, inline with the Description section, for contextual placement.
**Migration**: Access task edit from the Info tab → Description section → Edit button.

## MODIFIED Requirements

### Requirement: Drawer toolbar contains a tab switcher on the left and an action cluster on the right
The system SHALL render a persistent toolbar row below the drawer header containing a tab switcher (Chat, Info, Git, Decisions) anchored to the left and an action cluster (workflow select, terminal button, code editor button, retry button, launch buttons) anchored to the right.

#### Scenario: Toolbar is always visible
- **WHEN** the task detail drawer is open
- **THEN** the toolbar row is visible regardless of which tab is active

#### Scenario: Chat tab is active by default
- **WHEN** the task detail drawer is opened for any task
- **THEN** the Chat tab is the active tab

#### Scenario: Switching to Info tab shows Info content
- **WHEN** the user clicks the Info tab
- **THEN** the Info tab becomes active and the drawer body shows project metadata and description

#### Scenario: Switching to Git tab shows Git content
- **WHEN** the user clicks the Git tab
- **THEN** the Git tab becomes active and the drawer body shows the worktree management panel

#### Scenario: Switching to Decisions tab shows Decisions content
- **WHEN** the user clicks the Decisions tab
- **THEN** the Decisions tab becomes active

#### Scenario: Switching to Chat tab shows Chat content
- **WHEN** the user clicks the Chat tab
- **THEN** the Chat tab becomes active and the drawer body shows the conversation timeline, changed files panel, todo panel, and chat input

#### Scenario: Tab order is Chat, Info, Git, Decisions
- **WHEN** the toolbar is rendered
- **THEN** the tabs appear in the order: Chat, Info, Git, Decisions

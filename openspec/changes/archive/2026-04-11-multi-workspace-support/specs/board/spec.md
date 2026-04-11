## MODIFIED Requirements

### Requirement: Board is the primary navigation surface
The board is the primary navigation surface inside the active workspace. It SHALL expose workspace switching at the top level and board switching within the selected workspace.

#### Scenario: Workspace tabs shown above board controls
- **WHEN** the user opens the board view and more than one workspace exists
- **THEN** the header shows each workspace as a tab above the board selector

#### Scenario: Board selector scoped to active workspace
- **WHEN** a workspace tab is active
- **THEN** the board selector only lists boards that belong to that workspace

### Requirement: Board shows unread activity on task cards and workspace tabs
The board SHALL indicate unread task activity on individual task cards, and the board header SHALL aggregate that state onto workspace tabs.

#### Scenario: Task card gets unread indicator on meaningful activity
- **WHEN** a task receives meaningful unseen activity
- **THEN** its card shows an unread activity indicator

#### Scenario: Workspace tab aggregates unread tasks
- **WHEN** any task in a workspace is unread
- **THEN** that workspace tab shows an unread activity indicator

#### Scenario: Task unread indicator clears when task opened
- **WHEN** the user opens a task with unread activity
- **THEN** that task card's unread indicator is cleared

#### Scenario: Workspace unread clears when all tasks are seen
- **WHEN** a workspace no longer has any unread tasks
- **THEN** its workspace tab unread indicator is cleared

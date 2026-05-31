## MODIFIED Requirements

### Requirement: Switching active workspace preserves other workspaces
The system SHALL maintain one or more workspaces per installation. Each workspace acts as the root container for its own boards, projects, workflow templates, and workspace-local AI configuration. The UI SHALL allow one workspace to be active at a time without deleting or merging the others. **When the user switches workspaces, the following states MUST be refreshed for the new workspace:**
- Board list (re-fetched from the server and filtered to the target workspace)
- Chat session list (re-fetched scoped to the target workspace)
- Workspace configuration and enabled models (already implemented via `load()`)

The non-active workspace's data MUST remain intact in the database and become fully available when the user switches back to it.

#### Scenario: Default workspace synthesized for legacy installs
- **WHEN** the application starts before any workspace folders exist under `~/.railyin/workspaces/`
- **THEN** the system creates or resolves one default workspace from the legacy single-workspace configuration

#### Scenario: Multiple workspaces loaded from folders
- **WHEN** multiple workspace folders exist under `~/.railyin/workspaces/`
- **THEN** the application loads those workspaces as separate top-level containers

#### Scenario: Switching active workspace preserves other workspaces
- **WHEN** the user switches from one workspace to another
- **THEN** boards, projects, and task history in the non-active workspace remain unchanged and available when revisited

#### Scenario: Switching workspace refreshes dependent state
- **WHEN** the user switches from workspace A to workspace B via the workspace tabs
- **THEN** the UI shows boards, chat sessions, and config scoped to workspace B (not stale data from workspace A)

#### Scenario: Revisiting a previously active workspace restores its state
- **WHEN** the user switches from workspace B back to workspace A (previously viewed earlier)
- **THEN** the UI displays the correct boards and chat sessions for workspace A as they were when last viewed

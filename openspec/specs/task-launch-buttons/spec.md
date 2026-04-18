## Purpose
Defines the launch controls shown on TaskCard and TaskDetailDrawer for triggering run profiles and tool launchers defined in a project's `railyin.yaml`.

## Requirements

### Requirement: TaskCard shows a run profile button when profiles are configured
The TaskCard SHALL display a launch control for run profiles when the task's project has one or more profiles defined in `railyin.yaml`. If no profiles are configured, no button is shown.

#### Scenario: Single run profile configured
- **WHEN** the project has exactly one run profile
- **THEN** the TaskCard shows a plain Button with the profile's icon and label

#### Scenario: Multiple run profiles configured
- **WHEN** the project has two or more run profiles
- **THEN** the TaskCard shows a SplitButton where the first profile is the primary action and remaining profiles appear in the dropdown menu

#### Scenario: No run profiles configured
- **WHEN** the project has no run profiles (or no railyin.yaml)
- **THEN** no run profile button is shown on the TaskCard

### Requirement: TaskCard shows tool buttons when tools are configured
The TaskCard SHALL display one Button per tool launcher when the task's project has tools defined in `railyin.yaml`. If no tools are configured, no tool buttons are shown.

#### Scenario: Tools are configured
- **WHEN** the project has one or more tool launchers
- **THEN** the TaskCard shows one Button per tool, each using the tool's icon and label

#### Scenario: No tools configured
- **WHEN** the project has no tools defined
- **THEN** no tool buttons are shown on the TaskCard

### Requirement: TaskDetailDrawer conversation panel shows the same launch controls as the TaskCard
The conversation panel within TaskDetailDrawer SHALL show the identical run profile SplitButton/Button and tool Buttons as appear on the TaskCard, using the same visibility rules.

#### Scenario: Launch controls match the card
- **WHEN** the TaskDetailDrawer is open for a task
- **THEN** the conversation panel shows the same profile and tool buttons as the TaskCard for that task

### Requirement: Clicking a launch button triggers the launch.run RPC
When the user clicks a run profile button (or selects one from the dropdown) or clicks a tool button, the frontend SHALL call `launch.run` with the task ID and the command from that entry. For `mode: "terminal"` responses that include a `sessionId`, the frontend SHALL open the terminal panel and focus that session instead of opening an external terminal.

#### Scenario: Profile button clicked
- **WHEN** the user clicks a run profile Button or SplitButton primary action
- **THEN** the frontend calls `launch.run` with the task's ID and the profile's `command`

#### Scenario: Profile selected from SplitButton dropdown
- **WHEN** the user selects a non-primary profile from the SplitButton dropdown
- **THEN** the frontend calls `launch.run` with the task's ID and the selected profile's `command`

#### Scenario: Tool button clicked
- **WHEN** the user clicks a tool Button
- **THEN** the frontend calls `launch.run` with the task's ID and the tool's `command`

#### Scenario: Run profile routes to in-app terminal
- **WHEN** `launch.run` returns `{ ok: true, sessionId: string }`
- **THEN** the frontend opens the terminal panel (if closed), sets the returned `sessionId` as the active session, and focuses it

#### Scenario: Run profile routes to existing session at same cwd
- **WHEN** a session already exists whose `cwd` matches the task's `worktreePath` and that session is idle (no running process)
- **THEN** the backend reuses that session and runs the new command there, returning the existing `sessionId`

#### Scenario: Run profile when existing session is busy
- **WHEN** a session already exists for that task's `worktreePath` but its process is still running
- **THEN** the backend creates a new session named `<task title> (N)` and returns the new `sessionId`

### Requirement: Launch config is loaded when the task's project is known
The frontend SHALL fetch launch config via `launch.getConfig` when displaying a task, and cache the result for that task's session. The launch buttons SHALL only appear after the config is loaded.

#### Scenario: Config loads successfully
- **WHEN** `launch.getConfig` returns a non-null LaunchConfig
- **THEN** the frontend renders the appropriate buttons

#### Scenario: Config returns null
- **WHEN** `launch.getConfig` returns null
- **THEN** no launch buttons are rendered and no error is shown

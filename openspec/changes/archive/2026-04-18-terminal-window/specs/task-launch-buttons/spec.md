## MODIFIED Requirements

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

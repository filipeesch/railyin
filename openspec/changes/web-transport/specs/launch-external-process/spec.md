## MODIFIED Requirements

### Requirement: Backend can launch a command in an external terminal
The system SHALL provide a `launch.run` RPC handler that spawns the given command string in an in-browser terminal emulator (xterm.js), with CWD set to the task's worktree path or project path fallback. The terminal session SHALL be streamed over a dedicated WebSocket channel at `/ws/pty/<id>`.

#### Scenario: Task has a worktree path
- **WHEN** `launch.run` is called for a task with a non-null `worktreePath`
- **THEN** a PTY session is started with CWD set to `worktreePath` and a session ID is returned

#### Scenario: Task has no worktree path
- **WHEN** `launch.run` is called for a task where `worktreePath` is null
- **THEN** a PTY session is started with CWD set to the task's `project.projectPath` and a session ID is returned

#### Scenario: Frontend connects to PTY session
- **WHEN** the frontend opens `ws://localhost:<PORT>/ws/pty/<id>` using the returned session ID
- **THEN** PTY output is streamed as binary frames and keystrokes sent from the frontend are written to the PTY stdin

#### Scenario: PTY session ends
- **WHEN** the spawned process exits
- **THEN** the server sends a close frame on the WS channel and removes the session

## REMOVED Requirements

### Requirement: Terminal emulator is auto-detected per operating system
**Reason**: Replaced by in-browser terminal (xterm.js + node-pty). The OS terminal emulator is no longer launched; all terminal interaction happens inside the browser.
**Migration**: Use the new PTY-based `launch.run` API. The frontend terminal component renders via xterm.js. No user-facing configuration change is required.

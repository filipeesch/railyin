## Purpose
Provides a backend RPC handler that spawns commands in an in-browser terminal emulator (xterm.js via PTY), using the task's worktree or project path as the working directory. Terminal sessions are streamed over a dedicated WebSocket channel.

## Requirements

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

### Requirement: Commands are launched with correct CWD, not via shell string interpolation
The system SHALL launch commands by setting the terminal's working directory to the resolved CWD and passing the command string to the terminal's shell — not by constructing a shell command with embedded paths in the command string. This prevents path-injection issues.

#### Scenario: CWD-based launch
- **WHEN** a command `npm run dev` is launched with CWD `/path/to/worktree`
- **THEN** the terminal opens at `/path/to/worktree` and executes `npm run dev` within that directory

### Requirement: Launch is fire-and-forget
The system SHALL NOT track the lifecycle of launched processes. Once the terminal is opened, Railyin has no further responsibility for the process.

#### Scenario: User closes terminal
- **WHEN** the user closes the external terminal that was launched
- **THEN** Railyin is unaffected and shows no error or state change

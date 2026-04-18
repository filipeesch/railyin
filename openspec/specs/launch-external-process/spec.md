## Purpose
Provides a backend RPC handler that spawns commands in an external terminal emulator, using the task's worktree or project path as the working directory.

## Requirements

### Requirement: Backend can launch a command in an external terminal
The system SHALL provide a `launch.run` RPC handler that spawns the given command string in a detected external terminal emulator, with CWD set to the task's worktree path or project path fallback.

#### Scenario: Task has a worktree path
- **WHEN** `launch.run` is called for a task with a non-null `worktreePath`
- **THEN** the external terminal launches with CWD set to `worktreePath`

#### Scenario: Task has no worktree path
- **WHEN** `launch.run` is called for a task where `worktreePath` is null
- **THEN** the external terminal launches with CWD set to the task's `project.projectPath`

### Requirement: Terminal emulator is auto-detected per operating system
The system SHALL detect an available terminal emulator at startup or lazily on first use. The result SHALL be cached for the session. No user configuration is required.

#### Scenario: macOS terminal detection
- **WHEN** running on macOS
- **THEN** the system probes for iTerm2, Warp, Ghostty, Kitty (via `/Applications/`) in order and falls back to Terminal.app if none are found

#### Scenario: Windows terminal detection
- **WHEN** running on Windows
- **THEN** the system probes for Windows Terminal (`wt`) via PATH and falls back to `cmd.exe`

#### Scenario: Linux terminal detection
- **WHEN** running on Linux
- **THEN** the system probes for `gnome-terminal`, `konsole`, `xfce4-terminal`, `kitty`, `xterm` via `which` in order and uses the first available

#### Scenario: No terminal found on Linux
- **WHEN** running on Linux and no supported terminal emulator is found
- **THEN** the system returns an error response to the frontend; the frontend shows a toast notification explaining the failure

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

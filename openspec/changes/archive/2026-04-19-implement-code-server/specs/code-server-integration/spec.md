## Purpose
Manages the lifecycle of per-task code-server (VS Code in the browser) processes, providing isolated editor instances for each task's worktree.

## Requirements

### Requirement: code-server is started on-demand per task
The system SHALL spawn a code-server process for a task when the user opens the code editor for that task. The process SHALL open the task's worktree folder and SHALL bind to a dynamically assigned local port.

#### Scenario: Starting code-server for a task with a worktree
- **WHEN** the user opens the code editor for a task that has a worktree path
- **THEN** the system spawns a code-server process bound to `127.0.0.1` at an available port, with `--folder` set to the task's worktree path and `--auth=none`

#### Scenario: Reusing an already-running instance
- **WHEN** the user opens the code editor for a task that already has a running code-server instance
- **THEN** the system returns the existing port without spawning a new process

#### Scenario: code-server is not started without a worktree path
- **WHEN** a task does not have a worktree path
- **THEN** the code editor button SHALL NOT be available and no code-server process is spawned

### Requirement: code-server binary is fetched and cached automatically
The system SHALL use `npx --yes code-server` on first use and SHALL cache the resolved binary path so subsequent starts do not re-download.

#### Scenario: First-time start triggers download
- **WHEN** code-server is started for the first time and no cached binary exists
- **THEN** the system runs `npx --yes code-server` to install it, shows a "Installing code-server…" status in the UI, and proceeds once ready

#### Scenario: Subsequent starts use cached binary
- **WHEN** code-server has been installed previously
- **THEN** the system starts directly using the cached binary without downloading

### Requirement: railyin-ref VS Code extension is auto-installed on spawn
The system SHALL pass `--install-extension <path-to-railyin-ref.vsix>` when spawning code-server so the "Send to Railyin" command is always available.

#### Scenario: Extension is installed on start
- **WHEN** code-server is spawned for any task
- **THEN** the railyin-ref extension is installed (or already present) before the UI is considered ready

### Requirement: code-server process stays warm when overlay is closed
The system SHALL keep the code-server process running when the overlay is closed, so reopening is immediate.

#### Scenario: Closing the overlay does not kill the process
- **WHEN** the user closes the code editor overlay
- **THEN** the code-server process remains running and the port remains allocated

#### Scenario: Reopening the overlay is immediate
- **WHEN** the user reopens the code editor for a task with a warm instance
- **THEN** the overlay shows the iframe immediately without a loading phase

### Requirement: All code-server processes are killed on app exit
The system SHALL kill all running code-server processes when the app exits (graceful shutdown, SIGTERM, SIGINT, or crash).

#### Scenario: Clean shutdown kills all instances
- **WHEN** the Bun server process exits
- **THEN** all tracked code-server PIDs are terminated

### Requirement: The user can manually stop a code-server instance
The system SHALL provide a "Stop" action in the code editor overlay header that kills the process for the current task.

#### Scenario: Clicking Stop kills the process and closes the overlay
- **WHEN** the user clicks the Stop button in the code editor overlay header
- **THEN** the code-server process is killed, the port is released, and the overlay closes

### Requirement: Port assignment avoids conflicts
The system SHALL verify port availability before assigning it to a new code-server instance.

#### Scenario: Available port is assigned
- **WHEN** a new code-server instance is being started
- **THEN** the system checks TCP availability starting from base port 3100 and assigns the first available port

#### Scenario: Port conflict is handled gracefully
- **WHEN** the first candidate port is in use
- **THEN** the system tries subsequent ports until one is available (up to 10 attempts), returning an error if none are found

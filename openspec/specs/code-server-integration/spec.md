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
The system SHALL discover the `code-server` binary using a cross-platform strategy: prefer the locally-installed `node_modules/.bin/code-server`, then `Bun.which("code-server")`, then fall back to `npx --yes code-server`. The previous `which code-server` shell-out is removed so binary discovery works on Windows even though the runtime feature is gated.

#### Scenario: Binary discovered via local node_modules on every platform
- **WHEN** `code-server` is installed under `node_modules/.bin/`
- **THEN** that path is used regardless of host platform

#### Scenario: Binary discovered via Bun.which on Unix
- **WHEN** `code-server` is on `$PATH` (e.g. via Homebrew)
- **THEN** `Bun.which` returns the absolute path and it is used

#### Scenario: npx fallback used when no local install
- **WHEN** `code-server` is not in `node_modules` and not on PATH
- **THEN** the system invokes `npx --yes code-server ...` and code-server is downloaded on first use

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

### Requirement: code-server is unavailable on Windows
The system SHALL detect the Windows platform at the start of `startCodeServer` and SHALL throw a descriptive error rather than spawning the binary. The error message SHALL guide the user to use an external editor instead. The frontend SHALL surface this error as a user-facing notice (e.g. toast) without leaving the UI in a broken state.

#### Scenario: Starting code-server on Windows throws a friendly error
- **WHEN** the user clicks the code-server launch button on Windows
- **THEN** `startCodeServer` throws an error containing the text "not supported on Windows" and suggesting an external editor

#### Scenario: Other code-server entry points are no-ops on Windows
- **WHEN** `stopCodeServer`, `getCodeServerEntry`, or `stopAllCodeServers` are called on Windows
- **THEN** they return safely without error (no entry exists in the registry, so the existing implementation is already correct)

#### Scenario: External editor launch still works on Windows
- **WHEN** the user invokes "Open in external editor" with VS Code on PATH
- **THEN** `launchApp("code .", cwd)` runs successfully via the platform-aware shell, independently of code-server availability

## Purpose
Defines the terminal session list pane within the terminal panel, including resizing, persisted width, and overflow behavior.

## Requirements

### Requirement: Terminal session list width is user-resizable
The system SHALL provide a draggable vertical divider between terminal output and the terminal session list so users can resize the session list width without changing terminal panel height.

#### Scenario: User drags the terminal session divider wider
- **WHEN** the terminal panel is open and the user drags the session divider horizontally
- **THEN** the session list width updates in real time while the terminal output area shrinks accordingly

#### Scenario: Session list width is clamped to safe bounds
- **WHEN** the user drags the divider beyond the supported minimum or maximum
- **THEN** the session list width remains clamped between 160px and 400px

### Requirement: Terminal session pane width persists per browser profile
The system SHALL persist the terminal session list width in browser-local UI state so the chosen width is restored after reload for the same browser profile.

#### Scenario: Reload restores the previous session list width
- **WHEN** a user resizes the terminal session list and reloads the application
- **THEN** the terminal panel restores the previously saved session list width for that browser profile

### Requirement: Terminal session list overflow remains visible and scrollable
The system SHALL preserve native vertical scrolling for terminal sessions and style the native scrollbar so overflow is visually discoverable in the terminal panel theme.

#### Scenario: Overflowing session list shows a visible scrollbar treatment
- **WHEN** the number of terminal sessions exceeds the visible height of the session list
- **THEN** the session list remains scrollable with a visible themed native scrollbar

#### Scenario: Session creation control remains accessible with overflow
- **WHEN** the terminal session list overflows
- **THEN** users can still scroll to hidden sessions and access the new terminal control without losing the ability to switch sessions

### Requirement: Terminal and code-server buttons persist after execution completes
The task drawer's terminal launch button and code-server launch button SHALL remain visible after an AI execution completes, provided the task has a linked worktree. A post-execution DB read that lacks the `task_git_context` JOIN SHALL NOT overwrite the `worktreePath` field with null.

#### Scenario: Terminal button visible after execution completes
- **WHEN** an execution finishes and the `task.updated` WebSocket event is received by the frontend
- **THEN** the terminal launch button remains visible if the task had a worktree before the execution

#### Scenario: Code-server button visible after execution completes
- **WHEN** an execution finishes and the `task.updated` WebSocket event is received by the frontend
- **THEN** the code-server launch button remains visible if the task had a worktree before the execution

#### Scenario: Buttons absent when task has no worktree
- **WHEN** a task has no associated worktree
- **THEN** neither the terminal nor the code-server launch button is shown, regardless of execution state

### Requirement: PTY transport is cross-platform
The system SHALL spawn each terminal session via a PTY transport that works on macOS, Linux, and Windows. Implementation SHALL use `Bun.spawn({ terminal: {} })` which uses `openpty()` on macOS/Linux and `ConPTY (CreatePseudoConsole)` on Windows — no external PTY dependency is required. The shell command line SHALL be assembled using a platform-aware default shell (`$SHELL` when set; `cmd.exe` / `%COMSPEC%` on Windows; `/bin/sh` otherwise) and platform-aware shell args (`-c` on Unix, `/c` on Windows).

#### Scenario: PTY session opens on macOS
- **WHEN** the user opens a PTY pane for a task on macOS
- **THEN** Bun spawns the user's shell via `openpty()`, the WebSocket relays output to xterm.js, and ANSI escape codes render correctly

#### Scenario: PTY session opens on Windows
- **WHEN** the user opens a PTY pane for a task on Windows
- **THEN** Bun spawns `cmd.exe` via ConPTY, the WebSocket relays output to xterm.js, and basic commands like `dir` render correctly

#### Scenario: Interactive shell spawned without shell-wrapping
- **WHEN** `launch.shell` opens a PTY for an interactive terminal session
- **THEN** the shell is spawned directly (e.g. `["/bin/zsh"]`) without any `-c` or `/c` wrapper, giving a clean interactive prompt

#### Scenario: PTY exit propagates to the WebSocket
- **WHEN** the underlying process exits with code N on any platform
- **THEN** `markExited` writes the exit message to the scrollback and notifies all listeners with code N

### Requirement: PtySession exposes a platform-agnostic facade
The system SHALL expose `write(data)`, `resize(cols, rows)`, and `kill()` methods directly on the `PtySession` object. Callers (notably the WebSocket handler) SHALL NOT reach through `session.terminal` or `session.proc` to invoke PTY operations.

#### Scenario: WebSocket forwards keystrokes via session.write
- **WHEN** a `pty` raw-text message arrives over the WebSocket
- **THEN** the handler calls `session.write(text)` and the underlying PTY receives the bytes

#### Scenario: WebSocket forwards resize via session.resize
- **WHEN** a `pty` resize message arrives with cols/rows
- **THEN** the handler calls `session.resize(cols, rows)` and the underlying PTY adjusts its window size

#### Scenario: Killing all sessions uses the facade
- **WHEN** the server shuts down
- **THEN** `killAllPtySessions` invokes `session.kill()` on each session, which delegates to the underlying process kill

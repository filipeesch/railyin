## MODIFIED Requirements

### Requirement: PTY transport is cross-platform
The system SHALL spawn each terminal session via a PTY transport that works on macOS, Linux, and Windows. Implementation SHALL use `node-pty` on every platform (ConPTY on Windows, openpty on Unix) rather than the Bun-native `Bun.spawn(... terminal:{})` API which is Unix-only. The shell command line SHALL be assembled using a platform-aware default shell (`$SHELL` when set; `cmd.exe` / `%COMSPEC%` on Windows; `/bin/sh` otherwise) and platform-aware shell args (`-c` on Unix, `/c` on Windows).

#### Scenario: PTY session opens on macOS
- **WHEN** the user opens a PTY pane for a task on macOS
- **THEN** `node-pty` spawns the user's shell, the WebSocket relays output to xterm.js, and ANSI escape codes render correctly

#### Scenario: PTY session opens on Windows
- **WHEN** the user opens a PTY pane for a task on Windows
- **THEN** `node-pty` spawns `cmd.exe` via ConPTY, the WebSocket relays output to xterm.js, and basic commands like `dir` render correctly

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
- **THEN** `killAllPtySessions` invokes `session.kill()` on each session, which delegates to the underlying `IPty.kill()`

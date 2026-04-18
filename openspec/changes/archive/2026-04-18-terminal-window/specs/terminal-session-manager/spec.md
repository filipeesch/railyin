## Purpose
Defines the backend pty session manager and the RPC/WebSocket interfaces for creating, streaming, resizing, and killing terminal sessions. Pty management uses `Bun.spawn` with its native `terminal` option — no external pty library.

## ADDED Requirements

### Requirement: The backend manages pty sessions using Bun's native terminal API
The Bun backend SHALL maintain an in-memory map of active pty sessions (in `src/bun/launch/pty.ts`), each with a unique UUID, a `cwd`, the spawning `command`, a scrollback ring buffer (max 64KB), and a set of active per-WebSocket data listeners.

#### Scenario: Session created via launch.run
- **WHEN** `launch.run` is called with `mode:"terminal"`
- **THEN** the backend calls `createPtySession(command, cwd)`, spawns a pty using `Bun.spawn` with the `terminal` option, registers the session, and returns `{ ok: true, sessionId }`

#### Scenario: Session exits
- **WHEN** the pty process exits
- **THEN** the backend removes the session from the map; connected WebSocket clients receive the terminal's exit sequence and the connection closes naturally

### Requirement: Pty I/O is streamed over a dedicated WebSocket per session
The backend SHALL accept WebSocket upgrades at `/ws/pty/{sessionId}`. Each connection is independent; multiple clients MAY connect to the same session. On connect, the server SHALL replay the scrollback buffer to bring the client up to date.

#### Scenario: WebSocket connection to valid session
- **WHEN** the frontend opens a WebSocket to `/ws/pty/{sessionId}` for a valid session
- **THEN** the server accepts the upgrade, replays the scrollback buffer as raw bytes, then streams live pty output as raw bytes

#### Scenario: WebSocket connection to unknown session
- **WHEN** the frontend opens a WebSocket to `/ws/pty/{sessionId}` for a session that does not exist
- **THEN** the server sends `\r\n[Session not found]\r\n` and closes the connection

#### Scenario: Frontend sends raw stdin
- **WHEN** the frontend sends a non-JSON string or binary frame over the WebSocket
- **THEN** the backend writes it directly to the pty stdin

#### Scenario: Frontend sends a resize frame
- **WHEN** the frontend sends a JSON frame `{ "type": "resize", "cols": N, "rows": M }`
- **THEN** the backend calls `session.terminal.resize(cols, rows)`

### Requirement: Unlinked shell sessions can be created via launch.shell
The system SHALL expose a `launch.shell` RPC that creates a bare interactive shell (e.g. `/bin/sh`) at a given `cwd` and returns `sessionId`. This is used by the "⊕ New terminal" button for sessions not associated with any task.

#### Scenario: Unlinked session created
- **WHEN** the frontend calls `launch.shell({ cwd })`
- **THEN** the backend calls `createPtySession("/bin/sh", cwd)` and returns `{ sessionId }`

### Requirement: Sessions can be killed via launch.kill
The system SHALL expose a `launch.kill` RPC. Calling it terminates the pty process.

#### Scenario: Kill active session
- **WHEN** the frontend calls `launch.kill({ sessionId })`
- **THEN** the backend calls `session.proc.kill()` and removes the session from the map

#### Scenario: Kill unknown session
- **WHEN** the frontend calls `launch.kill` with an unrecognized `sessionId`
- **THEN** the backend returns `{ ok: false, error: "Session not found" }`

### Requirement: All pty sessions are terminated on backend shutdown
The backend SHALL call `killAllPtySessions()` during its graceful shutdown sequence to prevent orphan pty processes.

#### Scenario: App closes with running sessions
- **WHEN** the Bun backend process shuts down (SIGTERM, SIGINT, or normal exit)
- **THEN** `killAllPtySessions()` is called, killing all tracked pty child processes

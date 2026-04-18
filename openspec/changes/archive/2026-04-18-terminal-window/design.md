## Context

The app is a native web app: a Bun HTTP server (`src/bun/index.ts`) serves the Vue frontend as static files, exposes all RPC handlers as `POST /api/<method>`, and handles push events over a single WebSocket at `/ws`. There is no Electron layer. The previous design assumed an Electroview IPC transport and `node-pty` — both are now obsolete.

**What already exists from main:**
- `src/bun/launch/pty.ts` — pty session manager using `Bun.spawn` with its native `terminal` option (no `node-pty`). Manages a sessions map, scrollback ring (64KB), per-WS data listeners.
- `src/bun/handlers/launch.ts` — `launch.run mode:"terminal"` already calls `createPtySession()` and returns `{ ok: true, sessionId }`.
- `src/bun/index.ts` — WebSocket handler for `/ws/pty/{sessionId}`: on connect it replays scrollback, streams live output, accepts stdin and `{ type:"resize", cols, rows }` frames; `killAllPtySessions()` called on shutdown.
- `src/mainview/components/PtyTerminal.vue` — xterm.js component that connects to `ws://<origin>/ws/pty/{sessionId}`, handles output, sends stdin and resize frames, auto-fits via `ResizeObserver`, replays scrollback on reconnect.

**What still needs to be built:** the terminal panel UI (BoardView layout, footer strip, session list sidebar, panel toggle/resize) and the frontend store and `LaunchButtons` integration.

## Goals / Non-Goals

**Goals:**
- Render a terminal panel at the bottom of BoardView (30–40% height default), toggled by a footer strip and `Ctrl+\``
- Session list sidebar (right side) listing all active sessions
- Footer strip shows running session status
- `LaunchButtons` routes `sessionId` response to the terminal panel store
- New unlinked sessions spawnable from the "⊕ New terminal" button (opens a shell at workspace root via a new `launch.shell` RPC or reusing `launch.run`)

**Non-Goals:**
- Pty session management in the backend — already complete
- `PtyTerminal.vue` xterm.js rendering — already complete
- `launch.run mode:"terminal"` backend — already complete
- Persistent session history across restarts
- Windows support in this iteration

## Decisions

### Decision: Pty uses `Bun.spawn` native `terminal` option — no `node-pty`

**Already decided and implemented.** Bun's built-in pty support via `Bun.spawn({ terminal: { cols, rows, data, exit } })` is used. No external native binding dependency. The session model is in `src/bun/launch/pty.ts`.

### Decision: Pty I/O via dedicated WebSocket per session at `/ws/pty/{sessionId}`

**Already decided and implemented.** Rather than pushing pty output through the shared `/ws` push channel (which broadcasts to all clients), each terminal session gets its own WebSocket endpoint. The frontend (`PtyTerminal.vue`) connects directly. This keeps pty I/O isolated from AI streaming events and avoids per-message routing overhead.

Protocol over `/ws/pty/{sessionId}`:
```
backend → frontend:  raw terminal bytes (UTF-8 string or binary)
frontend → backend:  raw stdin bytes  OR  JSON { type:"resize", cols, rows }
```

Scrollback (up to 64KB) is replayed to new WebSocket connections on open, so the terminal catches up after a panel close/reopen.

### Decision: No `terminal.*` RPC namespace — sessions are created by `launch.run`

The previous design proposed a `terminal.create` RPC. Instead:
- **Task sessions**: `launch.run({ taskId, command, mode:"terminal" })` creates the pty and returns `sessionId`. Already implemented.
- **Unlinked sessions**: A new `launch.shell({ cwd })` RPC will create a bare interactive shell at any `cwd` and return `sessionId`. This keeps all process-spawning in `launch.*` handlers.
- No `terminal.list`, `terminal.kill`, `terminal.input`, `terminal.resize` RPCs needed — I/O and resize go over the WebSocket; session listing is frontend-local state derived from known `sessionId`s.

### Decision: Frontend terminal store tracks sessions locally

Since the backend has no `terminal.list` endpoint, the frontend maintains the session list in a Pinia store. Each entry holds `{ sessionId, label, cwd, status }`. Sessions are added when `launch.run` or `launch.shell` returns a `sessionId`; they are removed when the user kills them (via `launch.kill`) or when the WebSocket closes with an exit frame.

A new `launch.kill({ sessionId })` RPC will be added so the frontend can terminate a session from the UI.

### Decision: Footer strip as sole persistent toggle

A slim bar (≤24px) pinned at the bottom of BoardView is always visible. Shows running session count and last active session name when sessions exist. Clicking or pressing `Ctrl+\`` toggles the panel. This is the only structural change to `BoardView.vue`.

### Decision: Minimum panel height 120px; close only via footer/shortcut

The resize drag handle clamps at 120px minimum. The panel cannot be dragged closed — only the footer strip or keyboard shortcut fully hides it. Height is persisted in `localStorage`.

## Risks / Trade-offs

- **`Bun.spawn terminal` API stability**: Bun's pty API is less documented than `node-pty`. It's already in use and working — risk is mainly around edge cases (e.g., Windows, unusual shells). → Scope to macOS initially.
- **Frontend-local session list**: If the page refreshes, the session list is lost even though pty processes may still be running in the backend. → Accept this for now; a future `launch.listSessions` RPC could recover state.
- **WS reconnect on panel reopen**: `PtyTerminal.vue` already handles reconnect with scrollback replay. Risk is minimal.
- **"⊕ New terminal" cwd**: Unlinked sessions need a reasonable default `cwd`. Using workspace root (`worktreeBasePath`) is safe but may not match user expectations. → Document behavior.

## Migration Plan

1. Add `launch.shell({ cwd })` RPC to backend — creates a bare shell pty, returns `sessionId`. Small addition to `src/bun/handlers/launch.ts`.
2. Add `launch.kill({ sessionId })` RPC to backend — calls `session.proc.kill()`.
3. Add terminal store (`src/mainview/stores/terminal.ts`) tracking sessions and panel state.
4. Update `LaunchButtons.vue` to dispatch `sessionId` from `launch.run` response to the terminal store.
5. Build `TerminalPanel.vue` and `TerminalSessionList.vue` using existing `PtyTerminal.vue`.
6. Add footer strip and `TerminalPanel` to `BoardView.vue`.
7. No data migrations — all state is in-memory / localStorage.

## Open Questions

- Should `launch.kill` gracefully send SIGTERM first with a timeout before SIGKILL?
- Should the session list label show the full command or just the task name?

## Why

Running a task's dev server or test suite currently opens an external terminal app, pulling the user out of railyin entirely. An integrated terminal panel — like VS Code's or browser DevTools — keeps the workflow inside the app: run, observe output, and manage tasks without context switching.

## What Changes

- **New terminal panel** at the bottom of BoardView, toggled by a footer strip and `Ctrl+\``. Occupies ~30–40% of screen height when open; board columns resize above it.
- **Session list sidebar** on the right side of the terminal panel, listing all active sessions with their associated task name and last command. Sessions without a task are labeled by their cwd.
- **Run profiles now open the in-app terminal** instead of an external terminal app. `launch.run` with `mode: "terminal"` is rerouted to a new in-app pty session.
- **Session–task linking**: clicking a run profile button on a task opens (or reuses) a terminal session whose `cwd` is the task's `worktreePath` (falling back to `projectPath`). A new session is always created if the existing one is busy.
- **Unlinked sessions**: a "New terminal" button in the session list opens a free session at workspace root with no task association.
- **Footer strip**: a slim persistent bar at the bottom of BoardView shows running session status and acts as the toggle to open/close the terminal panel.
- **Pty owned by Bun backend**: all pty process lifecycle (create, I/O, resize, kill) lives in the backend. The frontend renders output using xterm.js and streams keystrokes over RPC.

## Capabilities

### New Capabilities

- `terminal-panel`: The in-app terminal panel UI — layout, toggle behavior, resize handle, footer strip, keyboard shortcut.
- `terminal-session-manager`: Session lifecycle managed by the Bun backend via pty — create, stream I/O, resize, kill, list. New RPC surface: `terminal.create`, `terminal.input`, `terminal.resize`, `terminal.kill`, `terminal.list`, and push events `terminal.output` / `terminal.exit`.

### Modified Capabilities

- `task-launch-buttons`: Run profile buttons now route `mode: "terminal"` to the in-app terminal panel instead of launching an external terminal app.

## Impact

- **Frontend**: New `TerminalPanel.vue`, `TerminalSessionList.vue`, footer strip in `BoardView.vue`, xterm.js dependency.
- **Backend**: New `src/bun/handlers/terminal.ts`, new `src/bun/terminal/` module (pty management using `node-pty`).
- **RPC**: New `terminal.*` namespace added to `rpc-types.ts`; push event mechanism used (same pattern as existing streaming).
- **Dependencies**: `xterm` (frontend), `node-pty` (backend).
- **No schema changes**: `railyin.yaml` config is unchanged; existing `launch.run` RPC signature is unchanged — only the handler behavior for `mode: "terminal"` changes.

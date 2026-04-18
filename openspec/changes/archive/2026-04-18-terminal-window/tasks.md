## 1. Backend: New RPC Endpoints

- [x] 1.1 Add `launch.shell({ cwd: string })` handler in `src/bun/handlers/launch.ts` — calls `createPtySession("/bin/sh", cwd)` and returns `{ sessionId }`
- [x] 1.2 Add `launch.kill({ sessionId: string })` handler — calls `session.proc.kill()`, removes session from map, returns `{ ok: true }` or `{ ok: false, error }`
- [x] 1.3 Add `launch.shell` and `launch.kill` types to `src/shared/rpc-types.ts`

## 2. Frontend: Terminal Store

- [x] 2.1 Create `src/mainview/stores/terminal.ts` — state: `sessions: TerminalSession[]`, `activeSessionId: string | null`, `isPanelOpen: boolean`, `panelHeight: number`
- [x] 2.2 Implement `addSession(sessionId, label, cwd)`, `removeSession(sessionId)`, `setActive(sessionId)` actions
- [x] 2.3 Implement `openPanel(sessionId?)`, `closePanel()`, `togglePanel()` actions
- [x] 2.4 Persist `panelHeight` to localStorage; restore on mount

## 3. Frontend: Terminal Panel UI

- [x] 3.1 Create `src/mainview/components/TerminalPanel.vue` — outer container with resize handle at top, `TerminalSessionList` sidebar on the right, `PtyTerminal` render area on the left
- [x] 3.2 Implement resize handle drag with 120px minimum height; emit height changes to terminal store
- [x] 3.3 Create `src/mainview/components/TerminalSessionList.vue` — one entry per session (name, truncated cwd, status dot) + "⊕ New terminal" button at bottom
- [x] 3.4 Wire "⊕ New terminal" button: call `launch.shell({ cwd: workspaceRoot })`, add session to store, set active

## 4. Frontend: Footer Strip & Toggle

- [x] 4.1 Add footer strip bar to `BoardView.vue` between board columns and window bottom
- [x] 4.2 Implement footer strip display: idle state (label + `Ctrl+\`` hint) and active state (green dot + session count + last session name/status)
- [x] 4.3 Wire footer strip click and `Ctrl+\`` keyboard shortcut to `togglePanel()`

## 5. Frontend: Launch Button Integration

- [x] 5.1 Update `LaunchButtons.vue`: when `launch.run` returns `{ ok: true, sessionId }`, call `terminalStore.addSession()` and `terminalStore.openPanel(sessionId)`
- [x] 5.2 Mount `TerminalPanel.vue` in `BoardView.vue`, controlled by `terminalStore.isPanelOpen` and `terminalStore.panelHeight`

## 6. QA & Polish

- [ ] 6.1 Verify scrollback replay: close the panel, reopen — terminal output should be intact
- [ ] 6.2 Verify busy-session flow: run same profile twice on same task — two separate sessions appear in the list
- [ ] 6.3 Verify panel height persistence across panel close/reopen
- [ ] 6.4 Verify `Ctrl+\`` shortcut doesn't fire when the terminal input is focused
- [ ] 6.5 Verify `launch.kill` cleans up session from both store and backend (no orphan pty)

## 1. Dependencies & Build Setup

- [x] 1.1 Remove `electrobun` from `package.json` dependencies; add `node-pty` as a backend dependency
- [x] 1.2 Add `xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links` as frontend dependencies
- [x] 1.3 Delete `electrobun.config.ts`
- [x] 1.4 Delete `src/debug-cli.ts` and `src/debug-inspect.ts`
- [x] 1.5 Delete `build/` and `artifacts/` directories
- [x] 1.6 Update `package.json` scripts: remove `dev`, `dev:debug`, `dev:watch`, `build:canary` (electrobun-specific); add `dev` (concurrently runs `vite build --watch` + `bun src/bun/index.ts`, single Bun port serves everything)

## 2. Backend HTTP + WebSocket Server

- [x] 2.1 Rewrite `src/bun/index.ts`: replace Electrobun bootstrap with `Bun.serve({ hostname: "127.0.0.1", port: PORT ?? 0 })` — defaults to any available OS port; write actual bound port to `/tmp/railyn.port` on startup
- [x] 2.2 Implement HTTP routing in the fetch handler: `POST /api/<method>` dispatches to the appropriate handler from `workspaceHandlers`, `boardHandlers`, `projectHandlers`, `taskHandlers`, `conversationHandlers`, `workflowHandlers`, `launchHandlers`, `lspHandlers`
- [x] 2.3 Implement WebSocket upgrade handling and client set management (`clients: Set<ServerWebSocket>`)
- [x] 2.4 Replace `win.webview.rpc.send["stream.event"]` → broadcast JSON frame `{"type":"stream.event","payload":...}` to all WS clients
- [x] 2.5 Replace `win.webview.rpc.send["task.updated"]` → broadcast `{"type":"task.updated","payload":...}`
- [x] 2.6 Replace `win.webview.rpc.send["message.new"]` → broadcast `{"type":"message.new","payload":...}`
- [x] 2.7 Replace `win.webview.rpc.send["workflow.reloaded"]` → broadcast `{"type":"workflow.reloaded","payload":{}}`
- [x] 2.8 Add static file serving: requests not matching `/api/*` or `/ws` serve files from `dist/`; fall back to `dist/index.html` for SPA routing
- [x] 2.9 Replace Electrobun quit lifecycle (`Electrobun.events.on("before-quit")`) with `process.on("SIGTERM")` / `process.on("SIGINT")` for graceful orchestrator shutdown
- [x] 2.10 Log bound address on startup: `Railyn server listening on http://127.0.0.1:<PORT>`

## 3. Frontend RPC Client Replacement

- [x] 3.1 Rewrite `src/mainview/rpc.ts`: replace `Electroview.defineRPC` with a `fetch`-based `api(method, params)` function and a WebSocket client for push
- [x] 3.2 Implement `api()` function: `POST /api/<method>`, serialize params as JSON, deserialize response, throw on non-2xx
- [x] 3.3 Implement WS client: connect to `/ws`, dispatch incoming frames to registered callbacks, reconnect with exponential backoff on disconnect (1s → 2s → 4s → … max 30s)
- [x] 3.4 Preserve all existing push callback exports: `onStreamToken`, `onStreamError`, `onStreamEventMessage`, `onTaskUpdated`, `onNewMessage`, `onWorkflowReloaded`
- [x] 3.5 Export `api` function (replacing `electroview` export)
- [x] 3.6 Remove `sendDebugLog` function (no longer needed — browser DevTools replaces it)

## 4. Shared Types Cleanup

- [x] 4.1 Remove `import type { RPCSchema } from "electrobun/bun"` from `src/shared/rpc-types.ts`
- [x] 4.2 Inline or remove the `RPCSchema<>` type wrapper from `RailynRPCType` — replace with a plain typed record of `{ params: ..., response: ... }` objects usable by the new `api()` function
- [x] 4.3 Remove `"debug.log"` from both `bun` and `webview` message type entries in `RailynRPCType`

## 5. Frontend Call-Site Migration (`electroview` → `api`)

- [x] 5.1 Update `src/mainview/stores/workspace.ts`: replace `electroview.rpc.request["..."]` with `api("...", params)`
- [x] 5.2 Update `src/mainview/stores/board.ts`: replace all `electroview.rpc.request` calls
- [x] 5.3 Update `src/mainview/stores/task.ts`: replace all `electroview.rpc.request` calls (largest store — ~18 call sites)
- [x] 5.4 Update `src/mainview/stores/project.ts`: replace all `electroview.rpc.request` calls
- [x] 5.5 Update `src/mainview/stores/launch.ts`: replace all `electroview.rpc.request` calls
- [x] 5.6 Update `src/mainview/views/BoardView.vue`: replace `electroview` import and all `.rpc.request` calls
- [x] 5.7 Update `src/mainview/views/SetupView.vue`: replace `electroview` import and all `.rpc.request` calls
- [x] 5.8 Update `src/mainview/components/TaskDetailDrawer.vue`: replace all `electroview.rpc!.request` calls
- [x] 5.9 Update `src/mainview/components/CodeReviewOverlay.vue`: replace all `electroview.rpc!.request` calls
- [x] 5.10 Update `src/mainview/components/ChangedFilesPanel.vue`, `MessageBubble.vue`, `TodoDetailOverlay.vue`, `TodoPanel.vue`, `TaskDetailOverlay.vue`, `LspSetupPrompt.vue`, `WorkflowEditorOverlay.vue`: replace all `electroview.rpc` calls

## 6. Frontend Misc Cleanup

- [x] 6.1 Update `src/mainview/main.ts`: remove `sendDebugLog` import and the three `console.log/warn/error` override lines
- [x] 6.2 Update `src/mainview/router.ts`: replace `createWebHashHistory` with `createWebHistory`
- [x] 6.3 Update `vite.config.ts`: remove Electrobun-specific build copy targets; ensure `build.outDir` is `../../dist` and `build.watch` works correctly for dev mode (no proxy config needed — Bun serves static files directly)

## 7. Terminal Launch: xterm.js + node-pty

- [x] 7.1 Rewrite `src/bun/launch/launcher.ts`: terminal mode uses Bun native PTY spawn via `createPtySession()`; app mode (VS Code, Cursor) retains osascript/spawn for opening external editors
- [x] 7.2 Rewrite `src/bun/launch/terminal.ts`: PTY session management moved to `src/bun/launch/pty.ts` using `Bun.spawn({ terminal })` instead of node-pty
- [x] 7.3 Add `/ws/pty/:id` WebSocket route in `src/bun/index.ts`: bridge PTY stdout → WS frames and WS input frames → PTY stdin; keep PTY session alive when WS disconnects (persist for page reloads); reap session only when the underlying process exits
- [x] 7.4 Update `src/bun/handlers/launch.ts`: `launch.run` spawns a PTY session and returns `{ ok: true, sessionId: string }` instead of launching a native terminal
- [x] 7.5 Create `src/mainview/components/PtyTerminal.vue`: xterm.js component that connects to `/ws/pty/<sessionId>`, renders output, sends keystrokes; reconnects to existing session on remount (session persists on backend); lazy-loaded
- [x] 7.6 Update the launch button / panel in the frontend to open `PtyTerminal.vue` instead of relying on a native window opening

## 8. Verification

- [ ] 8.1 Run `bun test src/bun/test` — all backend unit tests pass
- [ ] 8.2 Run `bun run dev` — Vite + Bun start without errors; browser opens at `http://localhost:5173`
- [ ] 8.3 Verify board loads, tasks can be created, AI execution streams correctly over WebSocket
- [ ] 8.4 Verify task updates (state transitions) arrive as push events without polling
- [ ] 8.5 Verify WS reconnect: kill and restart the Bun server mid-session — frontend reconnects and resumes
- [ ] 8.6 Verify terminal launch opens `PtyTerminal.vue` and accepts input
- [ ] 8.7 Confirm no `electrobun` references remain: `grep -r "electrobun\|electroview\|Electroview\|Electrobun" src/`

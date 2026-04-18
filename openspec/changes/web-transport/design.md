## Context

Railyin's backend is a Bun process and its frontend is a Vue 3 SPA. Currently they communicate via Electrobun's IPC bridge — a binary message-passing system specific to the Electrobun native desktop framework. The frontend is loaded inside a `BrowserView` WebView; the Bun process creates a `BrowserWindow` and registers RPC handlers that the WebView calls. Push events (AI stream tokens, task updates) flow back via `win.webview.rpc.send[...]`.

The goal is to replace this transport with standard HTTP + WebSocket, making Railyin a normal web app that can be opened in any browser. The entire business logic layer (engine, DB, handlers, AI, LSP, git) is clean of Electrobun imports and requires zero changes.

## Goals / Non-Goals

**Goals:**
- Replace Electrobun IPC with HTTP REST + WebSocket transport
- Bun serves the Vue frontend as static files in both dev and production (single port, no proxy)
- Remove all Electrobun-specific code, dependencies, and tooling
- Rename `electroview` → `api` across all call sites (66 references) for naming clarity
- Switch Vue Router from hash history to HTML5 history
- Remove console-override chain (`sendDebugLog`) that forwarded WebView logs to Bun
- Replace native terminal launcher (AppleScript, osascript) with xterm.js + node-pty

**Non-Goals:**
- Multi-user / multi-tenant support (localhost single-user for now)
- Authentication or authorization
- Remote/cloud deployment
- TLS / HTTPS (localhost HTTP is fine)
- PWA / service workers

## Decisions

### Decision 1: HTTP for request/response, WebSocket for push

All ~30 RPC handlers map cleanly to `POST /api/<method>` routes. Push events (stream tokens, task updates, new messages, workflow reload) require server-initiated delivery — WebSocket is the right fit because `stream.event` fires at high frequency (hundreds of AI tokens per second).

**Alternative considered: SSE (Server-Sent Events)**
SSE is unidirectional (server → client) and simpler to set up, but requires a separate mechanism for client → server. The existing RPC model already separates requests (client → server) from messages (server → client), so keeping them separate transports adds no complexity. WebSocket was chosen because:
- Single connection handles both directions (future-proofing for server → client interactive flows)
- Bun has native WebSocket support with no extra dependency
- Reconnection handling is the same complexity

### Decision 2: Bun serves static frontend files

Rather than a separate static file server (nginx, Caddy, etc.), Bun's `Bun.serve` handles static file serving from the `dist/` directory. This keeps the dev and prod setup symmetric — one process, one port.

**Alternative: Separate vite-preview or nginx**
Adds operational complexity. For a localhost app, having a single process simplify deployment (`bun src/bun/index.ts`).

### Decision 3: Replace `electroview.rpc.request[...]` call pattern with `api(method, params)`

The current pattern `electroview.rpc.request["tasks.list"](params)` is verbose and the name "electroview" is meaningless in a web context. Replacing with `api("tasks.list", params)` is cleaner. Since there's no back-compat requirement, all 66 call sites will be updated.

**New API surface in `src/mainview/rpc.ts`:**
```typescript
export function api<M extends keyof RailynAPI>(method: M, params: RailynAPI[M]["params"]): Promise<RailynAPI[M]["response"]>
```

Push callbacks remain the same exported functions (`onStreamToken`, `onTaskUpdated`, etc.) since they are already well-named.

### Decision 4: Single WebSocket connection, broadcast to all connected clients

For localhost single-user use, all connected WS clients receive all push events. A thin `clientId` concept is added to the WS protocol now (as a URL parameter `?clientId=<uuid>`) so future multi-user routing can scope events to the right session without a protocol break.

### Decision 4b: Bun serves static files in both dev and production

There is no Vite dev server in the development workflow. `bun run dev` builds the Vue frontend with Vite (watch mode) and starts the Bun HTTP server on a single port. Bun serves `dist/` as static files. This means dev and prod are identical in topology — one process, one port. The Vite proxy config is therefore not needed.

### Decision 5: xterm.js + node-pty for terminal launch

The `launch.run` RPC handler currently calls AppleScript / osascript / wt.exe to open a native terminal emulator. This is replaced with:
- Backend: `node-pty` spawns a PTY process (shell or command)
- Backend: Streams PTY output over a dedicated WebSocket channel (`/ws/pty/<id>`)
- Frontend: `xterm.js` renders the terminal and sends keystrokes back

This makes the launch feature work cross-platform and in any browser without native OS hooks.

### Decision 6: Port assignment — any available port

The server SHALL use `port: 0` by default so Bun picks any free OS port (no conflicts). The actual bound port is written to stdout on startup and optionally to `/tmp/railyn.port` so scripts can discover it. Can be overridden with `PORT` env var for a fixed port.

## Risks / Trade-offs

- **WebSocket reconnect during streaming** → If the WS drops mid-execution, stream events are lost for the current token window. Mitigation: the frontend detects disconnect and re-fetches persisted stream events from `conversations.getStreamEvents` (already in the API), replaying from the last known `seq`.
- **Port discovery in dev** → With `port: 0`, scripts need to discover the actual port. Mitigation: write port to `/tmp/railyn.port` on startup; `bun run dev` can read it.
- **xterm.js bundle size** → xterm.js + node-pty add ~500KB to the frontend bundle. Mitigation: lazy-load the terminal component only when the launch panel is open.
- **PTY session persistence** → PTY sessions outlive the WebSocket connection (survive page reloads). The backend keeps `Map<string, IPty>` alive for the process lifetime. Risk: zombie PTY processes if the page is abandoned. Mitigation: backend reaps sessions when the underlying process exits naturally; a `launch.killSession` RPC is provided for explicit cleanup.
- **No auth on HTTP** → localhost-only; binding to `127.0.0.1` prevents external access. Document this clearly. Revisit when/if remote deployment is needed.

## Migration Plan

1. Add `node-pty` backend dependency; add `xterm` frontend dependency (lazy)
2. Rewrite `src/bun/index.ts` — Bun HTTP+WS server
3. Rewrite `src/mainview/rpc.ts` — fetch + WS client
4. Update `src/shared/rpc-types.ts` — remove electrobun type dependency
5. Rename `electroview` → `api` across all stores and components
6. Update `src/mainview/main.ts` — remove `sendDebugLog` override
7. Update `src/mainview/router.ts` — `createWebHistory`
8. Update `vite.config.ts` — remove Electrobun-specific settings, set `build.watch` mode for dev
9. Update `package.json` — remove `electrobun`, update scripts (`dev` = vite build --watch + bun server)
10. Delete `electrobun.config.ts`, `src/debug-cli.ts`, `src/debug-inspect.ts`, `build/`, `artifacts/`
11. Rewrite `src/bun/launch/launcher.ts` + `terminal.ts` — node-pty + xterm.js

**Rollback**: The entire change is contained to transport layer files. If needed, revert is a clean git revert of the changed files. No DB migrations, no data format changes.

## Open Questions

- ~~What port should Bun default to?~~ **Decided: `port: 0` (any available OS port)**
- ~~Should `bun run dev` start both Vite and Bun concurrently?~~ **Decided: `bun run dev` = `vite build --watch` + `bun src/bun/index.ts` concurrently; Bun serves static files from `dist/`**
- ~~For xterm.js terminal: should the PTY session persist across page reloads?~~ **Decided: PTY sessions persist** — the backend holds the process alive independent of WS connections.

## Context

Railyin runs a Bun HTTP+WebSocket server (default port 3000) that serves a Vue 3 SPA. Each task has an isolated git worktree (`task.worktreePath`). The app already has a PTY terminal (bottom panel) and a task chat drawer (right side, `position: fixed`, PrimeVue `<Drawer :modal="false">`). Overlays (CodeReview, WorkflowEditor) use `<Teleport to="body">` with `z-index: 1200`. The drawer sits at `z-index: ~1000`. The frontend communicates with the backend via REST (`/api/<method>`) and a WebSocket push channel (`/ws`).

`code-server` is available as an npm package (v4.116+). It spawns a standalone HTTP server serving VS Code in the browser and supports headless extension installation via `--install-extension`.

## Goals / Non-Goals

**Goals:**
- Per-task code-server instances opening the task's worktree folder
- Full-screen overlay behind the chat drawer so editor and chat are visible simultaneously
- Structured code references (file + L:C range + text) inserted into chat from VS Code
- Fully bundled — `npx --yes code-server` on first use, no manual setup
- Single custom VS Code extension (`railyin-ref`) auto-installed on spawn

**Non-Goals:**
- Multi-user collaboration in the editor
- Persisting VS Code settings/extensions across app reinstalls
- Supporting Windows (initial implementation targets macOS/Linux)
- Exposing code-server to the network (always `--auth=none`, bound to `127.0.0.1`)

## Decisions

### D1: Per-task isolated code-server process
Each task gets its own code-server process pointing at `task.worktreePath`. Started lazily on first open, kept warm (not killed) when overlay closes, killed on app exit or explicit stop.

**Rationale**: Tasks have isolated worktrees — opening the wrong folder would confuse the AI context. Warm-on-close avoids 1–2s startup delay on reopen.

**Alternative considered**: Single shared instance. Rejected — requires manual folder navigation, doesn't match the worktree-isolation model.

### D2: Port assignment via in-memory registry
Backend maintains `Map<taskId, { pid, port, status }>`. Ports assigned sequentially from a base (e.g., 3100), checking availability with a quick TCP bind test.

**Rationale**: Simple, no DB needed, ports are ephemeral and don't survive restart anyway.

### D3: z-index 800 for CodeServerOverlay
The overlay uses `z-index: 800` — below the PrimeVue drawer (`~1000`) and existing overlays (`1200`). This means the chat drawer naturally floats over the editor.

**Rationale**: Zero layout work needed. The drawer is `position: fixed; right: 0` with no background, so the editor shows through on the left. No resize handles, split panes, or layout refactoring required.

### D4: VS Code extension communicates via HTTP back-channel
The `railyin-ref` extension runs in code-server's Node.js extension host. When the user selects code and runs "Send to Railyin" (`Ctrl+Shift+R`), the extension POSTs to `http://localhost:${RAILYIN_API_PORT}/api/codeServer.sendRef`. The backend identifies the task by `RAILYIN_TASK_ID` (injected as env var on spawn) and broadcasts a `code.ref` WS push message.

**Rationale**: VS Code extensions run in Node.js (not the browser iframe), so `window.postMessage` doesn't work cross-origin. HTTP back-channel is simple and reliable.

**Alternative considered**: `postMessage` from iframe. Rejected — extension host ≠ browser window.

### D5: CodeRef stored as structured object, serialized for AI
In the chat input, a `CodeRef` is a typed object: `{ file, startLine, startChar, endLine, endChar, text, language }`. It renders as a chip (`📎 src/auth.ts L42–58`). On send, it's serialized as:
````
```typescript
// ref: src/auth.ts L42:5–L58:12
<selected text>
```
````
This is appended to the message content string before sending to the AI.

**Rationale**: The AI understands fenced code blocks with comments natively. No schema changes to `ConversationMessage` needed — the reference becomes part of the text content.

### D6: Extension bundled as `.vsix`, auto-installed on spawn
The `railyin-ref` extension is built with `vsce package` and committed as `extensions/railyin-ref/railyin-ref.vsix`. On each `codeServer.start`, code-server is called with `--install-extension <path-to-vsix>`. Installation is idempotent.

**Rationale**: No user setup required; extension is always in sync with the app version.

### D7: npx-based install, cached in ~/.railyin/code-server-cache
On first `codeServer.start`, the backend checks if code-server binary exists in cache dir. If not, runs `npx --yes code-server --version` to trigger install, then symlinks/copies binary path. Subsequent starts use cached binary directly.

**Rationale**: Avoids adding ~500MB to the repo/package.json while still requiring zero user setup.

## Risks / Trade-offs

- **[Risk] First-launch delay**: `npx --yes code-server` can take 30–60s on slow connections. → Mitigation: Show a progress indicator in the overlay with status text ("Installing code-server…", "Starting…", "Ready").
- **[Risk] Port conflicts**: Assigned port may be in use by another process. → Mitigation: TCP availability check before assignment; retry up to 10 ports.
- **[Risk] Zombie processes**: code-server processes not killed on crash. → Mitigation: Track PIDs; kill all on `process.on('exit')` and `SIGTERM`/`SIGINT` in Bun index.
- **[Risk] Extension install fails silently**: `--install-extension` can fail if vsix is corrupt. → Mitigation: Log stderr from code-server spawn; surface error in overlay UI.
- **[Risk] iframe sandbox restrictions**: Some browsers block `allow-same-origin` + `allow-scripts` combos. → Mitigation: Use `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` on the iframe; test on Chrome/Safari/Firefox.
- **[Trade-off] Warm process memory**: Keeping code-server warm uses ~200MB RAM per open task. → Acceptable for the use case; users can manually stop via a "Stop" button in the overlay header.

## Migration Plan

No database migrations. No breaking changes to existing RPC. New RPC methods are additive. The `</>` button only appears when `task.worktreePath` is set (same guard as the terminal button).

Deploy: ship as a normal app update. No rollback complexity — if code-server fails to start, the overlay shows an error and the rest of the app is unaffected.

## Open Questions

- Should code-server processes persist across app restarts (re-attach by checking if port is still alive)? → Start simple: always fresh-spawn on restart.
- Should the "Send to Railyin" command appear in the VS Code context menu (right-click) in addition to the command palette? → Yes, add `editor/context` menu contribution in extension `package.json`.

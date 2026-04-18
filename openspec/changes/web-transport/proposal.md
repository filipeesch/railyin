## Why

Railyin is currently built on top of Electrobun, a native desktop app framework for Bun. This couples the entire application to a desktop-only runtime, limits distribution to compiled `.app` bundles, and prevents running Railyin as a headless server or in any environment without a display. Moving to a standard web app architecture (HTTP + WebSocket backend served by Bun, Vue frontend in any browser) removes this constraint while keeping the entire existing business logic untouched.

## What Changes

- **BREAKING**: Remove Electrobun entirely — no `electrobun` dependency, no `electrobun.config.ts`, no compiled `.app` builds
- **BREAKING**: Replace Electrobun IPC bridge with HTTP REST API + WebSocket push channel (same logical API surface, different transport)
- **BREAKING**: Replace `Electroview.defineRPC` frontend adapter with a `fetch` + WebSocket client
- Remove `RPCSchema` import from `electrobun/bun` in `rpc-types.ts`; simplify type definitions
- Replace `createWebHashHistory` with `createWebHistory` in Vue Router (hash routing was a WebView workaround)
- Remove console override chain that forwarded WebView logs to Bun stdout (`sendDebugLog`) — browser DevTools makes this redundant
- Remove Electrobun-specific dev tooling: `src/debug-cli.ts`, `src/debug-inspect.ts`
- Rename `electroview` export → `api` across all call sites (66 references) for clarity
- Delete `build/` and `artifacts/` directories (Electrobun compiled outputs)
- Bun serves the built Vue frontend as static files (no separate static server needed)
- Add Vite dev proxy so `/api/*` and `/ws` forward to the Bun backend during development

## Capabilities

### New Capabilities
- `web-server`: HTTP + WebSocket server replacing Electrobun bootstrap; serves API routes, push events, and static frontend files
- `web-rpc-client`: Browser-side fetch + WebSocket adapter replacing `Electroview.defineRPC`

### Modified Capabilities
- `launch-external-process`: Native terminal launch (AppleScript/osascript/wt.exe) is replaced with a web-compatible approach using xterm.js + node-pty; the UI and workflow remain the same
- `workspace`: No spec-level requirement changes; implementation transport changes only

## Impact

- `src/bun/index.ts` — full rewrite (Electrobun bootstrap → `Bun.serve`)
- `src/mainview/rpc.ts` — full rewrite (Electroview → fetch + WS)
- `src/shared/rpc-types.ts` — remove `electrobun/bun` import, simplify type wrapper
- `src/mainview/main.ts` — remove `sendDebugLog` console override
- `src/mainview/router.ts` — switch to `createWebHistory`
- `vite.config.ts` — add dev proxy config
- `package.json` — remove `electrobun` dep, update scripts
- `electrobun.config.ts` — deleted
- `src/debug-cli.ts`, `src/debug-inspect.ts` — deleted
- `build/`, `artifacts/` — deleted
- All `electroview.rpc.request[...]` call sites → `api(...)` (stores + components)
- `src/bun/handlers/`, `src/bun/engine/`, `src/bun/db/`, `src/bun/ai/`, `src/bun/lsp/`, `src/bun/git/` — **untouched**
- All Vue components and views — **untouched** except `electroview` import rename

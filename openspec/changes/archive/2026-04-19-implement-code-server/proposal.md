## Why

Railyin users need to view and edit code while chatting with AI agents — switching between an external editor and the chat drawer breaks context flow. Embedding code-server (VS Code in the browser) directly into the app, with the ability to send structured code references into the chat, closes this gap.

## What Changes

- Add a `</>` button to the TaskDetailDrawer toolbar (next to the terminal button) that opens code-server for the active task's worktree
- Introduce a new full-screen `CodeServerOverlay` component that renders code-server in an `<iframe>` at a z-index below the chat drawer (so both are visible simultaneously)
- Add a bundled Railyin VS Code extension (`railyin-ref`) that adds a "Send to Railyin" command — when triggered, it POSTs a structured code reference (file path + L:C selection + text) back to the Railyin API
- Add backend handlers to spawn/stop per-task code-server processes (`npx --yes code-server`), manage a port registry, and broadcast `code.ref` push events over WebSocket
- Add structured `CodeRef` blocks to the chat input: a visual chip showing file + line range, serialized as a fenced code block with `// ref:` header when sent to the AI
- Extend `PushMessage` and `RailynAPI` types with new `code.ref` event and `codeServer.*` RPC methods

## Capabilities

### New Capabilities

- `code-server-integration`: Lifecycle management of per-task code-server processes (spawn, port registry, warm-on-close, kill-on-exit) via `npx --yes code-server`; includes the `railyin-ref` VS Code extension for sending code references back to the app
- `code-reference-in-chat`: Structured code references inserted into the chat input — visual chip with file path and L:C range, serialized as fenced code block with `// ref:` comment header for AI consumption

### Modified Capabilities

- `chat-drawer-tabs`: New `</>` (code-server) button added to the toolbar actions cluster, next to the existing terminal button; only shown when `task.worktreePath` is set

## Impact

- **New files**: `src/mainview/components/CodeServerOverlay.vue`, `src/mainview/stores/codeServer.ts`, `src/bun/handlers/code-server.ts`, `src/bun/launch/code-server.ts`, `extensions/railyin-ref/` (VS Code extension source + `.vsix` artifact)
- **Modified files**: `src/shared/rpc-types.ts`, `src/mainview/components/TaskDetailDrawer.vue`, `src/mainview/views/BoardView.vue`, `src/mainview/rpc.ts`, `src/bun/index.ts` (register new handlers)
- **New dependency**: `code-server` fetched via `npx --yes` on first use, cached in `~/.railyin/code-server-cache`; no addition to `package.json`
- **Build step**: VS Code extension must be compiled and bundled as `railyin-ref.vsix`; add a build script in `package.json`

## 1. VS Code Extension (railyin-ref)

- [x] 1.1 Scaffold extension: create `extensions/railyin-ref/` with `package.json` (contributes `railyin.sendRef` command to command palette and editor context menu), `tsconfig.json`, and `src/extension.ts`
- [x] 1.2 Implement `extension.ts`: on `railyin.sendRef`, read active editor selection (file path, startLine, startChar, endLine, endChar, text, languageId) and POST to `http://localhost:${process.env.RAILYIN_API_PORT}/api/codeServer.sendRef` with `taskId` from `process.env.RAILYIN_TASK_ID`
- [x] 1.3 Add build script: `"build:ext": "cd extensions/railyin-ref && npm install && npx vsce package --no-dependencies -o railyin-ref.vsix"` in root `package.json`; run it and commit the resulting `railyin-ref.vsix`

## 2. Backend — Types & RPC

- [x] 2.1 Add `CodeRef` interface to `src/shared/rpc-types.ts`: `{ taskId: number; file: string; startLine: number; startChar: number; endLine: number; endChar: number; text: string; language: string }`
- [x] 2.2 Add `PushMessage` variant `{ type: "code.ref"; payload: CodeRef }` to `src/shared/rpc-types.ts`
- [x] 2.3 Add RPC method signatures to `RailynAPI` in `src/shared/rpc-types.ts`: `codeServer.start`, `codeServer.status`, `codeServer.stop`, `codeServer.sendRef`

## 3. Backend — Process Lifecycle

- [x] 3.1 Create `src/bun/launch/code-server.ts`: in-memory registry `Map<taskId, { pid, port, status }>`, port availability checker (TCP bind test from base port 3100), `startCodeServer(taskId, worktreePath)` that resolves binary via `npx --yes`, spawns process with `--port`, `--folder`, `--auth=none`, `--install-extension railyin-ref.vsix`, env vars `RAILYIN_TASK_ID` and `RAILYIN_API_PORT`, polls HTTP until ready
- [x] 3.2 Add `stopCodeServer(taskId)` and `stopAllCodeServers()` to `src/bun/launch/code-server.ts`; register `stopAllCodeServers()` on `process.on('exit')`, `SIGTERM`, and `SIGINT` in `src/bun/index.ts`

## 4. Backend — Handlers

- [x] 4.1 Create `src/bun/handlers/code-server.ts` with handlers: `codeServer.start` (calls `startCodeServer`, returns `{ port }`), `codeServer.status` (returns current registry entry), `codeServer.stop` (calls `stopCodeServer`), `codeServer.sendRef` (validates taskId, broadcasts `code.ref` WS push to all connected clients)
- [x] 4.2 Register the new handlers in `src/bun/index.ts` `allHandlers` map

## 5. Frontend — Store

- [x] 5.1 Create `src/mainview/stores/codeServer.ts`: Pinia store with `instanceMap: Map<taskId, { port, status }>`, `pendingRefs: Map<taskId, CodeRef[]>`, actions `openEditor(taskId)`, `closeEditor()`, `stopEditor(taskId)`, `addRef(ref)`, `removeRef(taskId, index)`, `serializeRefs(taskId)` (returns fenced code block strings)

## 6. Frontend — WS Push Handler

- [x] 6.1 Add `code.ref` case to the `switch` in `src/mainview/rpc.ts` `ws.onmessage` handler; call `codeServerStore.addRef(payload)` and add `{ type: "code.ref"; payload: CodeRef }` to `PushMessage` switch

## 7. Frontend — CodeServerOverlay Component

- [x] 7.1 Create `src/mainview/components/CodeServerOverlay.vue`: `<Teleport to="body">` with `position: fixed; inset: 0; z-index: 800`; shows loading spinner with status text while `status !== 'ready'`; renders `<iframe :src="'http://localhost:' + port" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />` when ready; header bar with task title, Stop button, and Close (×) button
- [x] 7.2 Mount `<CodeServerOverlay />` in `src/mainview/views/BoardView.vue` (alongside existing overlays)

## 8. Frontend — Drawer Button & CodeRef Chips

- [x] 8.1 Add `</>` button to the toolbar actions cluster in `src/mainview/components/TaskDetailDrawer.vue`, guarded by `task.worktreePath`, positioned after the terminal button; clicking calls `codeServerStore.openEditor(task.id)`
- [x] 8.2 Render `CodeRef` chips in the chat input area of `TaskDetailDrawer.vue`: display pending refs from `codeServerStore.pendingRefs.get(task.id)` as dismissable chips (`📎 <filename> L<start>–L<end>`); wire dismiss button to `codeServerStore.removeRef`
- [x] 8.3 Modify `send()` in `TaskDetailDrawer.vue` to prepend serialized CodeRef fenced blocks (from `codeServerStore.serializeRefs(task.id)`) to `inputText` before calling `taskStore.sendMessage`, then clear pending refs for the task

## 9. Write and run e2e tests for code-server integration

- [x] 9.1 Write and run e2e tests for code-server integration

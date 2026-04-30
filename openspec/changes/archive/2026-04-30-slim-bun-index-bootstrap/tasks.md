## 1. Create server/ directory and file-logger module

- [ ] 1.1 Create `src/bun/server/` directory
- [ ] 1.2 Create `src/bun/server/file-logger.ts` — extract `setupFileLogging()` from the inline IIFE block in `index.ts` (lines 24-45); function accepts optional `logDir?: string` (defaults to `~/.railyn/logs`); returns `{ restore(): void }` that restores original `console.log/warn/error`; export the function

## 2. Create broadcast-channel module

- [ ] 2.1 Create `src/bun/server/broadcast-channel.ts` — export `IBroadcastChannel` interface (`broadcast(msg: object): void`) and `BroadcastChannel` class implementing it, owning the `clients: Set<ServerWebSocket<WsData>>` and the send loop with silent error handling

## 3. Create notifications module

- [ ] 3.1 Create `src/bun/server/notifications.ts` — export `NotificationService` class; constructor accepts `IBroadcastChannel`; methods: `onError`, `notifyTaskUpdated`, `notifyNewMessage`, `notifyWorkflowReloaded`, `notifyChatSessionUpdated`, `broadcastConfigError`

## 4. Create stream-processor module

- [ ] 4.1 Create `src/bun/server/stream-processor.ts` — export `StreamEventProcessor` class; constructor accepts `IBroadcastChannel` and `Database`; encapsulates `enrichers` Map, `WriteBuffer`, and `PERSISTED_STREAM_TYPES` set; methods: `start()`, `onStreamEvent()`, `onRawMessageEnqueued()`, `setMarkClaudeExecution(fn)`
- [ ] 4.2 Ensure `onRawMessageEnqueued` uses the late-bound `markClaudeExecution` fn (defaults to no-op until `setMarkClaudeExecution` is called)

## 5. Create websocket module

- [ ] 5.1 Create `src/bun/server/websocket.ts` — export `WebSocketHandler` class; constructor accepts `(channel: IBroadcastChannel, getPtySession: (id: string) => PtySession | undefined)`; encapsulates `ptyDataListeners` and `ptyExitListeners` WeakMaps; implements `open(ws)`, `close(ws)`, `message(ws, msg)` compatible with `Bun.serve({ websocket: ... })`

## 6. Create shutdown module

- [ ] 6.1 Create `src/bun/server/shutdown.ts` — export `createShutdownHandler(orchestrator: Orchestrator | null, opts?: { graceMs?: number; killAllPtySessions?: () => void; stopAllCodeServers?: () => void; exitFn?: (code: number) => never })` returning `{ shutdown(): Promise<void> }`; idempotent guard; calls `orchestrator?.shutdownNonNativeEngines()`, then `killAllPtySessions()` and `stopAllCodeServers()` (opts override allow injection for tests), then `exitFn(0)` (defaults to `process.exit`)

## 7. Slim index.ts

- [ ] 7.1 Replace the inline file-logging IIFE block with `import { setupFileLogging } from './server/file-logger.ts'` and a `setupFileLogging()` call as the first line
- [ ] 7.2 Replace the inline `clients`, `broadcast`, and all notify functions with imports from the new modules; wire `channel`, `notifier`, `streamProc` using constructor DI
- [ ] 7.3 Replace the inline PTY WeakMaps and WS handler object with `new WebSocketHandler(channel, getPtySession)`; pass `wsHandler` to `Bun.serve({ websocket: wsHandler })`
- [ ] 7.4 Replace the inline `shutdown` function and signal handlers with `createShutdownHandler(orchestrator)` from `shutdown.ts`
- [ ] 7.5 After constructing `Orchestrator`, call `streamProc.setMarkClaudeExecution(id => orchestrator.markClaudeExecution(id))` to resolve the circular dependency
- [ ] 7.6 Update `codeServerHandlers(db, channel.broadcast.bind(channel), serverPort)` at the handler wiring site
- [ ] 7.7 Replace the inline MCP config loading block with a named helper function `loadMcpConfig(db)` (can remain in `index.ts` or extracted inline — keeps the bootstrap readable)
- [ ] 7.8 Replace the inline stuck-task reset block with a named helper function `resetStuckTasks(db)` (same approach as 7.7)

## 8. Delete dead code

- [ ] 8.1 Delete the entire `if (process.env.RAILYN_DEBUG) { ... }` block (650 lines) from `index.ts`; replace with the minimal 10-line debug server retaining only `/shutdown` and `DEBUG_PORT=` stdout
- [ ] 8.2 Delete `src/test-review-overlay.ts` (legacy WebView script; references removed endpoints `/inspect`, `/click`, `/screenshot`)

## 9. Verify

- [ ] 9.1 Run TypeScript check: `bunx tsc --noEmit` — no new errors
- [ ] 9.2 Run backend test suite: `bun test src/bun/test --timeout 20000` — all previously passing tests still pass
- [ ] 9.3 Run API smoke tests: `bun test e2e/api --timeout 30000` — all previously passing tests still pass (validates `/shutdown` endpoint and debug server startup)

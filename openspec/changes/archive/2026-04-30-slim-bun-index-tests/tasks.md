## 1. Scaffold test directory

- [ ] 1.1 Create `src/bun/test/server/` directory

## 2. BroadcastChannel unit tests

- [ ] 2.1 Create `src/bun/test/server/broadcast-channel.test.ts` — implement BC-1, BC-2, BC-3; use a minimal `{ send(msg: string): void }` stub (no Bun WS import); define `MockBroadcastChannel` locally; no DB, no timers

## 3. NotificationService unit tests

- [ ] 3.1 Create `src/bun/test/server/notifications.test.ts` — implement NS-1 through NS-6; define a local `MockBroadcastChannel` with `calls: object[]`; each test: instantiate `new NotificationService(mock)`, call one method, assert `mock.calls[0]` shape matches the expected `{ type, payload }` structure

## 4. StreamEventProcessor unit tests

- [ ] 4.1 Create `src/bun/test/server/stream-processor.test.ts` — implement SP-1 through SP-10; use `initDb()` from `helpers.ts` for the DB seam; use a local `MockBroadcastChannel`; use `createMockWait()` from `support/mock-wait.ts` to control WriteBuffer flush timing in SP-2; use `beforeEach`/`afterEach` with `setupTestConfig()` cleanup

## 5. WebSocketHandler unit tests

- [ ] 5.1 Create `src/bun/test/server/websocket.test.ts` — implement WS-1 through WS-9; define a `fakePtySession(opts?: Partial<PtySession>)` factory returning plain objects with `dataListeners: new Set()`, `exitListeners: new Set()`, `scrollback: ""`, `exited: false`, `terminal: { write: mock fn, resize: mock fn }`; inject via `(id) => sessions.get(id)` stub; use a local `MockBroadcastChannel` that also tracks its `clients` Set

## 6. createShutdownHandler unit tests

- [ ] 6.1 Create `src/bun/test/server/shutdown.test.ts` — implement SD-1 through SD-4; for each test instantiate `createShutdownHandler(orchestrator, { killAllPtySessions: vi.fn(), stopAllCodeServers: vi.fn(), exitFn: () => { throw new Error("exit called"); } })`; use a mock orchestrator with `shutdownNonNativeEngines: vi.fn().mockResolvedValue(undefined)`; SD-1 calls shutdown() twice and asserts killAllPtySessions called exactly once

## 7. setupFileLogging unit tests

- [ ] 7.1 Create `src/bun/test/server/file-logger.test.ts` — implement FL-1 through FL-4; use `makeTempDir()` from `helpers.ts` in `beforeEach`; call `const { restore } = setupFileLogging(dir)` in each test; call `restore()` in `afterEach`; use `readFileSync` to assert log file contents; FL-2 seeds an existing `bun.log` before calling `setupFileLogging` and asserts `bun.log.prev` exists afterward

## 8. Verify

- [ ] 8.1 Run the new test suite: `bun test src/bun/test/server --timeout 20000` — all 36 tests pass
- [ ] 8.2 Run the full backend suite: `bun test src/bun/test --timeout 20000` — no regressions
- [ ] 8.3 Run TypeScript check: `bunx tsc --noEmit` — no new errors

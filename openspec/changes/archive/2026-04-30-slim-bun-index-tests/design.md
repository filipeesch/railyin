## Context

The `slim-bun-index-bootstrap` change extracts five server modules (`BroadcastChannel`, `NotificationService`, `StreamEventProcessor`, `WebSocketHandler`, `createShutdownHandler`) and a file-logger utility (`setupFileLogging`) into `src/bun/server/`. Each uses constructor-based dependency injection, making them testable in isolation for the first time.

This change delivers the test suite for those modules. All tests live in `src/bun/test/server/` and rely on the existing test infrastructure in `src/bun/test/helpers.ts` and `src/bun/test/support/`.

## Goals / Non-Goals

**Goals:**
- Cover every public method on every new module with at least one test
- Use DI mocks (not alternative code paths or process-level stubs) for all dependencies
- Keep tests fast: no real PTY processes, no real network sockets, no real timers
- Verify error-tolerance paths (broadcast swallows disconnected-client errors, shutdown is idempotent, setupFileLogging rotates logs)
- Reuse existing test helpers (`initDb`, `makeTempDir`, `createMockWait`) — no new shared infra

**Non-Goals:**
- Integration tests that start a real Bun server (already covered by `e2e/api/smoke.test.ts`)
- Playwright / browser-level tests (no UI surface)
- Mutation testing (separate pipeline)
- Testing `index.ts` bootstrap ordering directly

## Decisions

### TD1 — Mock IBroadcastChannel as a recording stub

**Decision:** Define a `MockBroadcastChannel` in each test file (or a shared support file) that records every `broadcast(msg)` call in a `calls: object[]` array.

**Rationale:** All six modules depend on `IBroadcastChannel`. A single lightweight implementation — `{ calls: object[]; broadcast(msg) { this.calls.push(msg); } }` — suffices for every test. No framework mocking needed.

### TD2 — Fake WS stub for BroadcastChannel tests (not Bun's ServerWebSocket)

**Decision:** Unit tests for `BroadcastChannel` inject plain `{ send(msg: string): void }` objects that optionally throw, not real Bun WebSocket instances.

**Rationale:** The only behaviour we test is: (a) JSON serialisation, (b) send-to-all, (c) silent error swallowing. None of these require a real WS. Using a typed minimal stub avoids importing Bun internals into the test.

### TD3 — Fake PtySession for WebSocketHandler tests

**Decision:** Tests create plain objects that satisfy the `PtySession` interface (`dataListeners: Set`, `exitListeners: Set`, `scrollback: string`, `exited: boolean`, `terminal: { write: mock, resize: mock }`). These are passed through the injected `getPtySession` stub.

**Rationale:** DI is the stated preference; injecting `getPtySession` as a constructor arg means tests never touch the real `pty.ts` sessions Map. Fake sessions are cheap to construct and support all test scenarios including 'unknown session' and 'already exited'.

### TD4 — `setupFileLogging` tested via `restore()` + `makeTempDir()`

**Decision:** Each `file-logger.test.ts` test calls `setupFileLogging(dir)`, captures the returned `restore` function, and calls it in `afterEach`. Uses `makeTempDir()` from `helpers.ts` for the log directory.

**Rationale:** `restore()` undoes the console patches between tests, keeping them independent. `makeTempDir()` is the established pattern for FS-touching tests (used by `worktree.test.ts` and others).

### TD5 — `createShutdownHandler` opts for injecting cleanup fns

**Decision:** Tests pass `opts.killAllPtySessions` and `opts.stopAllCodeServers` as `vi.fn()` spies, and `opts.exitFn` as a no-op to prevent `process.exit()` from terminating the test runner.

**Rationale:** The production defaults (`import { killAllPtySessions } from './launch/pty.ts'`) cannot be called in tests. Injecting them via `opts` is the clean DI path established in the architecture.

### TD6 — WriteBuffer flush control via `createMockWait`

**Decision:** `StreamEventProcessor` tests use `createMockWait()` (already in `src/bun/test/support/mock-wait.ts`) when they need to observe the WriteBuffer flush boundary. Tests that only verify broadcast behaviour don't need timer control.

**Rationale:** `createMockWait` is the established pattern for all WriteBuffer-adjacent tests (`write-buffer.test.ts`, `stream-processor.test.ts`). Reusing it keeps the test surface consistent.

## Risks / Trade-offs

- **[Risk] Tests pass before `slim-bun-index-bootstrap` is applied** — The test files import from `src/bun/server/` which won't exist yet. Mitigation: these tests are expected to be authored and run after the bootstrap change is applied; CI order is controlled by the tasks dependency.
- **[Risk] MockBroadcastChannel diverges across test files** — If the interface changes, every local mock needs updating. Mitigation: the interface is a single-method contract (`broadcast(msg: object): void`); changes are trivial to propagate.

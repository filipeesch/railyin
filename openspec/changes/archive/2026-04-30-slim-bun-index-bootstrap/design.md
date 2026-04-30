## Context

`src/bun/index.ts` is the application entry point and currently 1189 lines. It was never refactored as features accreted; each new concern was added inline. The result is four unrelated responsibilities in one file:

1. **File logging** — patches `console.*` to tee output to a rotating log file
2. **Notification pipeline** — WebSocket client registry, broadcast primitive, domain push events, stream enrichment and persistence
3. **WebSocket/PTY handling** — push channel and PTY terminal session lifecycle
4. **Bootstrap** — shell env, DB migrations, config, MCP init, engine/orchestrator wiring, graceful shutdown

Additionally, a ~650-line debug server block was added during WebView-era development. All test endpoints in it are unreferenced after the migration to the Playwright/web-app architecture; only `/shutdown` is live.

The codebase already uses constructor-based dependency injection throughout (all handlers accept `db`, engines accept typed callbacks). This refactor extends that pattern to the server layer.

## Goals / Non-Goals

**Goals:**
- Extract each concern into a focused module under `src/bun/server/`
- Reduce `index.ts` to a ~80-line linear composition root
- Eliminate the circular dependency between `StreamEventProcessor` and `Orchestrator` via an explicit late-bind setter
- Delete the dead debug-server endpoints and `src/test-review-overlay.ts`
- Fix the `listProjects` missing import (deleted along with the dead endpoint)
- Use `IBroadcastChannel` as the DI seam between the broadcast primitive and its consumers

**Non-Goals:**
- Logic changes of any kind
- New tests (covered by a separate `slim-bun-index-tests` change)
- Changes to public API, RPC types, frontend, or DB schema
- Changing `codeServerHandlers` signature (passes `channel.broadcast.bind(channel)` instead)

## Decisions

### D1 — Three notification files, not one

**Decision:** Split into `broadcast-channel.ts`, `notifications.ts`, `stream-processor.ts` rather than a single `notifications.ts`.

**Rationale:** Each file has a single reason to change:
- `broadcast-channel.ts` changes if the WS client management primitive changes
- `notifications.ts` changes if domain push event shapes change (new RPC event type)
- `stream-processor.ts` changes if stream enrichment, sequencing, or persistence strategy changes

A single file would mix three distinct change axes.

**Alternative considered:** One `notifications.ts` with all three classes — rejected because SRP applies at the file level too; three classes in one file still creates a "read the whole file" maintenance burden.

### D2 — `IBroadcastChannel` interface as DI seam

**Decision:** Define `interface IBroadcastChannel { broadcast(msg: object): void }` in `broadcast-channel.ts`. All consumers (`NotificationService`, `StreamEventProcessor`, `WebSocketHandler`) depend on the interface, not the concrete class.

**Rationale:** Follows the Dependency Inversion Principle. Makes each consumer independently testable with a mock. `codeServerHandlers` already accepts `(msg: object) => void` — it stays unchanged, receiving `channel.broadcast.bind(channel)`.

**Alternative considered:** Export `broadcast` as a module-level function from a module global — rejected because it makes state implicit and prevents isolated testing.

### D3 — Late-bind setter to break circular dependency

**Decision:** `StreamEventProcessor` exposes `setMarkClaudeExecution(fn: (id: number) => void)`. Called in `index.ts` after the `Orchestrator` is constructed.

**Rationale:** `onRawMessageEnqueued` is passed as a constructor callback to `Orchestrator`, but it also needs to call `orchestrator.markClaudeExecution()`. The current code works via optional chaining on a closure that captures a `null` at definition time — a hidden temporal coupling. The setter makes this dependency explicit and resolvable at the composition root.

```
streamProc = new StreamEventProcessor(channel, db)          // 1
orchestrator = new Orchestrator(..., streamProc.onRawMessageEnqueued)  // 2
streamProc.setMarkClaudeExecution(id => orchestrator.markClaudeExecution(id)) // 3
```

**Alternative considered:** Pass `Orchestrator` to `StreamEventProcessor` — rejected because it would create a bidirectional dependency between two high-level modules.

### D4 — `WebSocketHandler` as a class with injected `getPtySession`

**Decision:** `WebSocketHandler` is a class with `open`, `close`, `message` methods and encapsulates the two `WeakMap`s. Its constructor accepts `(channel: IBroadcastChannel, getPtySession: (id: string) => PtySession | undefined)`.

**Rationale:** The WeakMaps are internal state that no external code should access. A class enforces this boundary. The instance is passed directly to `Bun.serve({ websocket: wsHandler })` — Bun expects an object with these methods. Injecting `getPtySession` as a constructor argument (rather than importing it directly) preserves the DI pattern and makes the class unit-testable with a fake session map without spawning real PTY processes.

In `index.ts`: `new WebSocketHandler(channel, getPtySession)` where `getPtySession` is imported from `./launch/pty.ts`.

### D5 — Minimal debug server (keep only `/shutdown`)

**Decision:** Delete all ~650 lines of test-env debug endpoints. Retain only `/shutdown` and the `DEBUG_PORT=` stdout line as an 8-line inline block in `index.ts`.

**Rationale:** Grep confirmed zero references to any endpoint other than `/shutdown` in `e2e/`, `src/bun/test/`, or any spec file. These endpoints were added during WebView-era development and were never wired to current Playwright-based tests. Keeping them imposes ongoing maintenance cost for zero test coverage value.

## Risks / Trade-offs

- **[Risk] Some endpoint was used and not found by grep** → Mitigation: The test suite (`bun test src/bun/test`, `bun test e2e/api`) is run as part of the change. Any breakage surfaces immediately.
- **[Risk] `Bun.serve` websocket handler shape mismatch** → Mitigation: TypeScript ensures `WebSocketHandler` satisfies the expected interface at compile time. No runtime surprises.
- **[Risk] `streamProc.setMarkClaudeExecution` called before Orchestrator is live** → Mitigation: `index.ts` wiring order is linear; setter is called on line immediately after Orchestrator construction.

## Migration Plan

1. Create `src/bun/server/` directory and all six new modules
2. Slim `index.ts`: remove each extracted section, import from new modules
3. Delete dead debug-server endpoints (keep `/shutdown` block inline)
4. Delete `src/test-review-overlay.ts`
5. Run `bun test src/bun/test --timeout 20000` and `bun test e2e/api --timeout 30000`
6. TypeScript check: `bunx tsc --noEmit`

No rollback plan needed — pure refactor, no data migration, no API changes.

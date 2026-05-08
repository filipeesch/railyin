## Context

The `pi-engine-local-llm-harness` change introduces several novel, Pi-specific components that require dedicated tests. The existing Copilot and Claude engines have established testing patterns: `MockCopilotSdkAdapter` / `MockClaudeSdkAdapter` for scripted SDK sessions, `BackendRpcRuntime` for in-memory DB integration, and `shared-rpc-scenarios.ts` for cross-engine reuse.

Pi brings new behavioral contracts not covered elsewhere:
- `ContentHashCache`: file hash deduplication with compaction resets, search result caching, glob-based invalidation via picomatch
- `UndoStack`: peel-by-path chained undo, 50-entry FIFO eviction, pre-patch snapshot storage
- Native harness tools: `glob` (unified file/dir finder), `read_file` with range keys, `search_text` with `context_lines`, `run_command` with worktree confinement
- `EventTranslator`: maps Pi SDK events to Railyin `EngineEvent` stream, including compaction side-effects on `HarnessContext`
- `PiSessionManager`: conversationId → AgentSession lifecycle with file-based JSONL

All of these are testable without real Pi inference if we expose a `PiSdkAdapter` interface (injectable mock), exactly as `CopilotSdkAdapter` does.

## Goals / Non-Goals

**Goals:**
- Cover all behavioral contracts in `ContentHashCache` and `UndoStack` with pure unit tests (no I/O)
- Cover all Pi harness tools with filesystem integration tests using real tmpdir (real `read`/`write` via Bun fs, no network)
- Cover `PiEngine` end-to-end via `BackendRpcRuntime` + `MockPiSdkAdapter` (scripted turns, no real inference)
- Re-use `shared-rpc-scenarios.ts` scenarios so Pi engine is verified against the same contracts as Claude/Copilot
- Extend Playwright `tool-rendering.spec.ts` with 3 Pi-specific rendering scenarios
- NEVER change production behavior just for testability — only use DI seams already required by the harness design

**Non-Goals:**
- Real LLM inference in any test
- Testing Pi SDK internals (compaction algorithm, JSONL format)
- Performance or load testing
- Mutation testing (covered by existing Stryker setup if thresholds are met)

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| SDK mock pattern | `MockPiSdkAdapter` implementing `PiSdkAdapter` interface, `queueCreate()` / `queueResume()` | Mirrors `MockCopilotSdkAdapter` exactly — consistent codebase pattern |
| Filesystem in tool tests | Real tmpdir (Bun `mkdtemp`) | File tools have trivial I/O; mocking `fs` would be more complex than a real tmpdir |
| Hash cache test isolation | Instantiate `ContentHashCache` directly, call methods | Pure class, no I/O, no DI needed beyond the instance |
| Undo stack test isolation | Instantiate `UndoStack` directly, stub `readFileSync` via real tmpdir files | Stack itself is pure; pre-patch reads happen at call site |
| EventTranslator testability | Inject `HarnessContext` (or mock) into constructor | Required so EV-6 (compaction resets `seenInWindow`) is observable without Pi session |
| Playwright scenarios | Append to existing `tool-rendering.spec.ts` | Follows existing pattern; Pi rendering uses same `mock-api.ts` WebSocket mock |

## Test Layer Architecture

```
Layer 1 — Pure unit (zero I/O, instant)
  pi-hash-cache.test.ts        8 scenarios — ContentHashCache class
  pi-undo-stack.test.ts        7 scenarios — UndoStack class

Layer 2 — Filesystem integration (real tmpdir, no network)
  pi-file-tools.test.ts       13 scenarios — read_file, glob, write_file,
                                              patch_file, delete_file, rename_file
  pi-search-tools.test.ts      5 scenarios — search_text (rg + fallback), glob type filter
  pi-shell-tool.test.ts        4 scenarios — run_command output, truncation, cwd, timeout

Layer 3 — Engine integration (mock Pi SDK + in-memory DB)
  pi-events.test.ts            7 scenarios — EventTranslator (incl. compaction side-effect)
  pi-session-manager.test.ts   4 scenarios — PiSessionManager lifecycle
  pi-tool-groups.test.ts       7 scenarios — buildPiTools group expansion per column config
  pi-rpc-scenarios.test.ts    shared-rpc-scenarios + 3 Pi-specific flows

Layer 4 — Playwright UI (mock-api + WS mock)
  tool-rendering.spec.ts       +3 scenarios — undo_write display, op:XXXX, [unchanged]

Support file
  src/bun/test/support/pi-sdk-mock.ts
    MockPiSession    (implements PiSdkSession — queueTurn with emit/callTool/waitAbort steps)
    MockPiSdkAdapter (implements PiSdkAdapter — queueCreate, queueResume)
```

## Risks / Trade-offs

- **`rg` availability in test env**: `search_text` has a fallback walker; Layer 2 tests should cover both paths or explicitly skip the rg path if not available (same as production fallback).
- **Pi JSONL session files on disk**: `PiSessionManager` integration tests create real files; cleanup must use `afterEach` tmpdir removal (same pattern as `worktree.test.ts`).
- **Playwright flakiness**: The 3 new scenarios use WebSocket mock injection — same mechanism as existing `tool-rendering.spec.ts` tests. Low risk since no real server.
- **No `undo_write` at Layer 3 engine level**: Undo is fully tested at Layer 2 (tool unit) and Layer 1 (stack unit). Engine-level undo flow can be covered by a single Layer 3 RPC scenario (write → undo → verify file restored).

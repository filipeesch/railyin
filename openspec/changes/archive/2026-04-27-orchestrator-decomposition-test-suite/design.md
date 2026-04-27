## Context

The `decompose-orchestrator-god-class` change extracts focused modules from `orchestrator.ts`. Each extracted module has logic that was previously only reachable through the full HTTP+DB+Orchestrator integration path. This change adds the unit and focused integration tests that make each module independently verifiable.

Test infrastructure already in place:
- `ScriptedEngine` — scripted async event sequences with checkpoint pausing
- `BackendRpcRuntime` — in-memory DB + Orchestrator + handlers wired together
- `initDb()` / `setupTestConfig()` / `seedProjectAndTask()` — shared test helpers
- `stream-pipeline-scenarios.test.ts` (11 scenarios) and `stream-tree-scenarios.test.ts` (6 scenarios) — full-stack stream coverage that must remain green

## Goals / Non-Goals

**Goals:**
- Unit-test each extracted pure/near-pure module in isolation
- Replace 5 heavyweight orchestrator integration tests (working-directory resolution) with direct resolver unit tests that need no config singleton, no engine, no DB
- Add focused `StreamProcessor` integration tests covering the 3 cancellation flush paths and fatal error handling — gaps not covered by the full-stack scenarios
- Update all 9 `new Orchestrator(engine, ...)` construction sites to use `new EngineRegistry(factory)` after the refactor
- All existing tests remain green

**Non-Goals:**
- Replacing `stream-pipeline-scenarios.test.ts` or `stream-tree-scenarios.test.ts` — they stay as full-stack regression guards
- Adding Playwright tests — no UI surface area
- Testing `CopilotEngine`, `ClaudeEngine`, or any engine implementation internals

## Decisions

### D1 — Resolver unit tests replace integration tests for working-directory logic

**Decision**: The 5 CWD resolution scenarios currently in `orchestrator.test.ts` (the `CapturingEngine` / `makeCapturingOrchestrator` block) are migrated to `working-directory-resolver.test.ts` as direct `WorkingDirectoryResolver.resolve()` calls. The orchestrator integration versions are removed.

**Why**: Each integration test creates 2–3 temp directories, writes YAML config, resets the config singleton, seeds the DB, constructs a full orchestrator with a capturing engine, runs `executeHumanTurn`, then tears everything down — ~50 lines per test. The direct resolver test is ~5 lines. The regression value is identical because the orchestrator now delegates directly to `WorkingDirectoryResolver` with no intermediate logic.

**Alternative considered**: Keep both. Rejected — the integration tests become redundant after extraction. They tested the implementation path, not the behavior. The orchestrator integration tests for `executeTransition`/`executeHumanTurn` already cover that the working directory is threaded through correctly.

---

### D2 — EngineRegistry tests use factory injection, not fixed engine helpers

**Decision**: `engine-registry.test.ts` constructs `EngineRegistry` with `(key) => new TestEngine()` factory lambdas directly. No `EngineRegistry.fromFixed()` static helper.

**Why**: The factory function IS the DI seam for `EngineRegistry`. Testing it directly verifies the actual contract. Static factory helpers add surface area without adding test expressiveness.

---

### D3 — StreamProcessor tests use ScriptedEngine + in-memory DB (not BackendRpcRuntime)

**Decision**: `stream-processor.test.ts` constructs `StreamProcessor` with callback stubs and drives it directly via `ScriptedEngine` — bypassing the HTTP handlers and `Orchestrator` coordinator layer.

**Why**: The full-stack `BackendRpcRuntime` covers stream behavior from handler to DB. `StreamProcessor` tests exist to cover the *lifecycle* concerns (signal ownership, accumulator flush, cleanup) that are invisible at the full-stack level. Bypassing handlers keeps these tests fast and pinpoint.

---

### D4 — backend-rpc-runtime.ts gets a one-line constructor update

**Decision**: `createBackendRpcRuntime` swaps `new Orchestrator(engine, ...)` to `new Orchestrator(new EngineRegistry(() => engine), ...)`. No other changes.

**Why**: The runtime is shared infrastructure. Updating it ensures all 17+ scenarios that use it (stream-pipeline, stream-tree, etc.) continue working through the new constructor without any per-test changes.

## Risks / Trade-offs

- **Risk**: Removing the 5 orchestrator integration tests for working-directory resolution reduces coverage of the orchestrator→resolver call path. → **Mitigation**: The existing `executeHumanTurn` tests already exercise that call path — they just don't assert on `capturedWorkingDirectory`. Accept the trade-off.
- **Risk**: `stream-processor.test.ts` needs to construct `StreamProcessor` with the right callback shape — if the constructor signature changes late in the refactor, these tests need updating. → **Mitigation**: Write these tests after `stream-processor.ts` is stable (task dependency).
- **Trade-off**: 6 new test files increases the number of files to navigate. Each is small (~50–100 lines) and named to match its module. Accepted.

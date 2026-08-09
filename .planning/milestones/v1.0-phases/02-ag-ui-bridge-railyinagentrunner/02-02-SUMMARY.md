---
phase: 02-ag-ui-bridge-railyinagentrunner
plan: 02
subsystem: api
tags: [ag-ui, copilotkit, jsonl, persistence, runner, replay, sse, run-lock]

requires:
  - phase: 02-ag-ui-bridge-railyinagentrunner
    provides: RailyinAgent + event-bridge + executeChatTurn seam (02-01), mock-engine scripted scenarios, e2e scaffolding
provides:
  - append-only per-thread JSONL persistence at data/threads/{threadId}.jsonl (JsonlStore)
  - RailyinAgentRunner (InMemoryAgentRunner subclass): pipe-tap run persistence, hot/cold/never-run connect branching, JSONL cold replay (the #3553 fix)
  - cold replay shape: truncate-at-first-RUN_ERROR → finalizeRunEvents-for-unterminated-last-run → completeOpenToolCalls → compactEvents
  - D-12 composition-root runner swap (non-probe path only; probe byte-identical)
  - e2e durability proof: JSONL on disk, never-run empty connect, concurrent-run 200+empty body, restart replay over one durable dataDir
affects: [02-03 (workspace resolver), phase 3 (decision interrupts), phase 4 (crash tolerance: buffered writer, atomic index), phase 5 (UI cold-start hydration)]

actuals:
  tokens: 10000
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Pipe-tap persistence on the runner observable (super.run().pipe(tap)) — the log holds EXACTLY what the client received, incl. the runner's RUN_STARTED.input patch (never persist from agent.run())"
    - "Persistence failures never break the client stream: tap next/complete wrap store calls in try/catch + warn"
    - "Cold replay order: truncate-at-first-RUN_ERROR → finalizeRunEvents (only when the last run lacks a terminal) → completeOpenToolCalls (synthetic END+RESULT inserted BEFORE the terminal — wire-valid) → compactEvents"
    - "ThreadId sanitization as layered defense: agent /^\d+$/ (02-01) first, store THREAD_ID_RE + resolved-path containment second (V5/V8)"
    - "rxjs version-bridge cast: base observable → top-level Observable<BaseEvent> before .pipe() (nested 7.8.1 vs hoisted 7.8.2 invariance)"

key-files:
  created:
    - src/bun/copilotkit/jsonl-store.ts
    - src/bun/copilotkit/jsonl-store.test.ts
    - src/bun/copilotkit/railyin-runner.ts
    - src/bun/copilotkit/railyin-runner.test.ts
  modified:
    - src/bun/index.ts
    - e2e/api/fixtures/server.ts
    - e2e/api/copilotkit/railyin.test.ts

key-decisions:
  - "Truncate-at-first-RUN_ERROR applied BEFORE finalizeRunEvents (plan's literal order would delete the terminal finalize just appended when a RUN_ERROR exists); an errored run's tail is re-completed via finalize so the replay always ends with a terminal"
  - "completeOpenToolCalls inserts synthetic TOOL_CALL_END+RESULT BEFORE the last terminal (mirrors 02-01's D-09 wire-valid ordering) instead of appending after it — a RESULT after RUN_FINISHED would violate verifyEvents-style tool-call state"
  - "Runner persistence tap catches + warns store failures: the agent's RUN_ERROR contract for non-numeric threadIds must survive (T-02-01 second defense line; found via e2e test f regression)"
  - "getDataDir() reused from the existing ./config/index.ts import (it delegates to platform.ts — identical function; no duplicate import added)"

patterns-established:
  - "Store + runner co-located unit suites follow the src/bun/test conventions (makeTempDir mkdtempSync pattern, bun:test, unique threadIds per test so the base runner's process-global store cannot bleed between tests)"
  - "Fixture dataDir option contract: caller owns cleanup of the durable dir AND the runtime dir (shutdown skips rmSync) — restart-replay e2e spawns two servers over one dir"

requirements-completed: [RUNR-02, RUNR-03, RUNR-04, RUNR-05, RUNR-06, RUNR-07]

coverage:
  - id: D1
    description: "JsonlStore — append/read/exists/endRun over data/threads/{id}.jsonl, per-event append, tolerant reader (partial trailing line skipped), threadId sanitization + resolved-path containment BEFORE any fs use"
    requirement: RUNR-02
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/jsonl-store.test.ts#JsonlStore"
        status: pass
    human_judgment: false
  - id: D2
    description: "RailyinAgentRunner.run() — wire-exact JSONL persistence incl. the runner-patched RUN_STARTED.input; inherited 'Thread already running' synchronous throw"
    requirement: RUNR-04
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/railyin-runner.test.ts#lock + wire-exact persistence"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cold connect replay — five shapes (missing file / empty file / N completed runs per-run boundaries / interrupted last run finalized / errored-run-then-run truncated at first RUN_ERROR) + dangling tool-call synthesis + hot-path super.connect delegation"
    requirement: RUNR-05
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/railyin-runner.test.ts#replay shapes"
        status: pass
    human_judgment: false
  - id: D4
    description: "Never-run connect completes empty — zero frames, 200 (store absent, file absent)"
    requirement: RUNR-06
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/railyin.test.ts#test 8 never-run connect"
        status: pass
    human_judgment: false
  - id: D5
    description: "Real-wire durability — JSONL on disk after a run (RUN_STARTED-with-input first, RUN_FINISHED last); concurrent run → HTTP 200 + EMPTY body (never 500); restart replay over the SAME dataDir across two spawned servers with completed tool calls; Phase 1 probe regression green"
    requirement: RUNR-03
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/railyin.test.ts#durability tests 7-10"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-08-09
status: complete
---

# Phase 2 Plan 2: Durable Runner — JSONL Persistence, Cold Replay, Run Lock on the Real Wire

**Append-only per-thread JSONL persistence via a RailyinAgentRunner (InMemoryAgentRunner subclass): every wire event — including the runner-patched RUN_STARTED.input — lands verbatim in `data/threads/{conversation.id}.jsonl`; cold connects replay the log across process restarts (the #3553 cold-start fix) with completed tool calls and per-run boundaries; never-run threads connect empty; concurrent runs are rejected by the inherited lock.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-09T05:23:00Z
- **Completed:** 2026-08-09T05:35:12Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- **The store is durable and safe** — `JsonlStore` appends one `BaseEvent` JSON per line at `<dataDir>/threads/{threadId}.jsonl` (per-event, never run-end batch — replay needs the mid-run tail). `THREAD_ID_RE` (`^\d+$`) + a resolved-path containment check run FIRST in every public method, so `../evil`, `a/../../x`, and absolute threadIds throw before any filesystem use (V5/V8, T-02-07). The tolerant reader skips + warns a truncated trailing line instead of failing the thread (Pitfall 7). All five behaviors unit-tested.
- **The runner persists exactly what the client receives** — `run()` pipes `super.run()` through a `tap` that appends every event and calls `endRun` on completion; the log therefore contains the runner's `RUN_STARTED.input` patch (the anti-pattern — persisting from inside `agent.run()` — is avoided). The base runner keeps the lock (`Error("Thread already running")` synchronous throw, RUNR-04), compaction, and live-tail — nothing reimplemented.
- **Cold replay is the #3553 fix** — `connect()` branches HOT (in-process thread → `super.connect()` keeps the live tail with messageId dedup), COLD (durable log exists → replay: truncate at the first RUN_ERROR (Pitfall 4 safe default), finalize an unterminated last run via `finalizeRunEvents`, synthesize `TOOL_CALL_END`+`TOOL_CALL_RESULT {messageId: "${toolCallId}-result", content: ""}` for dangling calls inserted BEFORE the terminal (RUNR-07), then `compactEvents` → emit verbatim), NEVER-RUN (base completes empty — zero frames, RUNR-06).
- **Proven on the real wire (D-12)** — `JsonlStore(getDataDir())` + `RailyinAgentRunner(store)` passed to `CopilotRuntime` in the NON-probe path only; probe mode keeps ScriptedAgent + base runner byte-identical (Pitfall 9). e2e: JSONL on disk with RUN_STARTED-with-input first and RUN_FINISHED last; never-run connect = 200 + zero frames; a second run on a running `__SCRIPT_SLOW__` thread = 200 + EMPTY body (never 500); a run survives server shutdown and replays from the SAME durable dataDir on a fresh server with completed tool calls. Phase 1 probe suite (8/8) stays green.

## Task Commits

Each task was committed atomically (RED then GREEN per tdd="true"):

1. **Task 1: JSONL store with sanitization + tolerant reader** - `10a10bd5` (test: failing store tests), `a9678973` (feat: JsonlStore)
2. **Task 2: RailyinAgentRunner — pipe-tap persistence, hot/cold connect, replay shapes** - `dc691450` (test: failing runner tests), `860afd8d` (feat: runner)
3. **Task 3: Composition-root runner swap + fixture dataDir + real-wire durability proof** - `4b5c355a` (feat + Rule 1 fix)

## Files Created/Modified

- `src/bun/copilotkit/jsonl-store.ts` - `THREAD_ID_RE` + containment; `threadLogPath()`; `JsonlStore` (append/read/exists/endRun)
- `src/bun/copilotkit/jsonl-store.test.ts` - 5 tests: round-trip, missing-file, traversal rejection, tolerant read, dir creation
- `src/bun/copilotkit/railyin-runner.ts` - `RailyinAgentRunner` with run() pipe-tap + 3-branch connect(); `completeOpenToolCalls` local pass
- `src/bun/copilotkit/railyin-runner.test.ts` - 9 tests: lock throw, wire-exact persistence, 5 replay shapes, dangling-tool synthesis, hot path
- `src/bun/index.ts` - D-12 runner swap: `JsonlStore(getDataDir())` + `RailyinAgentRunner` in the non-probe path only
- `e2e/api/fixtures/server.ts` - `StartServerOptions.dataDir` (durable RAILYN_DATA_DIR; shutdown skips rmSync — caller owns cleanup)
- `e2e/api/copilotkit/railyin.test.ts` - tests 7-10: JSONL file assertions, never-run connect, concurrent-run empty body, restart replay

## Decisions Made

- **Truncation runs BEFORE finalizeRunEvents** — the plan's literal order (finalize → truncate) would delete the terminal finalize just appended when a RUN_ERROR exists in the log. Applied first, the truncation slices to the pre-error tail and finalize re-completes it, so the replay always ends with a terminal and never carries a mid-stream RUN_ERROR.
- **Synthetic tool results are inserted BEFORE the last terminal** — completeOpenToolCalls mirrors 02-01's D-09 wire-valid ordering (a `TOOL_CALL_RESULT` appended after `RUN_FINISHED` would trip tool-call-state validation on a verifying client). For unterminated logs finalizeRunEvents closes the calls first, so the local pass is effectively the terminal'd-log fix (research A5).
- **Persistence is non-fatal to the wire** — the tap catches + warns store failures. A rejected append (invalid threadId — store is the second defense line) must not interrupt the event flow downstream: the agent's RUN_ERROR contract (T-02-01) is what the client should see.
- **getDataDir() reused from the existing `./config/index.ts` import** — it delegates to platform.ts's implementation; no duplicate import added.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Persistence tap broke the client stream for non-numeric threadIds**
- **Found during:** Task 3 (e2e test f regression)
- **Issue:** the tap's `store.append` threw `Invalid threadId` on the first event of a `../../etc/passwd` run; the throw interrupted the event flow downstream, so the wire delivered ZERO frames instead of the agent's RUN_STARTED + RUN_ERROR (02-01 contract) and left the base runner's store stuck mid-run
- **Fix:** wrap append/endRun in try/catch + console.warn — persistence failures never break the client stream; the RUN_ERROR contract survives
- **Files modified:** src/bun/copilotkit/railyin-runner.ts
- **Verification:** e2e test f passes again (RUN_ERROR last frame); all 10 railyin e2e tests green
- **Committed in:** 4b5c355a (part of Task 3 commit)

**2. [Rule 3 - Blocking] rxjs 7.8.1/7.8.2 invariance in run()'s pipe**
- **Found during:** Task 2 (typecheck)
- **Issue:** `super.run(request).pipe(tap(...))` failed to typecheck — @copilotkit/runtime types its Observable with NESTED rxjs@7.8.1 while this module imports hoisted rxjs@7.8.2; Subscriber is invariant
- **Fix:** cast the base observable to top-level `Observable<BaseEvent>` before piping (the same version-bridge pattern the probe agent and index.ts use)
- **Files modified:** src/bun/copilotkit/railyin-runner.ts
- **Verification:** `bun run typecheck` 0 errors
- **Committed in:** 860afd8d (part of Task 2 commit)

**3. [Rule 3 - Blocking] Runner test fixture fixes**
- **Found during:** Task 2 (GREEN run + typecheck)
- **Issue:** (a) the empty-file fixture wrote into a missing `threads/` dir (ENOENT); (b) `collect()` inferred `T` as `unknown` (contravariant next-callback position) — 6 TS18046 errors; (c) `toContain("TOOL_CALL_RESULT")` string literals rejected by the `EventType`-typed matcher
- **Fix:** mkdirSync the threads dir in 3b; explicit `collect<BaseEvent>(...)` at all 9 call sites; `EventType.TOOL_CALL_RESULT` constants
- **Files modified:** src/bun/copilotkit/railyin-runner.test.ts
- **Verification:** 9/9 runner tests pass; typecheck clean
- **Committed in:** 860afd8d (part of Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 1 bug, 2 Rule 3 blockers)
**Impact on plan:** all fixes were correctness requirements (wire contract preservation, rxjs type bridging, test fixture accuracy). The plan's architecture — store API, runner overrides, connect branching, replay shapes, probe-mode byte-identity — implemented exactly as written; the only behavioral refinement is the truncate-before-finalize ordering documented in Decisions Made.

## Issues Encountered

- **Test 3b fixture ENOENT** — the empty-file replay fixture needed the `threads/` dir to exist before writing; resolved in the GREEN commit (test bug, not implementation).
- **e2e runtime residue** — the restart-replay test (dataDir contract) deliberately skips runtime-dir cleanup; the leftover `.runtime/` dirs from this session were removed manually.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **02-03 can proceed directly:** the durable runner is live in the composition root; 02-03 adds the task→chat_sessions workspace resolver and the advisory executions-row busy check without touching the persistence layer.
- **Phase 4 crash tolerance** slots into `JsonlStore.endRun` (currently a no-op bookkeeping hook) and the tolerant reader — the seams are in place.
- **Phase 5 UI cold-start hydration** consumes exactly the replay shape the base in-memory connect already produced (compacted multi-run events), so the pinned client contract is unchanged.

---
*Phase: 02-ag-ui-bridge-railyinagentrunner*
*Completed: 2026-08-09*

## Self-Check: PASSED

- All 4 new source/test files + SUMMARY exist on disk (verified with `[ -f ]`)
- All 5 commit hashes present in git history (RED+GREEN per tdd task + Task 3)
- All plan-level `<verification>` commands pass:
  - `bun test src/bun/copilotkit/jsonl-store.test.ts` — 5/5
  - `bun test src/bun/copilotkit/railyin-runner.test.ts` — 9/9
  - `bun test e2e/api/copilotkit/railyin.test.ts` — 10/10 (tests a-f + 7-10)
  - `bun test e2e/api/copilotkit/copilotkit.test.ts` — 8/8 (Phase 1 probe regression)
  - `bun run typecheck` — 0 errors
- Full backend regression: `bun test src/bun --timeout 20000` — 2310 pass / 2 skip / 0 fail

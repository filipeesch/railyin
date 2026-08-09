---
phase: 02-ag-ui-bridge-railyinagentrunner
plan: 01
subsystem: api
tags: [ag-ui, copilotkit, sse, event-bridge, executor-seam, mock-engine]

requires:
  - phase: 01-copilotruntime-hosting-thread-apis-spike
    provides: probe agent shape (AbstractAgent run()), CopilotRuntime mount, probe gate, SSE frame test scaffolding
provides:
  - onEngineEvent/onRunEnd callback seam through executeChatTurn (4 executor files)
  - pure EngineEvent → AG-UI BaseEvent translation module (event-bridge.ts)
  - RailyinAgent (AbstractAgent subclass) with clone/abortRun/terminal contract
  - D-12 registration: RailyinAgent behind the probe gate (base InMemoryAgentRunner for now)
  - mock-engine scripted scenarios via prompt markers
  - real-server e2e proving the run path (RUN_STARTED-first, tool/reasoning lifecycle, D-09 synthesis, RUN_ERROR)
affects: [02-02 (runner swap + persistence), 02-03 (workspace resolver), phase 3 (decision interrupts), phase 5 (UI)]

actuals:
  tokens: 18249
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Optional-callback threading: opts?: { onEngineEvent?, onRunEnd? } as 9th executeChatTurn param — additive, byte-identical when absent (research A1)"
    - "Pure translation module with zod-validated output: every bridge event parsed via EventSchemas from @ag-ui/core"
    - "Per-run closure state in agents (ReplaySubject, translate state) — never instance fields (runtime clones per request)"

key-files:
  created:
    - src/bun/copilotkit/event-bridge.ts
    - src/bun/copilotkit/event-bridge.test.ts
    - src/bun/copilotkit/railyin-agent.ts
    - src/bun/copilotkit/railyin-agent.test.ts
    - src/bun/test/execution-seam.test.ts
    - e2e/api/copilotkit/railyin.test.ts
  modified:
    - src/bun/engine/coordinator.ts
    - src/bun/engine/orchestrator.ts
    - src/bun/engine/execution/chat-executor.ts
    - src/bun/engine/stream/stream-processor.ts
    - src/bun/testing/mock-engine.ts
    - src/bun/index.ts

key-decisions:
  - "D-12 executed: RailyinAgent registered when probe disabled AND orchestrator non-null; probe gate checked FIRST (Pitfall 9); base InMemoryAgentRunner kept (runner swap lands 02-02)"
  - "Completion guard closes open text/reasoning blocks before RUN_FINISHED — verifyEvents (installed client) rejects a terminal while messages are active (Pitfall 3 refinement)"
  - "D-09 synthesis emits RESULT-only for dangling tool calls — verifyEvents rejects a second TOOL_CALL_END for an already-ended call; plan's 'append END+RESULT' corrected to wire-valid behavior (Pitfall 5/6 interplay)"
  - "markClaudeExecution NOT deleted this phase — deviation from D-02's parenthetical, recorded in plan objective: legacy /ws chat UI still live (IMPR-03); deletion moves to Phase 7"

patterns-established:
  - "Bridge terminal emission: agent emits RUN_STARTED first (with input) and exactly one terminal last — never relies on finalizeRunEvents (would append INCOMPLETE_STREAM RUN_ERROR)"
  - "Agent-side completion guard: stream without onRunEnd (pause paths) closes with RUN_FINISHED via guardedComplete()"

requirements-completed: [BRDG-01, BRDG-02, BRDG-03, RUNR-01]

coverage:
  - id: D1
    description: "executeChatTurn seam — onEngineEvent fires for every raw EngineEvent in exact order; onRunEnd fires at all terminal outcomes; byte-identical when opts absent"
    requirement: BRDG-01
    verification:
      - kind: integration
        ref: "src/bun/test/execution-seam.test.ts#executeChatTurn seam (onEngineEvent/onRunEnd)"
        status: pass
    human_judgment: false
  - id: D2
    description: "event-bridge pure translation — token/reasoning/tool/subagent families, D-09 dangling-tool synthesis, namespaced toolCallIds, exactly-one-terminal, all EventSchemas-validated"
    requirement: BRDG-01
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/event-bridge.test.ts#event-bridge"
        status: pass
    human_judgment: false
  - id: D3
    description: "RailyinAgent lifecycle — RUN_STARTED-first with input, clone() deps, abortRun→cancel, completion guard, unknown-conversation/non-numeric-threadId RUN_ERROR (T-02-01)"
    requirement: RUNR-01
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#RailyinAgent"
        status: pass
    human_judgment: false
  - id: D4
    description: "Real-server run path — RUN_STARTED-with-input first, RUN_FINISHED last; REASONING_* and full TOOL_CALL lifecycle; D-09 RESULT before terminal; RUN_ERROR terminal; THREAD_NOT_FOUND"
    requirement: BRDG-02
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/railyin.test.ts#RailyinAgent run path"
        status: pass
    human_judgment: false
  - id: D5
    description: "Phase 1 probe regression — probe gate intact, ScriptedAgent + base runner byte-identical under RAILYN_COPILOTKIT_PROBE=1"
    requirement: RUNR-01
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/copilotkit.test.ts#CopilotRuntime"
        status: pass
    human_judgment: false

duration: 62min
completed: 2026-08-09
status: complete
---

# Phase 2 Plan 1: AG-UI Bridge Tracer Slice — Seam, Translation, Agent, Real Wire

**One chat turn through the AG-UI boundary end-to-end: RunAgentInput → RailyinAgent → threaded execution seam → MockExecutionEngine → EngineEvent → event-bridge → AG-UI BaseEvent stream (RUN_STARTED first, terminal last), proven on a real spawned server.**

## Performance

- **Duration:** 62 min
- **Started:** 2026-08-09T04:25:00Z
- **Completed:** 2026-08-09T05:27:00Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- **The seam is live across 4 executor files** — `executeChatTurn` accepts the optional `opts?: { onEngineEvent?, onRunEnd? }` param (9th, trailing); `onEngineEvent` fires at the top of `consume()`'s for-await loop for EVERY raw EngineEvent in exact order; `onRunEnd` fires at all six terminal code points (done / fatal error / decision_request / abort-in-loop / post-loop abort / catch) mapped to the four outcomes. Absent opts → byte-identical legacy behavior (DB dual-write intact, `markClaudeExecution` untouched per IMPR-03).
- **The pure translation module exists** — `event-bridge.ts` (no I/O imports): exhaustive `EngineEvent` dispatch mirroring `consume()`'s switch 1:1; token → grouped assistant text blocks; reasoning → `REASONING_*` (BRDG-02); tools → complete `TOOL_CALL_START/ARGS/END/RESULT` lifecycle with `messageId` on every RESULT (Pitfall 5) and namespaced child ids (Pitfall 6); subagent pair; board/control events ignored (no double-broadcast); D-09 dangling-tool synthesis; exactly one terminal per run. All 16 tests zod-parse every emitted event via `EventSchemas`.
- **RailyinAgent is registered and wire-proven** — clone() re-attaches deps (Pitfall 1), abortRun() → `orchestrator.cancel(executionId)`, threadId validated `/^\d+$/` + conversation existence BEFORE any side effect (T-02-01), RUN_STARTED emitted first WITH input, completion guard prevents INCOMPLETE_STREAM RUN_ERROR (Pitfall 3). The mock engine gained four scripted scenarios via prompt markers. Real-server e2e proves the whole path: RUN_STARTED-with-input → reasoning/tool lifecycle → D-09 synthesized RESULT → RUN_ERROR terminal.
- **D-12 rollback-safe by construction** — the probe gate (`RAILYN_COPILOTKIT_PROBE=1`) is checked BEFORE the real registration; probe mode keeps ScriptedAgent + base InMemoryAgentRunner byte-identical. Phase 1 probe suite stays green (8/8).

## Task Commits

Each task was committed atomically (RED then GREEN per tdd="true"):

1. **Task 1: Thread the seam through executeChatTurn** - `3bf6d8cc` (test: failing seam contract), `1c1ae9c4` (feat: seam threading)
2. **Task 2: Build the pure event-bridge translation module** - `209e87b6` (test: failing translation contract), `f7042ccf` (feat: event-bridge)
3. **Task 3: RailyinAgent, registration, real-wire proof** - `a9d33385` (test: failing agent lifecycle), `d3da7aa3` (feat: agent + registration + e2e)

## Files Created/Modified

- `src/bun/engine/coordinator.ts` - `ChatTurnOpts` interface + 9th trailing param on `executeChatTurn`
- `src/bun/engine/orchestrator.ts` - pass-through of `opts` to ChatExecutor
- `src/bun/engine/execution/chat-executor.ts` - `opts` accepted and forwarded at the single runNonNative call site
- `src/bun/engine/stream/stream-processor.ts` - `opts` threaded into `runNonNative`/`consume`; `onEngineEvent` at loop top; `onRunEnd` at 6 terminal points
- `src/bun/test/execution-seam.test.ts` - real-chain contract test (order, absent-opts byte-identity, 4 terminal outcomes)
- `src/bun/copilotkit/event-bridge.ts` - pure EngineEvent → BaseEvent translation
- `src/bun/copilotkit/event-bridge.test.ts` - 16 table-driven family tests, EventSchemas-validated
- `src/bun/copilotkit/railyin-agent.ts` - AbstractAgent subclass: validation, RUN_STARTED-first, per-run closure, completion guard, clone/abortRun overrides
- `src/bun/copilotkit/railyin-agent.test.ts` - 6 lifecycle tests with a fake ExecutionCoordinator + real in-memory DB
- `src/bun/testing/mock-engine.ts` - scripted scenarios `__SCRIPT_TOOLS__` / `__SCRIPT_DANGLING_TOOL__` / `__SCRIPT_SLOW__` / `__SCRIPT_ERROR__`
- `src/bun/index.ts` - D-12 registration: RailyinAgent when probe disabled + orchestrator present; probe gate first
- `e2e/api/copilotkit/railyin.test.ts` - real-server run-path suite (6 tests)

## Decisions Made

- **Completion guard closes open blocks first** — the installed client's `verifyEvents` rejects `RUN_FINISHED` while text messages are active ("Cannot send 'RUN_FINISHED' while text messages are still active"), so `done`/`error` translation and the agent's completion guard both emit the closing `TEXT_MESSAGE_END`/`REASONING_MESSAGE_END` before the terminal.
- **D-09 synthesis is RESULT-only on the live path** — `tool_start` already emits `TOOL_CALL_END`, and `verifyEvents` rejects a second `TOOL_CALL_END` ("No active tool call found"); appending END+RESULT as the plan literally stated would fail the wire. Synthesized `TOOL_CALL_RESULT {messageId, content:""}` satisfies the card-no-stale-running goal.
- **Events-during-dispatch completion trigger** — the guard fires only when the engine produced events synchronously during `executeChatTurn` dispatch AND no `onRunEnd` arrived (scripted/pause engines); real engines yield after the dispatch settles, so live streams are unaffected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Double-emission of accumulated events in the agent finish path**
- **Found during:** Task 3 (agent lifecycle test)
- **Issue:** `finish()` emitted the entire `synthesizeMissingToolResults(state, accumulated)` output, re-sending events already pushed live via `onEngineEvent` (10 duplicate frames in the run)
- **Fix:** emit only the synthesized tail — `synthesized.slice(accumulated.length)`
- **Files modified:** src/bun/copilotkit/railyin-agent.ts
- **Verification:** agent lifecycle test asserts exact event sequence with no duplicates
- **Committed in:** d3da7aa3 (part of Task 3 commit)

**2. [Rule 1 - Bug] Test queried bun:sqlite with params bound to `.query()` instead of `.get()`**
- **Found during:** Task 1 (seam test, byte-identical absent-opts case)
- **Issue:** `db.query(sql, [id]).get()` returns `undefined` — bun:sqlite binds params via `.get(...)`, not `.query(...)`; the execution row never matched, so the poll timed out
- **Fix:** moved params to `.get(executionId)` / `.get(conversationId)` at all call sites
- **Files modified:** src/bun/test/execution-seam.test.ts
- **Verification:** all 6 seam tests pass
- **Committed in:** 1c1ae9c4 (part of Task 1 commit)

**3. [Rule 3 - Blocking] zod-inferred BaseEvent union rejects direct type casts in tests**
- **Found during:** Task 2/3 (typecheck)
- **Issue:** `BaseEvent`/`AGUIEvent` are zod-inferred discriminated unions; `as { toolCallId: string }` casts fail TS2352 because no member sufficiently overlaps
- **Fix:** bridge casts through `unknown` (`as unknown as {...}`); agent subject typed `ReplaySubject<BaseEvent>` (uniform event type across module imports)
- **Files modified:** event-bridge.test.ts, railyin-agent.ts, railyin-agent.test.ts
- **Verification:** `bun run typecheck` clean (0 errors)
- **Committed in:** f7042ccf, d3da7aa3

**4. [Rule 3 - Blocking] `__SCRIPT_SLOW__` delay handling**
- **Found during:** Task 3 (mock-engine extension)
- **Issue:** first draft tagged a `delay` field onto the `done` event (invalid EngineEvent); refactored to a `{ events, pauseMs }` script descriptor with the pause applied in the yield loop after the first event
- **Fix:** scripted return type carries `pauseMs`; loop applies the silence after the first yield
- **Files modified:** src/bun/testing/mock-engine.ts
- **Verification:** e2e run-path suite passes; typecheck clean
- **Committed in:** d3da7aa3

---

**Total deviations:** 4 auto-fixed (2 Rule 1, 2 Rule 3)
**Impact on plan:** All fixes were correctness requirements (wire validity, test accuracy, TS strictness). No scope creep; the plan's architecture, files, and registration were implemented as written.

## Issues Encountered

- **verifyEvents contract discovered from installed source** (not docs): the plan's literal "synthesize TOOL_CALL_END + TOOL_CALL_RESULT" and "TEXT_MESSAGE_END at next boundary" needed the wire-valid refinements documented in Decisions Made. All validated empirically against `node_modules/@ag-ui/client/dist/index.mjs` `verifyEvents` and covered by the e2e wire tests.
- **Async e2e runtime:** copilotkit.test.ts's 32s silence test and server startup make the e2e suite ~40s; expected (Phase 1 accommodation).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **02-02 can proceed directly:** the seam, translation module, agent, and registration are all in place; 02-02 swaps in `RailyinAgentRunner` + `jsonl-store` persistence and the concurrent-run/connect e2e.
- **02-03 will add** the task→chat_sessions workspace resolver (currently `getDefaultWorkspaceKey()` per plan) and the advisory executions-row busy check.
- Phase 3 replaces `decision` outcome semantics with interrupt outcomes; the `onRunEnd("decision")` seam point is already wired.

---
*Phase: 02-ag-ui-bridge-railyinagentrunner*
*Completed: 2026-08-09*

## Self-Check: PASSED

- All 12 key files exist on disk (6 new sources/tests + SUMMARY)
- All 6 commit hashes present in git history (RED+GREEN per task)
- All plan-level `<verification>` commands pass:
  - `bun test src/bun/test/execution-seam.test.ts` — 6/6
  - `bun test src/bun/copilotkit/event-bridge.test.ts` — 16/16
  - `bun test src/bun/copilotkit/railyin-agent.test.ts` — 6/6
  - `bun test e2e/api/copilotkit/railyin.test.ts` — 6/6
  - `bun test e2e/api/copilotkit/copilotkit.test.ts` — 8/8 (Phase 1 regression)
  - `bun run typecheck` — 0 errors

---
phase: 03-decision-interrupts-resume
plan: 01
subsystem: api
tags: [ag-ui, interrupt, decision_request, registry, copilotkit, event-bridge]

# Dependency graph
requires:
  - phase: 02-ag-ui-bridge-railyinagentrunner
    provides: RailyinAgent run loop (finish(), onEngineEvent tap, WR-02 guard), pure event-bridge translation module, mock-engine scripted markers
provides:
  - canonical AG-UI interrupt terminal emission: engine decision_request → RUN_FINISHED outcome.interrupt (buildInterruptOutcome, finishInterrupt) — the pause half of the decision cycle
  - module-level per-thread pending-interrupt registry (interrupt-registry.ts) with executionId-independent id scheme decision-<conversationId>-<seq>
  - D-04 block-while-pending: non-resume runs rejected server-side with THREAD_BUSY + precise message (CHAT-09 SC3)
  - Pitfall-5 guard: decision_request without onRunEnd still ends with the interrupt terminal (never swallowed, never wedges)
  - __SCRIPT_DECISION__ Phase A mock-engine script (resume Phase B lands 03-02)
affects: [03-02 (resume half), 03-03 (e2e), phase 5 (decision card rendering via metadata contract)]

actuals:
  tokens: 7945
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Module-level per-thread registry singleton with reset() test hook — survives cloneAgentForRequest (Pitfall 4), mirroring the runtime's ɵGLOBAL_STORE"
    - "Terminal emission stays agent-owned: finishInterrupt mirrors finish() (closer/synthesize/complete/clear); bridge builds shapes only (Pitfall 3 exactly-one-terminal)"
    - "Defensive payload parsing in pure shape helper: malformed engine payload → metadata undefined + message fallback, output always EventSchemas-validated"

key-files:
  created:
    - src/bun/copilotkit/interrupt-registry.ts
    - src/bun/copilotkit/interrupt-registry.test.ts
  modified:
    - src/bun/copilotkit/event-bridge.ts
    - src/bun/copilotkit/event-bridge.test.ts
    - src/bun/copilotkit/railyin-agent.ts
    - src/bun/copilotkit/railyin-agent.test.ts
    - src/bun/testing/mock-engine.ts

key-decisions:
  - "Interrupt id scheme decision-${conversationId}-${seq} with per-thread counter (A3) — executionId-independent because it is null at terminal time during synchronous fake dispatch (Pitfall 3); registry.clear keeps the seq so consecutive batches mint -1/-2"
  - "D-04 block reuses the THREAD_BUSY error code (e2e asserts the code, stays stable) with the registry adding the precise message 'A decision interrupt is pending for this thread' — assumption-delta recorded in the plan"
  - "Registry stores the raw serialized DecisionRequestPayload; parsing stays in the pure bridge helper buildInterruptOutcome (single parse site, unit-pinnable)"

patterns-established:
  - "Tracer-first TDD: the tracer task (Task 1) implements the wire surface end-to-end; follow-up test tasks pin shapes with EventSchemas-validated unit tests"
  - "Decision cycle tests drive the agent through a synchronous fake executeChatTurn (token → decision_request → onRunEnd('decision')) — the same shape the real stream-processor produces (stream-processor.ts:494-507)"

requirements-completed: [RUNR-08, CHAT-09, UI-03, VERF-01]

coverage:
  - id: D1
    description: "Canonical interrupt terminal emission — engine decision_request ends the run with RUN_FINISHED outcome.interrupt (reason decision_request, stable id, message, parsed metadata), a NORMAL terminal, exactly one terminal, never RUN_ERROR (D-01/D-03/D-06)"
    requirement: RUNR-08
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#12: decision_request ends the run with RUN_FINISHED outcome.interrupt"
        status: pass
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#13: interrupt terminal zod-parses via EventSchemas"
        status: pass
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#16: malformed payload — metadata undefined + message fallback, wire-valid"
        status: pass
    human_judgment: false
  - id: D2
    description: "buildInterruptOutcome pure shape helper — RUN_FINISHED + outcome.interrupt, defensive JSON.parse (T-03-01), message fallback; every emitted interrupt event EventSchemas-valid (RUNR-08 emission contract)"
    requirement: RUNR-08
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/event-bridge.test.ts#interrupt outcome describe block (3 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Module-level per-thread pending-interrupt registry — register/get/hasOpen/clear/updateExecutionId/reset, id scheme decision-<conv>-<seq> per-thread counter, survives agent clones (Pitfall 4), executionId attached post-resolve (Pitfall 3)"
    requirement: CHAT-09
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/interrupt-registry.test.ts#interrupt-registry (6 tests)"
        status: pass
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#14/15: registry lifecycle + executionId-independent id"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-04 block-while-pending — a non-resume run on a thread with an open pending interrupt is rejected server-side with RUN_ERROR THREAD_BUSY and the precise message; executeChatTurn never called (CHAT-09 SC3)"
    requirement: CHAT-09
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#17: D-04 block"
        status: pass
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#18: no block when clean"
        status: pass
    human_judgment: false
  - id: D5
    description: "Pitfall-5 guard — a decision_request that never reaches onRunEnd still terminates with the interrupt outcome (registered pending, resumable); never a plain RUN_FINISHED, never a RUN_ERROR, no stream wedge (T-03-02)"
    requirement: CHAT-09
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#19: decision_request without onRunEnd"
        status: pass
    human_judgment: false
  - id: D6
    description: "UI-03 event-contract split — interrupt metadata carries the parsed DecisionRequestPayload (the Phase 5 card data); rendering deferred to Phase 5 per CONTEXT"
    requirement: UI-03
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/event-bridge.test.ts#buildInterruptOutcome — valid payload: message/metadata from payload"
        status: pass
    human_judgment: false
  - id: D7
    description: "__SCRIPT_DECISION__ Phase A mock-engine script (token + decision_request, no done) — the fake-engine pause-path contract fixture; resume Phase B lands in 03-02 Task 3"
    requirement: VERF-01
    verification: []
    human_judgment: true
    rationale: "The script is consumed by e2e decision-cycle tests in 03-02/03-03, not by a unit test in this plan — coverage at e2e time."

# Metrics
duration: 5 min
completed: 2026-08-09
status: complete
---

# Phase 3 Plan 1: Decision Interrupts & Resume — Pause Half Summary

**Engine decision_request now ends the run with the canonical AG-UI interrupt terminal — RUN_FINISHED `{ outcome: { type: "interrupt", interrupts: [{ id: "decision-<conversationId>-<seq>", reason: "decision_request", message, metadata }] } }` — emitted by the agent via `finishInterrupt`, registered in a module-level per-thread registry, with D-04 block-while-pending enforced server-side and a Pitfall-5 guard that can never swallow or strand a decision.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-09T06:53:13Z
- **Completed:** 2026-08-09T06:58:23Z
- **Tasks:** 3 (all `tdd="true"`, RED→GREEN per task)
- **Files modified:** 7 (2 new)

## Accomplishments

- `finishInterrupt` terminal path: `onRunEnd("decision")` → `interruptRegistry.register(conversationId, payload)` → interrupt-terminal RUN_FINISHED via the pure `buildInterruptOutcome` helper — closer/synthesize/complete/clear sequence mirrors `finish()` exactly (exactly-one-terminal discipline, Pitfall 3)
- `interrupt-registry.ts`: module-level singleton (survives `cloneAgentForRequest`, Pitfall 4) — `register` mints `decision-${conversationId}-${seq}` with a per-thread counter (Pitfall 3: never executionId-derived), `get`/`hasOpen`/`clear`/`updateExecutionId`/`reset`; raw serialized payload stored, parsing confined to the bridge helper
- D-04 (CHAT-09 SC3): a non-resume run on a thread with an open pending interrupt → RUN_ERROR THREAD_BUSY "A decision interrupt is pending for this thread" before any executor work (code stable for e2e; registry adds the precise message per the plan's assumption-delta)
- Pitfall-5 guard (T-03-02): `decision_request` added to the WR-02 completion-guard list — a captured payload at completion mints the id and emits `finishInterrupt` instead of `guardedComplete`; the RED test demonstrated the pre-fix wedge (stream timed out, runner lock held forever)
- `__SCRIPT_DECISION__` Phase A mock-engine script (token + decision_request, no done) — the pause-path fixture for the 03-02 resume e2e
- Every emitted interrupt event zod-parses via the installed `@ag-ui/core` EventSchemas (RUNR-08 — the schemas ARE the contract)

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1: Emit the interrupt terminal (tracer)** - `7ed68027` (test: failing decision-cycle tests) + `21404fa6` (feat: buildInterruptOutcome + registry + finishInterrupt + __SCRIPT_DECISION__)
2. **Task 2: Pin wire shape + registry lifecycle** - `9e7a853f` (test: interrupt outcome + registry suites)
3. **Task 3: Pause-path hardening** - `8d6b3d99` (test: failing D-04/Pitfall-5 tests) + `357ec95d` (feat: D-04 block + WR-02 guard)

## Files Created/Modified

- `src/bun/copilotkit/interrupt-registry.ts` (NEW) - module-level per-thread pending-interrupt registry; id scheme `decision-<conv>-<seq>`; `reset()` test hook
- `src/bun/copilotkit/interrupt-registry.test.ts` (NEW) - 6 lifecycle tests: id minting, per-thread seq independence, get/hasOpen/clear, updateExecutionId, reset
- `src/bun/copilotkit/event-bridge.ts` - `buildInterruptOutcome(threadId, runId, payload, interruptId)` pure shape helper (defensive parse, message fallback); bridge stays terminal-free
- `src/bun/copilotkit/event-bridge.test.ts` - "interrupt outcome" describe block (3 EventSchemas-validated tests)
- `src/bun/copilotkit/railyin-agent.ts` - `capturedDecisionPayload` closure; `finishInterrupt`; `onRunEnd("decision")` → register + finishInterrupt; `.then` → updateExecutionId; D-04 registry block before `extractUserText`; WR-02 guard gains decision_request + interrupt terminal
- `src/bun/copilotkit/railyin-agent.test.ts` - tests 12-19 (decision cycle, wire-valid, registry lifecycle, Pitfall 3, malformed payload, D-04 block, control, Pitfall 5)
- `src/bun/testing/mock-engine.ts` - `__SCRIPT_DECISION__` marker + Phase A script

## Decisions Made

- **Interrupt id scheme (A3):** `decision-${conversationId}-${seq}` with a per-thread counter — executionId-independent because it is null at terminal time in the synchronous fake dispatch (Pitfall 3); `clear()` keeps the seq so consecutive batches on one thread mint -1, -2 (pinned by test 14)
- **D-04 code reuse:** THREAD_BUSY stays identical to the advisory lock (e2e asserts the code; the registry adds the precise message) — the plan's recorded assumption-delta, executed as planned
- **Payload ownership:** the registry stores the raw serialized DecisionRequestPayload string; parsing happens only in `buildInterruptOutcome` (single parse site, unit-pinned, T-03-01)

## Deviations from Plan

- **None - plan executed exactly as written.** (The Task 2 RED commit was merged into a single `test` commit because the tracer in Task 1 already implemented the pinned behavior — see Issues Encountered; the plan's tracer-first structure intends this.)

## Issues Encountered

- **Task 2 RED was vacuous by design:** `buildInterruptOutcome` and the registry were already implemented by the Task 1 tracer, so the Task 2 pinning tests passed on first run. The tests are not vacuous — they exercise the exact wire shape, metadata parsing, fallback, and registry lifecycle against the installed EventSchemas (a regression would fail them) — but there was no failing-first step. Recorded for the TDD gate: Task 1 and Task 3 had genuine RED phases (Task 3's RED actually reproduced the Pitfall-5 stream wedge — the subject timed out at 20s, the exact defect the guard fixes).
- **Test 12 enum literal:** initial `expect(types[1]).toBe("TEXT_MESSAGE_START")` failed `tsc` (EventType enum vs string); fixed to `EventType.TEXT_MESSAGE_START` inside the Task 1 GREEN commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Pause half complete and pinned: the interrupt wire format, registry, D-04 block, and Pitfall-5 guard are unit-proven; resume runs still flow through the Phase 2 path (registry block only rejects non-resume input)
- **Ready for 03-02** (resume half): the resume branch occupies the same region as the D-04 block (before `extractUserText`), must bypass it via `input.resume?.length`, and will close the orphaned `waiting_user` execution row (Pitfall 2); the registry's `updateExecutionId` + raw payload + per-thread ids are the resume-validation inputs (D-05)
- Mock-engine Phase B (resume continuation) + e2e decision cycle land in 03-02 Task 3 / 03-03
- No blockers

## Self-Check: PASSED

- Files verified on disk: `src/bun/copilotkit/interrupt-registry.ts`, `src/bun/copilotkit/interrupt-registry.test.ts`, `.planning/phases/03-decision-interrupts-resume/03-01-SUMMARY.md`
- Commits verified: `7ed68027` (Task 1 RED), `21404fa6` (Task 1 GREEN), `9e7a853f` (Task 2), `8d6b3d99` (Task 3 RED), `357ec95d` (Task 3 GREEN), `b72fff61` (docs)
- Plan-level verification green: `bun test src/bun/copilotkit` 67 pass, `bun test e2e/api/copilotkit/copilotkit.test.ts` 8 pass, `bun run typecheck` clean

---
*Phase: 03-decision-interrupts-resume*
*Completed: 2026-08-09*

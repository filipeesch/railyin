---
phase: 03-decision-interrupts-resume
plan: 02
subsystem: api
tags: [ag-ui, interrupt, resume, decision_request, copilotkit, event-bridge, chat-turn-opts]

# Dependency graph
requires:
  - phase: 03-decision-interrupts-resume
    provides: 03-01 pause half — interrupt terminal emission, module-level pending-interrupt registry (register/get/hasOpen/clear/updateExecutionId), D-04 block-while-pending, Pitfall-5 guard
provides:
  - the resume half of the decision cycle: RunAgentInput.resume[] validated per D-05 (INVALID_INTERRUPT) then translated via translateResumeToSubmission → buildDecisionSubmission and delivered through executeChatTurn / executeHumanTurn (A6 opts seam) so the engine receives the structured decision and continuation events stream on the resume run (CHAT-09 SC2, RUNR-08, D-07)
  - cancelled resumes (A4): registry cleared, executions row 'cancelled', plain RUN_FINISHED with no engine call
  - orphaned waiting_user execution-row finalize (Pitfall 2): resolved → 'completed', cancelled → 'cancelled' — the thread can never wedge after a decision pause
  - registry.clear only after delivery starts (Pitfall 8): duplicate resumes → INVALID_INTERRUPT
  - INVALID_PAYLOAD RUN_ERROR code for answer-less resolved payloads (planner's discretion, recorded in the plan objective)
  - additive opts?: ChatTurnOpts on executeHumanTurn (A6) threaded through coordinator → orchestrator → human-turn-executor to BOTH runNonNative call sites
  - __SCRIPT_DECISION__ Phase B mock-engine continuation script (fires on the translated question text — the e2e proof hook for 03-03)
affects: [03-03 (e2e decision cycle over the real server), phase 5 (resume payload contract documented at translateResumeToSubmission; decision card rendering)]

actuals:
  tokens: 13081
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Pure translation helper delegates to buildDecisionSubmission (Don't Hand-Roll row 3): translateResumeToSubmission never re-formats Q/A pairs; the hidden record_decision instructions stay single-source"
    - "Resume branch placement: AFTER conversation-exists check, BEFORE extractUserText and BEFORE the advisory lock — the lock remains the D-04 block for non-resume runs (Pitfall 1)"
    - "Orphaned-row finalize owned by the resume branch (Pitfall 2): stream-processor.ts:494-506 is the only writer of waiting_user and no existing code closed it"
    - "Terminal closures (guardedComplete/finish/finishInterrupt) hoisted above the resume branch so its synchronous tap wiring can reference finish without a TDZ ReferenceError"
    - "A6 additive optional param on an internal interface: opts?: ChatTurnOpts reaches both runNonNative call sites; the engine.resume() same-execution path untouched (real engines terminate at decision_request)"

key-files:
  created: []
  modified:
    - src/bun/copilotkit/event-bridge.ts — translateResumeToSubmission pure helper + Phase 5 payload contract doc comment
    - src/bun/copilotkit/railyin-agent.ts — the resume branch (D-05 validation, cancelled path, translated delivery, orphaned-row finalize, registry clear after delivery)
    - src/bun/engine/coordinator.ts — executeHumanTurn gains opts?: ChatTurnOpts
    - src/bun/engine/orchestrator.ts — executeHumanTurn wrapper passes opts through (mirrors executeChatTurn)
    - src/bun/engine/execution/human-turn-executor.ts — execute() gains opts, forwarded at both runNonNative call sites (:170 fallback, :276 fresh turn)
    - src/bun/testing/mock-engine.ts — __SCRIPT_DECISION__ Phase B continuation script
    - src/bun/copilotkit/event-bridge.test.ts — "resume translation" describe block (4 tests)
    - src/bun/copilotkit/railyin-agent.test.ts — resume branch describe block (R1-R8) + resume fakes/helpers
    - src/bun/test/execution-seam.test.ts — executeHumanTurn seam describe block (3 tests) + SeamEngine resumeThrows option

key-decisions:
  - "INVALID_PAYLOAD is a distinct RUN_ERROR code for a resolved resume whose payload lacks answers (planner's discretion — research Pattern 2 only sketched id validation; clearer for Phase 5 debugging), instead of reusing INVALID_INTERRUPT"
  - "Execution-row finalize statuses per research: resolved → 'completed', cancelled → 'cancelled'"
  - "The resume branch resolves its own workspaceKey (TDZ guard) — the main-path const after the advisory lock is out of scope at the insertion point; null → THREAD_NOT_FOUND, same as the main path"
  - "Terminal closures hoisted above the resume branch — necessary because the branch's synchronous tap wiring references finish(), which would otherwise be uninitialized (TDZ) when a synchronous fake fires onRunEnd inside the delivery call"

patterns-established:
  - "A6 seam precedent: an additive optional param on an internal interface is fully backward-compatible — existing overrides/stubs with fewer params compile unchanged (TS allows fewer params in overrides)"
  - "Resume contract tests drive the agent through fakes that capture the TRANSLATED submission args and assert delegation output (formatted question text + record_decision instruction) — proving engine delivery without a real engine"
  - "Orphaned-row test seeding: seed the waiting_user row AFTER the decision cycle (stream-processor writes it during the run), with id = the registry's resolved executionId"

requirements-completed: [RUNR-08, CHAT-09, VERF-01]

coverage:
  - id: D1
    description: "translateResumeToSubmission — pure resume payload → decision-submission translation delegating to buildDecisionSubmission (byte-identical, no re-formatting); null for answer-less/malformed payloads; Phase 5 payload contract documented at the call-site boundary (D-07, A1/Open Question 2)"
    requirement: RUNR-08
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/event-bridge.test.ts#resume translation (4 tests: delegation byte-identity, no-answers null, malformed null no-throw, NO_RECORD variant)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A6 seam — additive opts?: ChatTurnOpts on executeHumanTurn threaded coordinator → orchestrator → human-turn-executor to BOTH runNonNative call sites (fresh turn + new-execution fallback); byte-identical when absent; engine.resume() path untouched"
    requirement: CHAT-09
    verification:
      - kind: unit
        ref: "src/bun/test/execution-seam.test.ts#executeHumanTurn seam (3 tests: fresh-turn order + onRunEnd('done'), absent-opts byte-identity, resume-throws fallback via opts)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Resume branch validation — D-05 all-or-nothing: unknown / partial / extra ids → RUN_ERROR INVALID_INTERRUPT with no executor call; duplicate resume after clear → INVALID_INTERRUPT (Pitfall 8); answer-less resolved payload → INVALID_PAYLOAD with the entry surviving for retry"
    requirement: CHAT-09
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#R2 D-05 validation / R6 duplicate resume / R8 INVALID_PAYLOAD"
        status: pass
    human_judgment: false
  - id: D4
    description: "Resume delivery + row finalize — translated submission (userContent + engineContent with hidden record_decision instruction) reaches executeChatTurn/executeHumanTurn (task routing via A6 opts); continuation events stream on the resume run; old waiting_user row finalized (resolved → 'completed', cancelled → 'cancelled'); registry cleared after delivery (Pitfall 8); cancelled resumes complete with plain RUN_FINISHED, no engine call (A4)"
    requirement: CHAT-09
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#R1 full cycle / R3 cancel / R7 routing"
        status: pass
    human_judgment: false
  - id: D5
    description: "Wedge elimination — resume run bypasses the advisory lock (Pitfall 1); after a resolved/cancelled resume the thread is not wedged (Pitfall 2); a plain run against a waiting_user row still gets THREAD_BUSY (03-01 D-04 regression)"
    requirement: VERF-01
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#R4 Pitfall 1 + lock regression / R5 wedge gone"
        status: pass
    human_judgment: false
  - id: D6
    description: "__SCRIPT_DECISION__ Phase B mock-engine script — fires only when the translated question text reached params.prompt via the engineContent path (research Pattern 4); the e2e proof hook for 03-03's full decision cycle over the real server"
    requirement: VERF-01
    verification: []
    human_judgment: true
    rationale: "The Phase B script is consumed by the 03-03 e2e decision-cycle tests, not by a unit test in this plan — coverage at e2e time (same split as 03-01's D7 Phase A)."

# Metrics
duration: 20 min
completed: 2026-08-09
status: complete
---

# Phase 3 Plan 2: Decision Interrupts & Resume — Resume Half Summary

**A resume run (`RunAgentInput.resume[]`) now completes the decision cycle: D-05 all-or-nothing validation against the pending-interrupt registry (INVALID_INTERRUPT), translation through the pure `translateResumeToSubmission` → `buildDecisionSubmission` delegation (never re-formatted), and delivery via `executeChatTurn` / `executeHumanTurn` (new additive A6 `opts` seam) so the engine receives the structured decision and its continuation events stream on the resume run — with cancelled dismissals closing cleanly (no engine call), the orphaned `waiting_user` execution row finalized so the thread can never wedge, and duplicate resumes rejected.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-08-09T06:53:13Z
- **Completed:** 2026-08-09T07:13:01Z
- **Tasks:** 3 (all `tdd="true"`, RED→GREEN per task)
- **Files modified:** 9 (0 new)

## Accomplishments

- `translateResumeToSubmission(payload)` pure helper in event-bridge.ts: validates `answers` is a non-empty array, delegates to `buildDecisionSubmission` (byte-identical output — Q/A pairs and the hidden `record_decision` instructions stay single-source), returns null for answer-less/malformed payloads; doc comment documents the Phase 5 payload contract verbatim (`{ decision, answers?, generalNotes?, recordAsDecisions? }` — A1/Open Question 2)
- A6 seam: `opts?: ChatTurnOpts` additive on `executeHumanTurn` threaded through coordinator → orchestrator → human-turn-executor, forwarded at BOTH runNonNative call sites (new-execution fallback :170 + fresh turn :276); the `engine.resume()` same-execution path untouched — real engines terminate at `decision_request`, the fallback covers them (research Pattern 3)
- Resume branch in `run()`: placed AFTER the conversation-exists check, BEFORE `extractUserText` and BEFORE the advisory lock (Pitfall 1) — D-05 all-or-nothing validation (unknown/partial/extra ids → INVALID_INTERRUPT, no executor call), cancelled path (A4: registry clear + row 'cancelled' + plain RUN_FINISHED, no engine call), resolved path (INVALID_PAYLOAD for answer-less payloads; old `waiting_user` row finalized 'completed' BEFORE delivery — Pitfall 2; workspaceKey resolved inside the branch with a TDZ guard; task-linked routing via `SELECT task_id` → executeHumanTurn with opts, chat → executeChatTurn)
- Registry entry clears only after delivery starts (Pitfall 8) — the R6 duplicate-resume test proves a replay of the same id fails INVALID_INTERRUPT
- Terminal closures (guardedComplete/finish/finishInterrupt) hoisted above the resume branch so its synchronous tap wiring can reference `finish` (TDZ) — documented in a code comment
- `__SCRIPT_DECISION__` Phase B mock-engine script: fires token + done only when the translated question text reaches `params.prompt` via the engineContent path — the 03-03 e2e proof that the engine received the decision (research Pattern 4)
- 12 new unit tests (4 event-bridge translation, 8 resume branch) + 3 real-chain seam tests — full copilotkit dir 79 pass, seam suite 9 pass, full `bun test src/bun` 2358 pass / 0 fail, typecheck clean, e2e copilotkit probe 8 pass

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1: translateResumeToSubmission** - `e05ae96e` (test: failing resume-translation tests) + `70630c57` (feat: pure delegation helper + Phase 5 contract doc)
2. **Task 2: A6 seam (opts on executeHumanTurn)** - `82e76447` (test: failing seam tests — both runNonNative sites) + `f8c8d7b0` (feat: coordinator/orchestrator/executor threading)
3. **Task 3: Agent resume branch** - `c2d43591` (test: failing R1-R8 contract tests) + `43c23a4e` (feat: resume branch + Phase B script)

## Files Created/Modified

- `src/bun/copilotkit/event-bridge.ts` - `translateResumeToSubmission` pure helper + Phase 5 payload contract doc comment (delegation to buildDecisionSubmission, no re-formatting)
- `src/bun/copilotkit/railyin-agent.ts` - resume branch (D-05 validation, cancelled path, translated delivery, orphaned-row finalize, registry clear after delivery); terminal closures hoisted for TDZ safety
- `src/bun/engine/coordinator.ts` - `executeHumanTurn` interface gains `opts?: ChatTurnOpts`
- `src/bun/engine/orchestrator.ts` - executeHumanTurn wrapper passes opts as 5th arg (mirrors executeChatTurn)
- `src/bun/engine/execution/human-turn-executor.ts` - `execute()` gains `opts?`, forwarded at both runNonNative call sites
- `src/bun/testing/mock-engine.ts` - `__SCRIPT_DECISION__` Phase B continuation script
- `src/bun/copilotkit/event-bridge.test.ts` - "resume translation" describe block (delegation byte-identity, null cases, NO_RECORD variant)
- `src/bun/copilotkit/railyin-agent.test.ts` - "resume branch" describe block R1-R8 + resumeInput helper, resume fakes, seedWaitingUserRow, openPendingDecision
- `src/bun/test/execution-seam.test.ts` - "executeHumanTurn seam" describe block (fresh-turn order, absent-opts identity, resume-throws fallback) + SeamEngine resumeThrows option

## Decisions Made

- **INVALID_PAYLOAD code (planner's discretion):** a resolved resume whose payload lacks answers → RUN_ERROR with the new code `INVALID_PAYLOAD` rather than reusing INVALID_INTERRUPT — research Pattern 2 only sketched id validation; the distinct code is clearer for Phase 5 debugging (recorded in the plan objective)
- **Row finalize statuses per research:** resolved → 'completed', cancelled → 'cancelled'
- **TDZ guard:** the resume branch resolves its own `workspaceKey` (the main-path const after the advisory lock is out of scope at the insertion point); null → THREAD_NOT_FOUND, same as the main path
- **Closure hoisting:** guardedComplete/finish/finishInterrupt moved above the resume branch — required so the branch's synchronous tap wiring can call `finish()` (a later const would be in the TDZ when a synchronous fake fires onRunEnd inside the delivery call)

## Deviations from Plan

None - plan executed exactly as written. (The closure-hoisting structural note above is the plan's own required mechanics — the plan specifies the resume branch uses the main-path `finish` mapping while being inserted before `finish` is declared; hoisting is the minimal way to satisfy both constraints, and is documented in a code comment.)

## Issues Encountered

- **Test-harness ordering bug (RED phase):** `openPendingDecision` called `makeAgent` before `setDecisionCycleFake` — the agent captures the fake coordinator by reference at construction, so the first cycle run used the default fake. Fixed by setting the fake first.
- **waiting_user seeding order:** seeding the orphaned executions row BEFORE the decision cycle made the cycle run hit the advisory lock (THREAD_BUSY) — the row is written DURING the run by stream-processor. Reordered to seed after the cycle, with id = the registry's resolved executionId.
- **RunAgentInput typing:** the resume-input assistant message must use string content (the message union types `content` as string for assistant/developer/system roles) — the initial array form failed `tsc`; fixed to string literals.
- **Count-only fakes hang:** fakes that never drive `onRunEnd` leave the subject uncompleted (no terminal) — the resume tests timed out at 20s until the count fakes drove `opts?.onRunEnd?.("done")` (matching the existing test-10 pattern).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready for 03-03** (e2e decision cycle): the mock engine now has BOTH phases (`__SCRIPT_DECISION__` Phase A pause + Phase B continuation on the translated question text), the resume payload contract is documented, and all unit-level contract tests are green — the e2e suite drives the real server through the full cycle (run → interrupt outcome → resume → continuation → replay) and asserts block-while-pending over the wire
- Plan-level verification green: `bun test src/bun/copilotkit` 79 pass, `bun test src/bun/test/execution-seam.test.ts` 9 pass, `bun test e2e/api/copilotkit/copilotkit.test.ts` 8 pass, `bun run typecheck` clean, full `bun test src/bun` 2358 pass / 0 fail (2 pre-existing skips in CopilotDialect personal-scope tests, unrelated)
- No blockers

## Self-Check: PASSED

- Files verified on disk: `src/bun/copilotkit/event-bridge.ts`, `src/bun/copilotkit/railyin-agent.ts`, `src/bun/engine/coordinator.ts`, `src/bun/engine/orchestrator.ts`, `src/bun/engine/execution/human-turn-executor.ts`, `src/bun/testing/mock-engine.ts`, `src/bun/copilotkit/event-bridge.test.ts`, `src/bun/copilotkit/railyin-agent.test.ts`, `src/bun/test/execution-seam.test.ts`, `.planning/phases/03-decision-interrupts-resume/03-02-SUMMARY.md`
- Commits verified: `e05ae96e`, `70630c57`, `82e76447`, `f8c8d7b0`, `c2d43591`, `43c23a4e`
- Plan-level verification green: copilotkit 79 pass, seam 9 pass, e2e probe 8 pass, full backend 2358 pass / 0 fail, typecheck clean

---
*Phase: 03-decision-interrupts-resume*
*Completed: 2026-08-09*

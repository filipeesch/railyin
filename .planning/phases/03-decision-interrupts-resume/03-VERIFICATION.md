---
phase: 03-decision-interrupts-resume
verified: 2026-08-09T12:00:00Z
status: passed
score: 18/18 must-haves verified
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "User receives a decision request as a structured interrupt card with options (ROADMAP SC1 UI portion; REQUIREMENTS.md UI-03 checkbox)"
    addressed_in: "Phase 5"
    evidence: "ROADMAP Phase 5 goal: 'Chat UI Replacement (Vue)' — 'Depends on: Phase 4 (consumes Phase 3's interrupt slot)'; 03-CONTEXT.md deferred list: 'Vue interrupt slot rendering (#interrupt slot, useInterrupt, decision card port) — Phase 5 (UI-03)'; 03-COVERAGE.md UI-03 Coverage Split records the event/payload contract delivered this phase and the rendering closing UI-03 at Phase 5"
  - truth: "While an interrupt is pending, the user cannot send new input via a disabled chat input (ROADMAP SC3 UI portion)"
    addressed_in: "Phase 5"
    evidence: "03-CONTEXT.md phase boundary: 'Deliberately NOT in scope: any Vue UI component work (Phase 5 renders the interrupt slot)'; server-side enforcement (the Phase 3 share) is delivered and e2e-proven (test 12)"
---

# Phase 3: Decision Interrupts & Resume Verification Report

**Phase Goal:** decision_request is the only human-in-the-loop channel, implemented as canonical AG-UI interrupts rendered through CopilotKit's Vue interrupt slot: runs genuinely pause, users approve/reject with structured payloads, and runs resume — proven by fake-engine contract tests
**Verified:** 2026-08-09T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

**Format note (surfaced discrepancy):** The ROADMAP Phase 3 goal is capability-shaped, not a valid user story (`user-story.validate` → `false`). This is a **pre-accepted MVP deviation** recorded in 03-01-PLAN.md ("MVP deviation (accepted, mirrors Phase 2): the ROADMAP Phase 3 goal is capability-shaped, not a user story; the four success criteria drive planning"). Verification therefore ran against the ROADMAP success criteria (the roadmap contract) plus the merged plan must_haves — the contract the plans executed against. The UI-rendering clause of the goal ("rendered through CopilotKit's Vue interrupt slot") is deliberately deferred to Phase 5 per 03-CONTEXT.md; the Phase 3 share (event + payload contract) is verified below.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An engine `decision_request` ends the run with RUN_FINISHED `outcome: { type: "interrupt", interrupts: [...] }` — a NORMAL terminal, no events after it, never RUN_ERROR (D-01/D-03/D-06; RUNR-08) | ✓ VERIFIED | `railyin-agent.ts:211-221` `finishInterrupt` (closer/synthesize/complete, `buildInterruptOutcome` terminal); unit 12/13/16 pass; e2e 11 asserts interrupt frame is the FINAL frame with no RUN_ERROR — all passing |
| 2 | Interrupt id stable per decision batch, NEVER derived from executionId (`decision-${conversationId}-${seq}`, per-thread counter — Pitfall 3) | ✓ VERIFIED | `interrupt-registry.ts:135-148` `register()` mints from per-thread seq; unit 14/15 pass; e2e 11 asserts `/^decision-\d+-\d+$/` |
| 3 | Pending interrupt lives in a module-level per-thread registry that survives agent cloning (Pitfall 4) and resets between tests | ✓ VERIFIED | Module-level `Map`s in `interrupt-registry.ts:39-41` (not agent fields); `reset()` test hook (:169); 6 lifecycle tests pass |
| 4 | While pending, a new run WITHOUT `resume[]` is rejected server-side with RUN_ERROR THREAD_BUSY + precise message (D-04; CHAT-09 SC3) | ✓ VERIFIED | `railyin-agent.ts:428-431` (before extractUserText); unit 17/18 pass; e2e 12 asserts `code: "THREAD_BUSY"` over the wire |
| 5 | A `decision_request` without subsequent `onRunEnd` still ends with the interrupt terminal (Pitfall 5) | ✓ VERIFIED | WR-02 guard `railyin-agent.ts:495-515` (queueMicrotask → register + finishInterrupt); unit 19 passes |
| 6 | Every interrupt event zod-parses via EventSchemas; `metadata` carries the parsed DecisionRequestPayload (UI-03 event-contract split) | ✓ VERIFIED | `buildInterruptOutcome` (`event-bridge.ts:342-378`) validated through the `assertValid` harness (EventSchemas); unit 13/16 + bridge "interrupt outcome" block pass; e2e 11 asserts `metadata.context` + `metadata.questions` over the wire |
| 7 | A resume run carries `RunAgentInput.resume[]` to the agent; D-05 validation: open match, ALL open addressed, unknown/partial/duplicate → RUN_ERROR INVALID_INTERRUPT (CHAT-09 SC2; Pitfall 8) | ✓ VERIFIED | `railyin-agent.ts:250-268` all-or-nothing + IN-02 duplicate rejection; unit R2/R6/R13 pass; e2e 14 asserts INVALID_INTERRUPT over the wire |
| 8 | A `status: "cancelled"` resume clears the registry, closes the executions row (`status='cancelled'`), completes with plain RUN_FINISHED — no engine call (A4) | ✓ VERIFIED | `railyin-agent.ts:276-293`; unit R3 passes; e2e 15 passes (thread usable afterward) |
| 9 | A `status: "resolved"` resume translates via `translateResumeToSubmission` → `buildDecisionSubmission` (never re-formatted) and delivers through executeChatTurn/executeHumanTurn; continuation events stream (D-07) | ✓ VERIFIED | `event-bridge.ts:402-423` delegation; `railyin-agent.ts:309-421` delivery with tap wiring; unit R1/R7 pass; e2e 13 asserts "Decision received, continuing." + RUN_FINISHED + `input.resume[0].interruptId` persisted to JSONL |
| 10 | Resume branch runs BEFORE extractUserText and BEFORE the advisory lock (Pitfall 1); the orphaned `waiting_user` row is finalized so the thread never wedges (Pitfall 2) | ✓ VERIFIED | Branch at `railyin-agent.ts:242` precedes extractUserText (:433) and the lock (:446); row finalize :337-343 (resolved) / :282-288 (cancelled) with `resolveDecisionExecutionId` DB fallback (:122-130); unit R4/R5/R9 pass |
| 11 | Registry entry clears only AFTER the translated execution starts — duplicate resume rejected INVALID_INTERRUPT (Pitfall 8) | ✓ VERIFIED | `railyin-agent.ts:404-407` clear guarded on the original interrupt id (WR-04); unit R6 passes |
| 12 | `executeHumanTurn` accepts additive `opts?: ChatTurnOpts` (A6) so task-linked resume runs stream AG-UI events; byte-identical when absent | ✓ VERIFIED | `coordinator.ts:14`, `orchestrator.ts:146-148`, `human-turn-executor.ts:53/183/289` (both runNonNative sites); seam tests 1-4 pass |
| 13 | On the REAL wire: `__SCRIPT_DECISION__` ends with interrupt outcome as LAST frame; plain run while pending → THREAD_BUSY; translated resume streams continuation and persists input.resume[] to JSONL | ✓ VERIFIED | e2e 11/12/13 pass over a spawned server (19/19 in `railyin.test.ts`) |
| 14 | D-05 violations fail over the wire; `forwardedProps.command.resume` alone does nothing (D-01, Pitfall 6) | ✓ VERIFIED | e2e 14 (INVALID_INTERRUPT) and e2e 16 (forwardedProps inert → THREAD_BUSY) pass |
| 15 | A cancelled resume over the wire completes plainly and the thread is usable afterward (A4) | ✓ VERIFIED | e2e 15 passes (incl. the executionId-race fix R9) |
| 16 | Replay preserves interrupt terminals and resume[] entries verbatim across per-run boundaries (D-08, Pitfall 7) | ✓ VERIFIED | `railyin-runner.test.ts` 6a (interrupt terminal verbatim, final frame) / 6b (input.resume survives compaction) pass |
| 17 | Post-restart resume works: registry lazily rebuilds from JSONL tail + `waiting_user` row; agent falls back `get() → ensureOpen(threadId, this.db)` (A2) | ✓ VERIFIED | `interrupt-registry.ts:67-127` ensureOpen (same-id re-registration, WR-02 liveness row check); `railyin-agent.ts:248-249` fallback; rebuild tests C/C2/C3/D pass; e2e 17 two-server restart resume passes |
| 18 | Phase gate closes green: full suites + typecheck; 03-COVERAGE.md (no-external-API + UI-03 split) and 03-VALIDATION.md (nyquist_compliant: true) | ✓ VERIFIED | Re-run: copilotkit 93 pass/0 fail, seam 11 pass/0 fail, e2e copilotkit 35 pass/0 fail, typecheck exit 0; both records exist with the declared frontmatter |

**Score:** 18/18 truths verified (0 present, behavior-unverified)

**Behavioral evidence:** Every behavior-dependent truth (state transitions: pause, block, resume delivery, cancel, wedge elimination, replay, restart-rebuild) is exercised by a passing behavioral test — fake-engine unit contract tests (12-19, R1-R13, 6a/6b, C/C2/C3/D) and real-wire e2e tests 11-17 (spawned servers, SSE parsed). No truth rests on symbol presence alone.

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases (per ROADMAP + 03-CONTEXT.md + 03-COVERAGE.md — NOT gaps for this phase):

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Interrupt card rendering (SC1 UI portion; UI-03 checkbox closure) | Phase 5 | ROADMAP Phase 5 "Depends on: Phase 4 (consumes Phase 3's interrupt slot)"; CONTEXT deferred list; COVERAGE UI-03 split records the contract handoff |
| 2 | Disabled chat input while pending (SC3 UI portion) | Phase 5 | CONTEXT phase boundary ("any Vue UI component work (Phase 5)"); server-side enforcement delivered this phase (e2e 12) |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ---------| ------ | ------- |
| `src/bun/copilotkit/interrupt-registry.ts` | module singleton: register/get/hasOpen/clear/updateExecutionId/reset + configure/ensureOpen | ✓ VERIFIED | 172 lines, substantive; lifecycle + rebuild tests pass |
| `src/bun/copilotkit/event-bridge.ts` | `buildInterruptOutcome` + `translateResumeToSubmission` pure helpers | ✓ VERIFIED | 423 lines; bridge stays terminal-free; EventSchemas-validated |
| `src/bun/copilotkit/railyin-agent.ts` | finishInterrupt, D-04 block, WR-02 guard, resume branch, ensureOpen fallback, resolveDecisionExecutionId | ✓ VERIFIED | 562 lines; all review-fix branches present (CR-01, WR-03, WR-04, IN-01, IN-02) |
| `src/bun/testing/mock-engine.ts` | `__SCRIPT_DECISION__` Phase A + Phase B scripts | ✓ VERIFIED | Phase A: token + decision_request, no done; Phase B: fires on `Choose __DECISION_OPTION__` |
| `src/bun/engine/coordinator.ts` / `orchestrator.ts` / `execution/human-turn-executor.ts` | A6 `opts?: ChatTurnOpts` seam | ✓ VERIFIED | Threaded to both runNonNative call sites; engine.resume path untouched |
| `src/bun/index.ts` | `interruptRegistry.configure({ store })` non-probe path only | ✓ VERIFIED | Line 298, gated `!copilotProbeEnabled` |
| `src/bun/conversation/decision-submission.ts` | WR-06 sanitizer + `<decision_answers>` container | ✓ VERIFIED | Angle-bracket escaping of all client text |
| `src/bun/engine/stream/stream-processor.ts` | WR-01 accumulator flush on decision_request | ✓ VERIFIED | reasoningAccum/tokenAccum flushed to convBuffer before the prompt enqueue |
| `e2e/api/copilotkit/railyin.test.ts` | tests 11-17 decision cycle | ✓ VERIFIED | 19/19 pass over real wire |
| `03-COVERAGE.md` / `03-VALIDATION.md` | no-external-API record + UI-03 split; signed-off validation | ✓ VERIFIED | Both exist; `nyquist_compliant: true`, `wave_0_complete: true` |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| onEngineEvent tap | onRunEnd("decision") | `capturedDecisionPayload` closure | ✓ WIRED | `railyin-agent.ts:480` capture; :520-525 register+finishInterrupt |
| finishInterrupt | finish() sequence | closer/synthesize/complete/clear | ✓ WIRED | `railyin-agent.ts:211-221` mirrors :182-205 exactly |
| Registry id | conversationId + per-thread seq (not executionId) | `register()` | ✓ WIRED | `interrupt-registry.ts:135-148`; unit 14/15 |
| D-04 block | conversation-exists check region | placement before extractUserText | ✓ WIRED | `railyin-agent.ts:428` after :227-234 check |
| Interrupt outcome | EventSchemas | `assertValid` harness | ✓ WIRED | unit 13/16 + bridge block; e2e 11 |
| Resume branch | before extractUserText + advisory lock | placement | ✓ WIRED | `railyin-agent.ts:242` vs :433/:446 |
| translateResumeToSubmission | buildDecisionSubmission | delegation, no re-format | ✓ WIRED | `event-bridge.ts:422`; byte-identity test passes |
| Registry clear | after delivery start | `.then` hook | ✓ WIRED | `railyin-agent.ts:404-407`; R6 proves duplicate → INVALID_INTERRUPT |
| A6 opts | both runNonNative call sites | additive param | ✓ WIRED | `human-turn-executor.ts:183/:289`; seam tests 1-4 |
| configure | composition root, non-probe | index.ts:298 | ✓ WIRED | Probe path untouched (probe e2e 8 pass) |
| get() → ensureOpen | agent resume branch cold path | fallback | ✓ WIRED | `railyin-agent.ts:248-249`; e2e 17 proves it |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| interrupt terminal metadata | parsed payload | engine `decision_request` payload → JSON.parse → `metadata` | ✓ (e2e 11 asserts `context` + `questions`) | ✓ FLOWING |
| resume continuation | translated userContent/engineContent | `translateResumeToSubmission` → `buildDecisionSubmission` → executor `params.prompt` | ✓ (e2e 13 asserts Phase B continuation text) | ✓ FLOWING |
| JSONL persistence | `input.resume[0].interruptId` | RUN_STARTED with input → runner store | ✓ (e2e 13 reads the file from disk) | ✓ FLOWING |
| rebuild payload | persisted metadata | JSONL tail terminal → `JSON.stringify(metadata)` | ✓ (rebuild test C) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Copilotkit unit suite (interrupt/resume/rebuild/replay) | `bun test src/bun/copilotkit --timeout 20000` | 93 pass / 0 fail | ✓ PASS |
| A6 seam + WR-01 + IN-03 | `bun test src/bun/test/execution-seam.test.ts --timeout 20000` | 11 pass / 0 fail | ✓ PASS |
| Real-wire decision cycle 11-17 | `bun test e2e/api/copilotkit/railyin.test.ts --timeout 30000` | 19 pass / 0 fail | ✓ PASS |
| Probe + full e2e copilotkit regression | `bun test e2e/api/copilotkit --timeout 30000` | 35 pass / 0 fail | ✓ PASS |
| Typecheck | `bun run typecheck` | exit 0, 0 errors | ✓ PASS |

### Probe Execution

No probe scripts declared by the plans (probe-path regression covered via `e2e/api/copilotkit/copilotkit.test.ts` within the 35-test directory run above). N/A.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| RUNR-08 | 03-01/02/03 | Runner emits RUN_FINISHED outcome.interrupt + resume[] entries | ✓ SATISFIED | e2e 11-17; unit 12/13/16; replay 6a/6b |
| CHAT-09 | 03-01/02/03 | Approve/reject as structured cards; run pauses and resumes with payload | ✓ SATISFIED (Phase 3 server-side share) | e2e 12/13/15/17; unit R1-R13; card rendering deferred to Phase 5 per CONTEXT |
| UI-03 | 03-01, 03-03 | Decision-request UX as interrupt cards | ✓ SATISFIED (contract share) | `metadata` = parsed DecisionRequestPayload (e2e 11); resume payload contract documented at `translateResumeToSubmission`; rendering + checkbox closure deferred to Phase 5 (03-COVERAGE.md split) |
| VERF-01 | 03-01/02/03 | Unit tests with fake engine — events, interrupts, replay | ✓ SATISFIED | fake-engine contract tests (tests 12-19, R1-R13, 6a/6b, C/C2/C3/D) + real-wire e2e 11-17 |

**Orphaned requirements:** none — all four phase IDs appear in plan frontmatter (03-01: all 4; 03-02: RUNR-08/CHAT-09/VERF-01; 03-03: all 4) and are satisfied as scoped.

### Review-Fix Verification (11 findings, commits 6bdfaa73..cc60de93)

| Finding | Fix present in code | Test evidence |
| ------- | ------------------- | ------------- |
| CR-01 double RUN_STARTED on INVALID_PAYLOAD | ✓ translation + workspaceKey resolved before RUN_STARTED (`railyin-agent.ts:295-330`) | ✓ R8 asserts exactly one RUN_STARTED (passing) |
| WR-01 dropped tokens on decision_request | ✓ flush in stream-processor decision_request case | ✓ seam test 3e (passing) |
| WR-02 stale rebuild without waiting_user row | ✓ ensureOpen requires the row (`interrupt-registry.ts:107-116`) | ✓ rebuild test C3 (passing) |
| WR-03 -1 guard on resume | ✓ `railyin-agent.ts:390-393` | ✓ R10 (passing) |
| WR-04 clear() wiping continuation interrupt | ✓ clear guarded on original id (`:404-407`) | ✓ R11 (passing) |
| WR-05 malformed answers crash | ✓ element validation (`event-bridge.ts:412-421`) | ✓ R12 + bridge test 3a (passing) |
| WR-06 prompt injection via answers | ✓ `<decision_answers>` container + escaping | ✓ bridge injection test (passing) |
| WR-07 schema-invalid metadata | ✓ non-object parse falls to fallback (`:356-358`) | ✓ bridge round-trip test (passing) |
| IN-01 dead anyEventSeen | ✓ removed (grep: no matches) | ✓ suite green |
| IN-02 duplicate resume ids pass allResolved | ✓ Set-size check (`:264`) | ✓ R13 (passing) |
| IN-03 fallback overwrites completed row | ✓ status-filtered updates in human-turn-executor | ✓ seam test 4 (passing) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | none | — | — |

No TBD/FIXME/XXX markers, no placeholder/stub patterns, no hardcoded-empty returns in any phase-modified production file.

### Human Verification Required

None. Every must-have is backed by a passing automated behavioral test (fake-engine unit contract tests + real-wire e2e over spawned servers). The only user-visible items (interrupt card rendering, disabled chat input) are explicit Phase 5 deliverables deferred by ROADMAP/CONTEXT — recorded in Deferred Items above, not open Phase 3 verification items.

### Gaps Summary

No gaps. All 18 merged must-haves (4 ROADMAP success criteria + 14 plan-level truths) verified against the codebase, all 11 code-review findings confirmed fixed with passing regression tests, all four requirement IDs accounted for and satisfied as scoped, and the phase-gate suites re-run green in this verification (copilotkit 93, seam 11, e2e copilotkit 35, typecheck 0 errors).

---

_Verified: 2026-08-09T12:00:00Z_
_Verifier: the agent (gsd-verifier)_

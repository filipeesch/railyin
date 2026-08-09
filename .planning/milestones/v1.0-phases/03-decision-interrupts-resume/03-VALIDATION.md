---
phase: 3
slug: decision-interrupts-resume
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-09
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Completed by 03-03 Task 3: verification map ticked, Wave 0 checklist checked,
> open-question resolutions recorded, assumption-deltas documented, sign-off
> approved. All suites green at phase close (2026-08-09): backend 2362 pass /
> 2 skip, e2e/api 74 pass (incl. the Phase 1 probe regression + decision-cycle
> tests 11-17), typecheck 0 errors.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest under `bun test` (backend) + bun:test (e2e/api) |
| **Config file** | `vitest.backend.config.ts`, `vitest.config.ts` |
| **Quick run command** | `bun test src/bun/copilotkit --timeout 20000` (85 tests across 5 files) + `bun test src/bun/test/execution-seam.test.ts --timeout 20000` (9 tests) |
| **Full suite command** | `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck` |
| **Estimated runtime** | ~2 minutes (actual ~2.5 min incl. the restart-replay + two-server decision-cycle e2e accommodations) |

---

## Sampling Rate

- **After every task commit:** Run the phase's unit tests (`bun test src/bun/copilotkit --timeout 20000`)
- **After every plan wave:** Full suite (above)
- **Before `/gsd-verify-work`:** Full suite must be green — **DONE (see below)**
- **Max feedback latency:** ~2 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01 T1 | 01 | 1 | RUNR-08, VERF-01 | T-03-01 | Interrupt terminal emission: decision_request → RUN_FINISHED outcome.interrupt (reason/message/metadata, defensive payload parse), exactly one terminal, never RUN_ERROR | unit | `bun test src/bun/copilotkit/event-bridge.test.ts && bun test src/bun/copilotkit/railyin-agent.test.ts` | ✅ | ✅ green — 26/26 + 33/33 |
| 03-01 T2 | 01 | 1 | RUNR-08, CHAT-09 | T-03-02 | Module-level per-thread registry: id scheme decision-\<conv\>-\<seq\>, executionId-independent, clear keeps seq, reset test hook | unit | `bun test src/bun/copilotkit/interrupt-registry.test.ts` | ✅ | ✅ green — 6/6 lifecycle |
| 03-01 T3 | 01 | 1 | CHAT-09 | T-03-02 | D-04 block-while-pending (RUN_ERROR THREAD_BUSY, no executeChatTurn), Pitfall-5 guard (decision_request without onRunEnd still terminates with the interrupt outcome) | unit | `bun test src/bun/copilotkit/railyin-agent.test.ts` | ✅ | ✅ green — 3/3 (tests 17-19) |
| 03-02 T1 | 02 | 2 | RUNR-08, CHAT-09 | — | translateResumeToSubmission pure helper: answers-validated delegation to buildDecisionSubmission (byte-identical, no re-formatting), null for malformed, Phase 5 payload contract documented | unit | `bun test src/bun/copilotkit/event-bridge.test.ts` | ✅ | ✅ green — 4/4 resume-translation |
| 03-02 T2 | 02 | 2 | CHAT-09 | — | A6 seam: additive opts?: ChatTurnOpts on executeHumanTurn threaded coordinator → orchestrator → human-turn-executor at BOTH runNonNative sites; absent-opts byte-identity | unit (real chain) | `bun test src/bun/test/execution-seam.test.ts` | ✅ | ✅ green — 3/3 seam |
| 03-02 T3 | 02 | 2 | RUNR-08, CHAT-09, VERF-01 | Pitfall 1/2/8 | Resume branch: D-05 all-or-nothing validation (INVALID_INTERRUPT), cancelled dismissal (A4, row 'cancelled'), translated delivery + orphaned-row finalize ('completed'), registry clear after delivery, __SCRIPT_DECISION__ Phase B script | unit | `bun test src/bun/copilotkit/railyin-agent.test.ts` | ✅ | ✅ green — 8/8 (R1-R8) |
| 03-03 T1 | 03 | 3 | RUNR-08, CHAT-09, VERF-01 | D-01/D-03/D-04/D-05, A4, Pitfall 6 | Real-wire decision cycle (e2e 11-16): interrupt terminal, block-while-pending, translated resume + JSONL resume[] assertion, INVALID_INTERRUPT, cancel + thread-usable-after, forwardedProps inert | e2e/api | `bun test e2e/api/copilotkit/railyin.test.ts` | ✅ | ✅ green — 6/6 (11-16) |
| 03-03 T2 | 03 | 3 | RUNR-08, VERF-01 | T-03-12/13/14/15 | Replay resilience + post-restart resume: Replay A/B shape pins (interrupt terminal + resume[] survive cold replay), rebuild C/C2/D (lazy registry rebuild from JSONL tail + waiting_user row, same id, seq continuity), e2e 17 (two-server restart resume over the durable dataDir) | unit + e2e/api | `bun test src/bun/copilotkit/railyin-runner.test.ts && bun test src/bun/copilotkit/interrupt-registry.test.ts && bun test e2e/api/copilotkit/railyin.test.ts` | ✅ | ✅ green — 12/12 + 3/3 rebuild + 17/17 |
| 03-03 T3 | 03 | 3 | phase gate | — | Full backend + e2e suites + typecheck green in one pass | full suite | `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck` | — | ✅ green — 2362 pass / 2 skip; 74 pass; 0 errors |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — commands carry no `-x` flag (invalid on bun 1.4.0).*

---

## Wave 0 Requirements

- [x] Mock-engine decision_request script scenarios — `__SCRIPT_DECISION__` Phase A (token + decision_request, run pauses at the interrupt) in `src/bun/testing/mock-engine.ts` (03-01) and Phase B continuation (fires only when the translated question text reaches the engine prompt) (03-02)
- [x] Contract-test fixtures for interrupt outcome + resume arrays — `buildInterruptOutcome` / `translateResumeToSubmission` unit fixtures (`event-bridge.test.ts`), resume-input helpers + R-tests (`railyin-agent.test.ts`), registry rebuild fixtures (`interrupt-registry.test.ts`), replay-shape logs (`railyin-runner.test.ts`), and the e2e decision-cycle suite (`railyin.test.ts` tests 11-17)

*Existing infrastructure covers the rest (Phase 2 suites).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None — all phase behaviors automated | — | — | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 2min
- [x] `nyquist_compliant: true` set in frontmatter
- [x] Open-question resolutions recorded (03-RESEARCH.md Open Questions):
  - Q1 (post-restart pending interrupts: rebuild or reject) → **RESOLVED — REBUILD** — 03-03 Task 2: `interruptRegistry.configure({ store })` + `ensureOpen(threadId, db)` lazily rebuilds from the thread's JSONL tail (last interrupt terminal) + the `waiting_user` executions row; agent resume branch falls back `get() → ensureOpen()` on a fresh process; proven by rebuild unit tests C/C2/D + e2e test 17 (two-server restart resume)
  - Q2 (resume payload contract) → **RESOLVED** — 03-02 Task 1: contract `{ decision, answers?, generalNotes?, recordAsDecisions? }` documented at the single source of truth `translateResumeToSubmission` (Phase 5 must match it); a resolved resume without answers → INVALID_PAYLOAD
  - Q3 (workspace key for resume delivery) → **RESOLVED** — 03-02 Task 3: the resume branch resolves its own `resolveWorkspaceKey` (TDZ guard; null → THREAD_NOT_FOUND, same as the main path); task-linked conversations route through executeHumanTurn via the A6 opts seam
- [x] Assumption-deltas recorded:
  - THREAD_BUSY keeps the stable code (e2e asserts the code) with the registry adding the precise message "A decision interrupt is pending for this thread" (03-01)
  - INVALID_PAYLOAD is a distinct RUN_ERROR code for a resolved resume whose payload lacks answers (03-02 — planner's discretion, clearer for Phase 5 debugging than reusing INVALID_INTERRUPT)
  - e2e test 17 requires the SQLite DB to survive restarts — the e2e fixture gained the additive `durableDb` option (RAILYN_DB file in the dataDir, `--memory-db` dropped), making the plan's "durable truth that survives restarts" assumption true in the test (03-03)
  - The resume branches finalize the orphaned `waiting_user` row via the durable DB fallback when the registry's executionId races the resume (03-03 — real-wire race exposed by e2e test 15, fixed with `resolveDecisionExecutionId`)

**Approval:** approved — phase gate green 2026-08-09 (backend 2362 pass / 2 skip, e2e/api 74 pass, typecheck 0 errors)

---
phase: 03-decision-interrupts-resume
plan: 03
subsystem: api
tags: [ag-ui, interrupt, resume, decision_request, e2e, registry-rebuild, replay, copilotkit, restart]

# Dependency graph
requires:
  - phase: 03-decision-interrupts-resume
    provides: 03-01 pause half (interrupt terminal + module registry + D-04 block) and 03-02 resume half (D-05 validation, translated delivery, cancelled path, orphaned-row finalize, A6 seam)
provides:
  - the real-wire proof of the full decision cycle (e2e tests 11-17 over a spawned server): interrupt-outcome terminal (D-03), block-while-pending (D-04), translated resume streaming continuation frames with input.resume[] persisted to JSONL (CHAT-09 SC2), INVALID_INTERRUPT (D-05), cancelled dismissal + thread-usable-after (A4), forwardedProps.command.resume inert (D-01/Pitfall 6)
  - the post-restart resume capability: module-level registry lazy rebuild (configure({ store }) + ensureOpen(threadId, db)) from the thread's JSONL tail + the waiting_user executions row — same persisted interruptId, metadata round-trip, seq counter continuity — with the agent's resume branch falling back get() → ensureOpen() on a fresh process (A2/Open Question 1, old-stack parity)
  - the executionId-race fix: resume branches finalize the orphaned waiting_user row via the durable DB fallback (resolveDecisionExecutionId) when the registry's executionId attaches after the client's machine-fast resume
  - replay shape pins: interrupt terminals and resume runs' input.resume[] survive the cold-replay pipeline verbatim (D-08, Pitfall 7)
  - the additive durableDb e2e fixture option (RAILYN_DB file + no --memory-db) so a two-server restart test can carry conversations + executions across processes
  - phase close-out records: 03-COVERAGE.md (no-external-API decision + UI-03 contract split) and 03-VALIDATION.md sign-off (nyquist_compliant: true)
affects: [phase 5 (UI-03: renders the #interrupt card from the metadata contract; the resume payload contract at translateResumeToSubmission is the Phase 5 useInterrupt input), phase 4 (thread-index), /gsd-verify-work (phase gate)]

actuals:
  tokens: 13608
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Module-level registry with composition-root store injection (configure({ store })) + lazy rebuild (ensureOpen) — the rebuild reuses JsonlStore.read's tolerant parser and the executions-row correlation, never a new id (T-03-15)"
    - "Durable-truth executionId resolution: registry attach can race a machine-fast resume, so resume branches fall back to the executions waiting_user row (same correlation the rebuild uses)"
    - "Additive e2e fixture option (durableDb) — no existing test changes; the restart-replay contract extends from JSONL-only to JSONL + SQLite"

key-files:
  created:
    - .planning/phases/03-decision-interrupts-resume/03-COVERAGE.md
  modified:
    - e2e/api/copilotkit/railyin.test.ts — decision-cycle describe (tests 11-17) + resumeInput helper
    - e2e/api/fixtures/server.ts — durableDb option (RAILYN_DB file, --memory-db dropped)
    - src/bun/copilotkit/interrupt-registry.ts — configure({ store }) + ensureOpen(threadId, db)
    - src/bun/copilotkit/railyin-agent.ts — resume-branch cold-path fallback + resolveDecisionExecutionId
    - src/bun/index.ts — interruptRegistry.configure in the non-probe path
    - src/bun/copilotkit/interrupt-registry.test.ts — rebuild tests C/C2/D
    - src/bun/copilotkit/railyin-runner.test.ts — replay shape pins 6a/6b
    - src/bun/copilotkit/railyin-agent.test.ts — R9 race-regression test
    - .planning/phases/03-decision-interrupts-resume/03-VALIDATION.md — completed sign-off

key-decisions:
  - "e2e test 17 requires the SQLite DB to survive restarts — the e2e fixture gained the additive durableDb option (RAILYN_DB=<dataDir>/railyn.db, --memory-db dropped); without it the plan's 'row is the durable truth that survives restarts' assumption is false on the fixture (which always used --memory-db) and the resume would hit THREAD_NOT_FOUND on the fresh server"
  - "ensureOpen's 'no row → null' reads as 'no log terminal → null; the waiting_user row only supplies the executionId' — a terminal without a row rebuilds with executionId null (rejected-with-clean-INVALID_INTERRUPT semantics only when nothing is rebuildable, T-03-12)"
  - "The executionId-race fix (Rule 1): resolveDecisionExecutionId falls back to the executions waiting_user row because the registry's executionId attaches in the executeChatTurn .then hook — after the interrupt terminal reaches the client — and a machine-fast resume can fire first (exposed by e2e test 15)"

patterns-established:
  - "Rebuild = read-only tolerant scan (JsonlStore.read skips malformed lines) + backwards search for the LAST interrupt terminal + row correlation; never mints a new id — the client resumes the persisted id"
  - "Two-server e2e contract extension: durable dataDir (JSONL) + durableDb (SQLite) — the full post-restart decision cycle is provable in one test"

requirements-completed: [RUNR-08, CHAT-09, UI-03, VERF-01]

coverage:
  - id: D1
    description: "Real-wire decision cycle (e2e 11-16): __SCRIPT_DECISION__ ends RUN_FINISHED outcome.interrupt (D-03, metadata = parsed DecisionRequestPayload); plain run while pending → THREAD_BUSY (D-04); translated resume streams continuation and persists input.resume[] to JSONL (CHAT-09 SC2); unknown interruptId → INVALID_INTERRUPT (D-05); cancelled resume completes plainly with the thread usable after (A4); forwardedProps.command.resume inert (D-01, Pitfall 6)"
    requirement: RUNR-08
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/railyin.test.ts#decision cycle describe — tests 11-16"
        status: pass
    human_judgment: false
  - id: D2
    description: "Registry lazy rebuild (A2): configure({ store }) + ensureOpen(threadId, db) restores the SAME persisted interruptId, round-trips metadata into the payload, correlates the waiting_user executions row for the executionId, and bumps the per-thread seq counter (decision-7-3 → next register mints decision-7-4); backwards scan survives a later resume run (C2); null when nothing is rebuildable (D)"
    requirement: RUNR-08
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/interrupt-registry.test.ts#lazy rebuild describe — C, C2, D"
        status: pass
    human_judgment: false
  - id: D3
    description: "Post-restart resume (e2e 17): server A pauses a decision; a fresh server B over the same durable dataDir + durable DB replays the interrupt card on connect and resumes with continuation frames — the agent's get() → ensureOpen(threadId, this.db) fallback makes the resume reach the rebuild"
    requirement: CHAT-09
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/railyin.test.ts#17: post-restart resume"
        status: pass
    human_judgment: false
  - id: D4
    description: "Replay resilience (D-08, Pitfall 7): the cold-replay pipeline re-emits an interrupt terminal verbatim as the LAST frame — never an INCOMPLETE_STREAM RUN_ERROR (6a) — and a resume run's RUN_STARTED.input.resume[0].interruptId survives compaction across per-run boundaries (6b)"
    requirement: VERF-01
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/railyin-runner.test.ts#6a Replay A / 6b Replay B"
        status: pass
    human_judgment: false
  - id: D5
    description: "ExecutionId-race fix (Rule 1): a registry entry without the attached executionId still finalizes the waiting_user row via the DB fallback — cancelled → 'cancelled', resolved → 'completed' — so the thread never wedges on a machine-fast resume (R9 unit + e2e 15)"
    requirement: CHAT-09
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/railyin-agent.test.ts#R9: machine-fast resume race"
        status: pass
      - kind: e2e
        ref: "e2e/api/copilotkit/railyin.test.ts#15: cancelled resume completes plainly and the thread stays usable"
        status: pass
    human_judgment: false
  - id: D6
    description: "03-COVERAGE.md — no-external-API decision record (in-process translation via installed SDKs; only HTTP surface is the app's own loopback origin) + the UI-03 coverage split (Phase 3 delivers the interrupt event contract via metadata = parsed DecisionRequestPayload and the resume payload contract at translateResumeToSubmission; the #interrupt card rendering closes UI-03 at Phase 5)"
    requirement: UI-03
    verification:
      - kind: other
        ref: ".planning/phases/03-decision-interrupts-resume/03-COVERAGE.md (exists — detector record, rationale table, UI-03 split section)"
        status: pass
    human_judgment: false
  - id: D7
    description: "03-VALIDATION.md sign-off — per-task verification map all green (9 tasks across 03-01..03-03 with test counts), Wave 0 checklist checked (__SCRIPT_DECISION__ + interrupt fixtures), Q1/Q2/Q3 resolutions recorded, assumption-deltas documented, nyquist_compliant: true, wave_0_complete: true, approval approved"
    requirement: VERF-01
    verification:
      - kind: other
        ref: ".planning/phases/03-decision-interrupts-resume/03-VALIDATION.md (frontmatter nyquist_compliant: true + completed sign-off)"
        status: pass
    human_judgment: false

# Metrics
duration: 12 min
completed: 2026-08-09
status: complete
---

# Phase 3 Plan 3: Decision Interrupts & Resume — Real-Wire Proof & Resilience Summary

**The full decision cycle is now proven over the real wire (e2e tests 11-17): an engine decision_request ends a run with the canonical RUN_FINISHED interrupt terminal, plain runs block while pending, a translated resume streams continuation frames with `input.resume[]` persisted to JSONL, D-05 rejections and cancelled dismissals behave per contract, the legacy `forwardedProps` channel is inert — and a decision paused before a server restart remains answerable because the module-level registry lazily rebuilds from the thread's JSONL tail + the `waiting_user` executions row (`configure({ store })` + `ensureOpen(threadId, db)`), with replay shape pins proving interrupted runs and resume runs re-emit verbatim.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-09T07:17Z
- **Completed:** 2026-08-09T07:29Z
- **Tasks:** 3 (Tasks 1-2 `tdd="true"` — test commit then fix/feat commit)
- **Files modified:** 10 (1 new)

## Accomplishments

- **Real-wire decision-cycle suite (e2e 11-16):** interrupt-outcome terminal with metadata = parsed DecisionRequestPayload (D-03), block-while-pending THREAD_BUSY (D-04), translated resume streaming "Decision received, continuing." with the resume run's RUN_STARTED `input.resume[0].interruptId` asserted on disk (CHAT-09 SC2/RUNR-08), INVALID_INTERRUPT for unknown ids (D-05), cancelled dismissal with the thread usable afterward (A4), and `forwardedProps.command.resume` proven inert (D-01, Pitfall 6)
- **Registry lazy rebuild (A2):** `configure({ store })` (composition-root injection, non-probe path only) + `ensureOpen(threadId, db)` — backwards scan for the LAST interrupt terminal in the thread log, SAME persisted interruptId restored (never minted, T-03-15), metadata round-tripped into the payload, `waiting_user` executions row correlated for the executionId, per-thread seq counter bumped for continuity; null when nothing is rebuildable (T-03-12 — clean INVALID_INTERRUPT, never a crash)
- **Agent cold-path fallback:** the resume branch now does `get(threadId) → null ⇒ ensureOpen(threadId, this.db)` — the D-04 hasOpen block and hot path stay on `get()`; e2e test 17 proves a decision paused on server A is answerable on a fresh server B over the same durable dataDir (interrupt card replays on connect, resume streams continuation)
- **Replay shape pins (6a/6b):** the cold-replay pipeline re-emits interrupt terminals verbatim as the final frame (no INCOMPLETE_STREAM RUN_ERROR) and preserves `input.resume[]` across per-run boundaries — no runner code change needed (empirically verified, pinned)
- **ExecutionId-race fix (Rule 1):** e2e test 15 exposed that the registry's executionId attaches in the `executeChatTurn` .then hook — AFTER the interrupt terminal reaches the client — so a machine-fast resume saw `executionId: null` and skipped the orphaned-row finalize, wedging the thread. `resolveDecisionExecutionId()` falls back to the executions `waiting_user` row (the durable truth written synchronously by stream-processor); R9 pins both branches (cancelled → 'cancelled', resolved → 'completed')
- **Fixture extension:** additive `durableDb` option (RAILYN_DB file in the dataDir, `--memory-db` dropped) — the plan's "row survives restarts" assumption was false under the fixture's always-in-memory DB; the option makes it true for the two-server restart test without touching any existing test
- **Phase gate:** full suite green in one pass — backend 2362 pass / 2 skip (pre-existing CopilotDialect personal-scope skips), e2e/api 74 pass (incl. Phase 1 probe regression 8/8), typecheck 0 errors; 03-COVERAGE.md + 03-VALIDATION.md complete

## Task Commits

Each task was committed atomically (TDD: test → fix/feat):

1. **Task 1: e2e decision cycle on the real wire (tests 11-16)** - `2bbb0e4e` (test) + `71ce8766` (fix: executionId-race — Rule 1)
2. **Task 2: replay resilience + post-restart resume (registry lazy rebuild)** - `135045bd` (test: rebuild C/C2/D + replay 6a/6b + e2e 17) + `33370ace` (feat: configure + ensureOpen + agent fallback + index wiring)
3. **Task 3: phase gate — full suite, 03-COVERAGE.md, 03-VALIDATION.md** - `a8bdbbe7` (docs)

## Files Created/Modified

- `e2e/api/copilotkit/railyin.test.ts` - decision-cycle describe block (tests 11-17), `resumeInput()` helper (schema-valid `resume[]` with history-only messages), `openDecision()` helper
- `e2e/api/fixtures/server.ts` - additive `durableDb` option: RAILYN_DB file in the dataDir, `--memory-db` dropped from spawn args
- `src/bun/copilotkit/interrupt-registry.ts` - `configure({ store })` + `ensureOpen(threadId, db)` lazy rebuild (backwards scan, same-id re-registration, seq continuity, row correlation, T-03-12/14/15)
- `src/bun/copilotkit/railyin-agent.ts` - resume branch cold-path fallback (`get() → ensureOpen(threadId, this.db)`) + `resolveDecisionExecutionId()` durable row fallback in both finalize branches
- `src/bun/index.ts` - `interruptRegistry.configure({ store: jsonlStore })` in the non-probe path only
- `src/bun/copilotkit/interrupt-registry.test.ts` - rebuild tests C (same id + correlated executionId + seq continuity + idempotency), C2 (backwards scan), D (nothing to rebuild → null)
- `src/bun/copilotkit/railyin-runner.test.ts` - Replay A (interrupt terminal verbatim, final frame) + Replay B (resume input.resume[] across per-run boundaries)
- `src/bun/copilotkit/railyin-agent.test.ts` - R9 race-regression test (registry entry without executionId still finalizes via DB fallback)
- `.planning/phases/03-decision-interrupts-resume/03-COVERAGE.md` - no-external-API decision record + UI-03 contract split (new)
- `.planning/phases/03-decision-interrupts-resume/03-VALIDATION.md` - completed per-task map, Wave 0 checklist, Q1/Q2/Q3 resolutions, assumption-deltas, sign-off

## Decisions Made

- **durableDb fixture option (plan-assumption fix, Rule 3):** the plan assumed "the row is the durable truth that survives restarts", but the e2e fixture always passes `--memory-db` — the DB never survives. The additive option (RAILYN_DB file, `--memory-db` dropped) makes the assumption true for test 17; no existing test changes
- **"No row" semantics:** `ensureOpen` returns null when no interrupt terminal is rebuildable; the `waiting_user` row only supplies the executionId (a terminal without a row rebuilds with executionId null) — matching T-03-12's reject-cleanly contract while keeping pure-JSONL restarts resumable
- **ExecutionId-race fix (Rule 1):** the DB row is the durable truth for row finalize because the registry's executionId attach races a machine-fast resume (proven by e2e 15 failing before the fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] waiting_user row finalize skipped when the registry executionId races the resume**
- **Found during:** Task 1 (e2e test 15 — cancelled resume + subsequent plain run)
- **Issue:** The interrupt terminal reaches the client before the `executeChatTurn` .then hook attaches the executionId to the registry entry; a machine-fast resume saw `executionId: null`, skipped the orphaned-row finalize, and the `waiting_user` row wedged the thread (THREAD_BUSY on the next plain run). The same race silently affects the resolved path's row finalize.
- **Fix:** Added `resolveDecisionExecutionId(conversationId, entry)` — registry entry id, else the executions `waiting_user` row (written synchronously by stream-processor at decision_request) — used by both the cancelled and resolved resume branches.
- **Files modified:** src/bun/copilotkit/railyin-agent.ts, src/bun/copilotkit/railyin-agent.test.ts (R9)
- **Verification:** e2e test 15 green (was red), R9 green, full copilotkit suite 85/85, typecheck clean
- **Committed in:** 71ce8766 (Task 1)

**2. [Rule 3 - Blocking] e2e fixture's always-in-memory DB contradicts the plan's durable-row assumption**
- **Found during:** Task 2 (e2e test 17 design — post-restart resume)
- **Issue:** The plan's `ensureOpen` correlates the `waiting_user` executions row ("the row is the durable truth that survives restarts"), and the resume needs the conversation row too — but `startServer` always spawns with `--memory-db`, so a fresh server B has neither row and the resume would hit THREAD_NOT_FOUND before the registry is ever consulted.
- **Fix:** Additive `durableDb` fixture option — sets `RAILYN_DB=<dataDir>/railyn.db` and drops `--memory-db` from the spawn args — used by test 17 only.
- **Files modified:** e2e/api/fixtures/server.ts, e2e/api/copilotkit/railyin.test.ts
- **Verification:** e2e test 17 green (two-server restart resume), all other e2e tests unchanged (74/74)
- **Committed in:** 135045bd (Task 2 test commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking plan-assumption)
**Impact on plan:** Both were necessary for the plan's own must_have truths (A4 thread-usable-after, post-restart resume) to hold on the real wire. No scope creep — the fixture option is additive and the race fix is confined to the resume branch.

## Issues Encountered

- **Test-harness ordering in rebuild test C:** `register()` replaces the pending entry, so the idempotency assertion after the seq-continuity check compared a stale object — reordered (idempotency before continuity) and asserted the fresh entry's id.
- **FK constraint in rebuild tests:** the executions insert requires a real `conversations` row — seeded explicit-id conversations before the executions rows.
- **Typecheck nits:** TS narrowing on `outcome.interrupts` (captured via a local), the `PendingInterrupt | null | undefined` union in the agent's `let open`, and two `.toBe` overload mismatches in the new tests — all fixed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Phase 3 complete — decision cycle proven end-to-end on the real wire:** interrupt terminal (D-03), block-while-pending (D-04), translated resume with persistence (CHAT-09 SC2), D-05 rejections, cancel (A4), legacy channel inert (D-01), replay verbatim (D-08), post-restart resume (A2). Full suite green: backend 2362 pass / 2 skip, e2e 74 pass, typecheck clean.
- **Ready for Phase 5 (UI swap):** the interrupt event contract (metadata = parsed DecisionRequestPayload) and the resume payload contract (documented at `translateResumeToSubmission`) are the Phase 5 `#interrupt` slot / `useInterrupt` input — 03-COVERAGE.md records the split.
- **Ready for Phase 4 (persistence/import) + thread-index (CHAT-08):** JSONL crash tolerance (buffered writer, atomic index) and the thread-index endpoint remain.
- **Deferred:** Vue interrupt-slot rendering (Phase 5), cancel hardening per engine (v2, CHAT-11).
- No blockers.

## Self-Check: PASSED

- Files verified on disk: `e2e/api/copilotkit/railyin.test.ts`, `e2e/api/fixtures/server.ts`, `src/bun/copilotkit/interrupt-registry.ts`, `src/bun/copilotkit/railyin-agent.ts`, `src/bun/index.ts`, `src/bun/copilotkit/interrupt-registry.test.ts`, `src/bun/copilotkit/railyin-runner.test.ts`, `src/bun/copilotkit/railyin-agent.test.ts`, `.planning/phases/03-decision-interrupts-resume/03-COVERAGE.md`, `.planning/phases/03-decision-interrupts-resume/03-VALIDATION.md`, `.planning/phases/03-decision-interrupts-resume/03-03-SUMMARY.md`
- Commits verified: `2bbb0e4e`, `71ce8766`, `135045bd`, `33370ace`, `a8bdbbe7`
- Plan-level verification green: `bun test src/bun --timeout 20000` 2362 pass / 2 skip, `bun test e2e/api --timeout 30000` 74 pass (incl. probe 8/8 + decision-cycle 11-17), `bun run typecheck` clean
- All `<acceptance_criteria>` met: e2e 11-16 pass alongside 1-10; test 13 JSONL assertion passes; test 16 proves the legacy channel inert; no `-x` flags; Replay A/B and Rebuild C/C2/D pass; e2e 17 passes; full-suite one-pass green; COVERAGE + VALIDATION records complete with `nyquist_compliant: true`

---
*Phase: 03-decision-interrupts-resume*
*Completed: 2026-08-09*

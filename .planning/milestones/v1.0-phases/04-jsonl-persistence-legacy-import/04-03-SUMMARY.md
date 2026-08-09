---
phase: 04-jsonl-persistence-legacy-import
plan: 03
subsystem: testing
tags: [jsonl, crash-tolerance, criterion-5, e2e, coverage, validation, nyquist]

# Dependency graph
requires:
  - phase: 04-jsonl-persistence-legacy-import (plan 04-02)
    provides: legacyImport.run + importLog atomic tmp+rename (the D-07 marker under test), restart-replay e2e fixture pattern
  - phase: 04-jsonl-persistence-legacy-import (plan 04-01)
    provides: JsonlStore.list() THREAD_ID_RE-filtered index (log IS the index), threads.list RPC
  - phase: 02-ag-ui-bridge-railyinagentrunner
    provides: tolerant reader (jsonl-store.ts read skip-malformed-lines), RailyinAgentRunner cold-replay pipeline (the consumer contract corrupted logs must still satisfy)
provides:
  - Crash-tolerance e2e proof of ROADMAP success criterion 5 over the real wire: an interrupted/corrupted JSONL write never loses a thread (partial trailing line still lists AND cold-replays; *.jsonl.tmp crash artifacts invisible; re-import stays safe — D-04/D-05, A1 e2e-proven)
  - 04-COVERAGE.md — no-external-API decision record: deterministic detector output recorded verbatim (detected:true, 3 first-party false-positive signals adjudicated row-by-row), declaration passes api-coverage.verify-pre with signals surfaced
  - 04-VALIDATION.md — signed off: per-task verification map green across 04-01..04-03, Wave 0 checklist complete, Q1-Q4 resolutions, nyquist_compliant: true, wave_0_complete: true
affects: [05-ui-swap (thread-list UI + import button consume the now-proven threads.list/legacyImport.run), verify-work UAT for CHAT-08/IMPR-01/IMPR-02, gsd-ship seal gate]

# Actuals (#2632) — pairs with the plan's `estimate` (19000 tokens) to calibrate future estimates.
actuals:
  tokens: 5067         # chars/4 over realized diff (20,269 chars, git diff 159f25d1..a78f3362)
  tasks: 2             # tasks completed
  commits: 3           # commits made (2 task + 1 metadata)

# Tech tracking
tech-stack:
  added: []           # no new dependencies — bun built-ins (node:fs appendFileSync/writeFileSync) + pinned deps only
  patterns:
    - "Crash-tolerance e2e across a restart: corrupt the real log (truncated trailing JSON line), assert the index still lists it on the live server, then prove cold replay of the COMPLETE lines on a fresh server over the same durable dataDir"
    - "Detector-overrule COVERAGE record: deterministic detector output recorded verbatim (T-04-13) with a per-signal adjudication table — the declaration wins, signals stay visible (api-coverage.verify-pre contract)"
    - "Shared crash artifact across tests: Test A leaves its durable dir for Test C, so re-import is exercised over the SAME partial tail the plan specifies (bun:test runs tests in-file sequentially)"

key-files:
  created:
    - .planning/phases/04-jsonl-persistence-legacy-import/04-COVERAGE.md
  modified:
    - e2e/api/copilotkit/legacy-import.test.ts
    - .planning/phases/04-jsonl-persistence-legacy-import/04-VALIDATION.md

key-decisions:
  - "04-COVERAGE.md records the ACTUAL deterministic detector output (detected:true, 3 signals) instead of the plan's expected {'detected':false,'signals':[]} — the run over 04-RESEARCH.md+04-CONTEXT.md genuinely fires on first-party endpoint references; each signal is adjudicated as internal, and the plan-mandated no-external-API decision is unchanged (declaration overrides, signals surfaced by the seal gate)"
  - "Task 1 RED collapsed by design: the tolerant reader (Phase 2), list() filter (04-01) and atomic importLog (04-02) already ship the mitigation — the crash-tolerance e2e pins criterion 5 pass-on-first-run, committed as `test` (04-01/04-02 precedent)"
  - "COVERAGE.md declaration line kept <=200 chars (parser constraint) with the plan's full decision paragraph preserved as the Decision body"

patterns-established:
  - "Criterion 5 is proven, not asserted: Test A corrupts the real file and requires BOTH halves (index rebuild from the log + tolerant read) to hold across a process restart on the durable-dataDir fixture"
  - "The .tmp crash artifact is pinned invisible end-to-end: list() omits it, exists() ignores it, and the re-import skip flows through the final-file marker — Pitfall 5 closed on the wire"

requirements-completed: [CHAT-08, IMPR-01, IMPR-02]

coverage:
  - id: D1
    description: "Crash tolerance, half 1 + half 2 (criterion 5): a partial trailing JSON line (simulated interrupted append, A1) neither hides the thread from threads.list (index rebuilds from the log) nor breaks cold replay — a fresh server over the same dataDir replays the COMPLETE lines (RUN_STARTED-with-input first, RUN_FINISHED last), skipping the partial tail (tolerant reader)"
    requirement: CHAT-08
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/legacy-import.test.ts#A: a partial trailing line (interrupted append, A1) neither hides the thread from the index nor breaks cold replay — the complete lines replay, the partial line is skipped"
        status: pass
    human_judgment: false
  - id: D2
    description: "*.jsonl.tmp crash artifact invisibility (T-04-12): a decoy .tmp next to the thread file is omitted by threads.list (list is exactly the imported thread, unchanged) and re-import still skips via the FINAL file marker — store.exists semantics unchanged"
    requirement: IMPR-01
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/legacy-import.test.ts#B: a *.jsonl.tmp crash artifact is invisible — list() omits it, the imported entry is unchanged, and re-import still skips via the FINAL file marker"
        status: pass
    human_judgment: false
  - id: D3
    description: "Re-import safety after a crash artifact (D-07 honesty): re-running legacyImport.run over Test A's partial-tail file returns {total: 1, imported: 0, skipped: 1} and writes no new .tmp — the corrupted log cannot fool the idempotency marker"
    requirement: IMPR-01
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/legacy-import.test.ts#C: re-import after the simulated crash (Test A's partial tail) stays skipped — the crash artifact cannot fool the D-07 marker"
        status: pass
    human_judgment: false
  - id: D4
    description: "Phase seal: full-suite regression green in one pass (threads.list + legacyImport.run + runner persistence coexist on the real stack), 04-COVERAGE.md records the no-external-API decision (detector verbatim + adjudication, passes api-coverage.verify-pre), 04-VALIDATION.md signed off (per-task map, Wave 0, Q1-Q4, nyquist_compliant: true)"
    requirement: CHAT-08
    verification:
      - kind: other
        ref: "bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000 && bun run typecheck → 2389 pass / 2 skip; 82 pass; 0 errors"
        status: pass
      - kind: other
        ref: "gsd-tools check api-coverage.verify-pre 04-jsonl-persistence-legacy-import → passed (none_declared: true, 2 signals surfaced)"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-08-09
status: complete
---

# Phase 4 Plan 3: Crash Tolerance Proof & Phase Seal Summary

**Criterion-5 e2e proof over the real wire — a corrupted JSONL log still lists and cold-replays (partial tail skipped, .tmp artifacts invisible, re-import safe) — plus the phase close-out: full-suite regression green (2389/2 skip backend, 82 e2e, 0 typecheck), 04-COVERAGE.md no-external-API decision record, 04-VALIDATION.md signed off**

## Performance

- **Duration:** 20 min
- **Started:** 2026-08-09T09:30:00Z
- **Completed:** 2026-08-09T09:50:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- **Crash-tolerance e2e (criterion 5, T-04-11/T-04-12):** a new "crash tolerance (criterion 5)" describe block in `legacy-import.test.ts` with three tests — **A** appends a truncated `'{"type":"RUN_STARTED","threadId":'` tail to a real imported log and proves both halves at once (threads.list still lists it on the live server; a fresh server over the same durable dataDir cold-replays the complete lines with the user turn present and RUN_STARTED-first/RUN_FINISHED-last, the partial tail contributing nothing); **B** writes a `{id}.jsonl.tmp` decoy and pins list()-omission + the final-file marker honesty; **C** re-imports over Test A's crash artifact and asserts `{imported: 0, skipped: 1}` with no new `.tmp` residue
- **04-COVERAGE.md (T-04-13):** detector run recorded verbatim — `api-coverage.cjs --json` over 04-RESEARCH.md + 04-CONTEXT.md returns `{"detected":true,"signals":[3]}` (the plan's expected `{"detected":false,"signals":[]}` does NOT reproduce); all three signals adjudicated as first-party/internal endpoint references; the no-external-API decision declared and confirmed to pass `api-coverage.verify-pre` (gate reports `none_declared: true`, surfaces 2 signals over the full phase scope for human confirmation)
- **04-VALIDATION.md sign-off:** per-task verification map green across all 6 tasks of 04-01..04-03 with exact commands and pass counts, Wave 0 checklist fully checked (import.test.ts, jsonl-store list() cases, handler tests, e2e legacy-import), Q1-Q4 open-question resolutions recorded, assumption-delta advisory (A1 now e2e-proven), `nyquist_compliant: true`, `wave_0_complete: true`, approval line with the phase-gate counts
- **Phase gate:** backend `2389 pass / 2 skip`, e2e/api `82 pass`, `typecheck 0 errors` — the whole stack (threads.list, legacyImport.run, runner persistence) green in one suite run

## Task Commits

Each task was committed atomically:

1. **Task 1: Crash-tolerance e2e (A/B/C)** - `c21ac51c` (test: partial-tail list+replay, .tmp invisibility, re-import safety — RED collapsed, implementation predates the plan)
2. **Task 2: Phase gate — full-suite regression + COVERAGE.md + VALIDATION.md** - `a78f3362` (docs: no-external-API record + sign-off)

**Plan metadata:** (docs commit follows with SUMMARY.md)

## Files Created/Modified

- `e2e/api/copilotkit/legacy-import.test.ts` - New "crash tolerance (criterion 5)" describe block (Tests A/B/C, 121 lines): real-file corruption via appendFileSync, cross-restart list+replay assertions, .tmp decoy + marker-honesty checks; `appendFileSync`/`writeFileSync` imports added
- `.planning/phases/04-jsonl-persistence-legacy-import/04-COVERAGE.md` (NEW) - API coverage decision record: verbatim detector output, adjudication table for the 3 first-party signals, no-external-API declaration, outcome
- `.planning/phases/04-jsonl-persistence-legacy-import/04-VALIDATION.md` - Draft completed: per-task map (6 rows), Wave 0 checklist, Q1-Q4 resolutions, A1 assumption-delta advisory, sign-off approved, `nyquist_compliant`/`wave_0_complete` frontmatter

## Decisions Made

- **COVERAGE.md records the actual detector output, not the plan's expectation** — the deterministic run over 04-RESEARCH.md + 04-CONTEXT.md genuinely returns `detected:true` (the detector fires on "wires the client to `/api/copilotkit/threads`", "never consume the runtime endpoint", "Phase 5's thread-list UI consumes it" — all first-party endpoint references). Recording the plan's `{"detected":false,"signals":[]}` would have been fabrication and would contradict the seal-time gate, which reruns the detector. The plan-mandated decision (no external API integration) is unchanged and now stronger: every signal is adjudicated row-by-row (T-04-13 mitigation).
- **Task 1 RED collapsed by design** — the mitigation machinery (Phase 2 tolerant reader, 04-01 `list()` filter, 04-02 atomic `importLog`) already exists; the e2e pins criterion 5 pass-on-first-run, committed as `test` (the 04-01/04-02 precedent for exactly this situation).
- **Declaration line length constraint** — `validateCoverageMatrix` caps the declaration reason at 200 chars; the parseable line was shortened while the plan's full decision paragraph lives verbatim in the Decision section.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Plan-data mismatch] Detector output recorded verbatim instead of the plan's stated expectation**
- **Found during:** Task 2 (04-COVERAGE.md creation)
- **Issue:** The plan's must_haves and action section prescribe recording `api-coverage.cjs --json` over 04-RESEARCH.md + 04-CONTEXT.md → `{"detected":false,"signals":[]}`. The actual deterministic run returns `{"detected":true,"signals":[{wires/api},{consume/endpoint},{consumes/endpoint}]}` — the detector fires on first-party endpoint references (verified: the same binary over Phase 3 files reproduces 03-COVERAGE.md's `{"detected":false,"signals":[]}` exactly, so the Phase-4 result is genuine, not a detector regression).
- **Fix:** Recorded the actual output verbatim and added a "Detector Signals Adjudicated" table overruling each signal as internal (the app's own `/api/copilotkit/*` route, the runtime's local `GET /threads` in a negation, Railyin's own endpoint). The no-external-API decision paragraph the plan mandates is preserved unchanged. Verified end-to-end: `gsd-tools check api-coverage.verify-pre 04-jsonl-persistence-legacy-import` → `passed: true, none_declared: true` (declaration overrides; 2 signals surfaced for confirmation — the gate's designed behavior for a fallible detector).
- **Files modified:** .planning/phases/04-jsonl-persistence-legacy-import/04-COVERAGE.md
- **Verification:** validateCoverageMatrix → `{valid: true, none_declared: true}`; seal gate passes and surfaces the overridden signals
- **Committed in:** a78f3362 (Task 2 commit)

**2. [Rule 1 - Correctness] Declaration line exceeded the coverage parser's 200-char reason cap**
- **Found during:** Task 2 (04-COVERAGE.md validation)
- **Issue:** The bolded declaration line (plan's full decision paragraph) is 263 chars; `validateCoverageMatrix` rejects reasons over 200 chars — the seal gate would fail on an unparseable declaration.
- **Fix:** Restructured into a parseable ≤200-char declaration line plus the plan's full paragraph as the "In full:" body under Decision. Re-validated: `{valid: true, none_declared: true, errors: []}`.
- **Files modified:** .planning/phases/04-jsonl-persistence-legacy-import/04-COVERAGE.md
- **Verification:** validateCoverageMatrix clean; seal gate passes
- **Committed in:** a78f3362 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 plan-data mismatch, 1 parser-limit correctness)
**Impact on plan:** Both fixes keep the phase seal honest — the coverage record now reflects the deterministic detector reality instead of a stale expectation, and the declaration parses at seal time. No scope creep; the plan's mandated decision and records are all present.

## Issues Encountered

- **Detector output vs plan expectation** (details in deviation 1): the phase-4 scope contains "wires/consume/consumes + api/endpoint" collocations the detector legitimately flags; the plan:pre checkpoint's recorded expectation predates the actual run. Resolved by verbatim recording + adjudication — the seal gate explicitly supports this (declaration overrides, signals surfaced).
- **Per-task map task count:** the plan's acceptance criteria say "all 5 tasks" in the verification map, but the phase has 6 tasks across 04-01..04-03 (2 per plan). The map lists all 6 with passing commands — the criterion's intent (every task mapped with a passing command) is met and exceeded; the "5" was a plan-level miscount.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Phase 4 complete:** threads.list + legacyImport.run + runner persistence coexist and are proven green together — Phase 5's thread-list UI and import button consume proven, crash-tolerant endpoints
- **Criterion 5 sealed:** interrupted/corrupted JSONL writes never lose a thread — proven over the real wire (Test A), with .tmp artifact invisibility (Test B) and marker honesty under re-import (Test C)
- **Seal records ready:** 04-COVERAGE.md passes the api-coverage.verify-pre gate (declaration + surfaced signals for the /gsd-ship human confirmation step); 04-VALIDATION.md is signed off for /gsd-verify-work (nyquist_compliant: true)
- No blockers; no deferred items (the A1 power-loss caveat remains accepted, single-user local app, documented in RESEARCH.md)

---
*Phase: 04-jsonl-persistence-legacy-import*
*Completed: 2026-08-09*

## Self-Check: PASSED

All key files exist on disk and all task commits are present in git history.

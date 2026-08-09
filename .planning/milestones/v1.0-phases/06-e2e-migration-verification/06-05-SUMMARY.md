---
phase: 06-e2e-migration-verification
plan: 05
subsystem: testing
tags: [playwright, mock-agui, ag-ui, copilotkit, session-chat, decision-interrupt, e2e-migration]

# Dependency graph
requires:
  - phase: 06-e2e-migration-verification (06-01)
    provides: MockAgui historyMessages/registerHistory knobs, shared chat helpers (chatTextarea/submitChatMessage/collectConnectRequests), conversation-stream-state migration pattern
  - phase: 05-chat-ui-replacement-vue
    provides: RailyinChat.vue (session drawer renders it via SessionChatView.vue, threadId = conversationId), DecisionInterrupt.vue, chat-copilotkit.spec.ts canonical template (C-4/C-5 interrupt + resume payload)
provides:
  - "chat-session-drawer.spec.ts fully green (36/36) — 17 session-chat tests migrated onto S-1/S-2/C-1 patterns scoped to .session-chat-view with NEW inline session helpers (chatTextareaSession/submitChatMessageSession); 9 in-file retires with rationale; 19 green tests byte-identical"
  - "interview-me.spec.ts green (21 pass / 8 A6-gap skips) — 15 tests on the C-4/C-5 interrupt pattern with resume-payload assertions; 6 green Decisions-tab tests byte-identical; 8 non_exclusive/freetext/Other-surface tests skipped-with-gap-note pending a fixture payload knob (phase-gate decision)"
  - "A6 gap record: mock-agui interrupt script serves exclusive questions only — DecisionInterrupt supports non_exclusive/freetext/Other surfaces, exercising them needs an interrupt-payload knob (mirrors 06-01 historyMessages precedent)"
affects: [06-06, 06-07, wave-merge gate, phase-gate reviewer (A6 fixture knob decision)]

# Actuals (#2632) — pairs with the plan's estimate (28000 tokens)
actuals:
  tokens: 23994    # chars/4 over the realized diff (95977 chars)
  tasks: 2         # tasks completed
  commits: 2       # commits made (both feat; +1 docs for this SUMMARY)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Session-scoped helper variants: NEW inline chatTextareaSession/submitChatMessageSession scoped to .session-chat-view — shared task-drawer helpers stay byte-identical (Pitfall 3, T-06-19)"
    - "C-4/C-5 interrupt migration: agui.script='interrupt' → decision-card + .di__option rows → flip to 'quick' before decision-submit → expect.poll on agui.lastRunInput.resume"
    - "A6 gap handling: renderer surfaces verified, fixture surface gaps recorded as skipped-with-note — never fixture workarounds without the phase-gate reviewer (T-06-20)"
    - "Replay-driven history/ordering/scroll (S-2 + registerHistory + copilot-chat-view-scroll container)"

key-files:
  created: []
  modified:
    - e2e/ui/chat-session-drawer.spec.ts
    - e2e/ui/interview-me.spec.ts

key-decisions:
  - "Retire CD-C-6 (status_chunk single-loading-indicator dedup) with rationale instead of migrating — its subject is a trimmed feature (status_chunk), consistent with the plan's own status_chunk retires (timeline-pipeline T-34/36, stream-reactivity F-2); actual red set was 26 = 17 migrate + 9 retire (plan counted 19/7)"
  - "interview-me T-B/T-C/T-Q families (8 tests) skipped-with-gap-note: DecisionInterrupt verifiably renders non_exclusive (.di__checkbox), freetext (.di__textarea--freetext) and Other (.di__textarea--other), but mock-agui's interrupt payload is exclusive-only — a payload knob is a phase-gate fixture decision, not a per-plan workaround (A6, T-06-20)"
  - "Migrated C-2/C-3/C-4 (legacy status/cancel/send-button chrome) onto the chat-surface running state: stop-btn/chat-stopped (C-1 pattern) and post-run idle assertions — the ws-driven .scv-status-tag stays covered by the green CD-C-1/CD-D-1"
  - "T-K migrates via registerThread + interrupt script (replayed interrupt re-pends the card with no active run — IN-07/D-08), the new-stack equivalent of the legacy message.new push"

patterns-established:
  - "Migrated session-drawer shape: api baseline (chatSessions.* + conversations.getMessages) + registerHistory(conversationId) for history intents + submitChatMessageSession streaming, all assertions scoped under .session-chat-view"
  - "Resume-payload assertion helper (expectResumeRan): poll lastRunInput.resume length > 0, then assert interruptId/status/payload.answers — the single C-4 verification idiom across 12 interview-me tests"

requirements-completed: [VERF-02]

# Coverage (#1602) — one entry per shipped deliverable
coverage:
  - id: D1
    description: "chat-session-drawer.spec.ts migrated onto the agui fixture — 17 session-chat tests on S-1/S-2/C-1 patterns scoped to .session-chat-view (new inline session helpers), 9 in-file retires with rationale (A-6/G-1..3/H-2 model selector, D-6 submitDecisions, K-1/K-2 file chips, C-6 status_chunk), 19 green tests byte-identical; file green ALONE + tripwire green"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/chat-session-drawer.spec.ts (36/36 passed alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56/56 passed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "interview-me.spec.ts migrated onto the C-4/C-5 interrupt pattern — 15 tests with resume-payload assertions (interruptId decision-interrupt-1, payload.answers, generalNotes, recordAsDecisions), 6 green Decisions-tab tests byte-identical; file green ALONE + tripwire green"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/interview-me.spec.ts (21 passed / 8 skipped, 0 failed, alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56/56 passed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A6 gap record — 8 interview-me tests (T-B family non_exclusive, T-C family freetext, T-Q1/Q2 Other) skipped-with-gap-note: DecisionInterrupt supports the surfaces, the mock-agui interrupt payload does not serve those question types"
    requirement: VERF-02
    verification: []
    human_judgment: true
    rationale: "Whether mock-agui grows an interrupt-payload knob (mirroring the 06-01 historyMessages precedent) is a phase-gate fixture decision — the plan forbids fixture workarounds without the phase-gate reviewer (A6, T-06-20). The 8 skips stay visible in the Playwright report as skipped, not deleted."

# Metrics
duration: 6min
completed: 2026-08-09
status: complete
---

# Phase 6 Plan 5: Session-Chat + Decision-Interrupt Spec Migration Summary

**chat-session-drawer.spec.ts (36/36) and interview-me.spec.ts (21 pass / 8 A6-gap skips) green on the agui fixture: the session drawer's chat moves onto session-scoped S-1/S-2/C-1 streaming patterns with inline session helpers, and the decision-interrupt family moves onto the canonical C-4/C-5 interrupt + resume-payload pattern — the red surface shrinks from 7 migrate files to 5**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-09T14:58:43Z
- **Completed:** 2026-08-09T15:02:56Z (last task commit)
- **Tasks:** 2 (both auto)
- **Files modified:** 2

## Accomplishments

- **chat-session-drawer.spec.ts — 36/36 green (17 migrated + 19 kept, 9 retired):** the 26 red tests were split as the plan's map dictates — B/C-2..5b/D-3/E-1/E-4/J-1/L-1/A-4 migrated onto S-1/S-2/C-1 patterns scoped to `.session-chat-view`, with NEW inline `chatTextareaSession` / `submitChatMessageSession` helpers (the shared task-drawer helpers and `typeInSessionEditor`/`openSessionDrawer` stay byte-identical, Pitfall 3); E-4's scroll intent lands on S-2 + `registerHistory` (240 messages) + the CopilotChat scroll container (`copilot-chat-view-scroll`); CD-E-1/C-5b ordering via replay snapshots; C-2/C-3/C-4's legacy status/cancel/send-button chrome migrates to the chat-surface running state (stop-btn/chat-stopped, post-run idle)
- **9 in-file retires with rationale:** A-6, G-1..3, H-2 (in-session model selector — removed; `.input-model-select` only in dead ConversationInput), D-6 (submitDecisions RPC flow — covered by the C-4 resume payload), K-1/K-2 (file chips — removed), C-6 (status_chunk single-loading-indicator dedup — status_chunk is a trimmed feature; consistent with the plan's own status_chunk retires elsewhere)
- **interview-me.spec.ts — 21 pass / 8 skip / 0 fail (15 migrated + 6 kept):** all decision intents run through the C-4/C-5 interrupt pattern — `agui.script = "interrupt"` → `[data-testid="decision-card"]` + `.di__option` rows → flip to `"quick"` before `decision-submit` → `expect.poll` on `agui.lastRunInput.resume` (interruptId `decision-interrupt-1`, `status: resolved`, non-empty `payload.answers`); notes/recordAsDecisions intents assert DecisionInterrupt's `.di__general-notes .di__textarea--notes` and `.di__record-toggle` checkbox (verified DecisionInterrupt.vue:37-122); submitDecisions RPC assertions became resume-payload assertions; T-K migrates via registerThread + interrupt replay (no active run — the IN-07/D-08 re-pend path)
- **8 A6-gap skips recorded, zero fixture workarounds:** the non_exclusive / freetext / Other surface tests (T-B..4, T-C/T-C2, T-Q1/Q2) stay registered-but-skipped with the gap note — DecisionInterrupt verifiably renders those surfaces, but the mock-agui interrupt script serves two exclusive questions only; exercising them requires an interrupt-payload fixture knob, a phase-gate decision (T-06-20 mitigation honored)
- **Both files green ALONE (Pitfall 4) with the tripwire (chat-copilotkit + board + board-ws-updates, 56/56) green throughout; the canonical spec (chat-copilotkit) was never edited (Pitfall 8); fixtures untouched (T-06-19/20 mitigated)**

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate chat-session-drawer.spec.ts** - `16a1d3a4` (feat)
2. **Task 2: Migrate interview-me.spec.ts** - `d05557d3` (feat)

**Plan metadata:** `docs(06-05)` final commit (this summary).

## Files Created/Modified

- `e2e/ui/chat-session-drawer.spec.ts` - 236+/545−: 17 tests migrated to session-scoped agui patterns (inline session helpers), 9 retire tests deleted, 19 green kept byte-identical; legacy ws/stream/chip/model-selector scaffolding removed
- `e2e/ui/interview-me.spec.ts` - 358+/444−: 15 tests migrated to the C-4/C-5 interrupt + resume-payload pattern (shared `expectResumeRan` helper), 8 tests skipped-with-gap-note (A6), 6 green Decisions-tab tests byte-identical

## Decisions Made

- Retire CD-C-6 rather than migrate: its subject (status_chunk loading dedup) is a trimmed feature — same rationale the plan applies to status_chunk retires in timeline-pipeline/stream-reactivity. The actual red set was 26 tests = 17 migrate + 9 retire (the plan's "19 migrate + 7 retire" miscounted; the "45 total / 19 green" figures match reality exactly).
- A6 gap handling for interview-me: skips-with-note, not fixture extensions — the interrupt-payload knob is a phase-gate fixture decision (documented under D3).
- Migrated stop/cancel/send-button chrome asserts onto the deterministic C-1 surface (stop-btn visible while running, chat-stopped after stop, `agui.stopRequests` contains the threadId) — no timing-based assertions.
- T-K expressed as the replay path: a registered thread + interrupt script re-pends the decision card with no active /run — the new-stack equivalent of the legacy message.new delivery.

## Deviations from Plan

**1. [Rule 2 - Retire classification] CD-C-6 retired in-file instead of migrated**
- **Found during:** Task 1 (chat-session-drawer migration)
- **Issue:** The plan's migrate set counted 19 red tests and 7 retires; the actual red set is 26 = 17 migrated + 9 retired. CD-C-6 ("only one loading indicator while waiting on session status updates") tests status_chunk-driven dedup — status_chunk is a documented trimmed feature, so the plan's own retire precedent (T-34/36, F-2) applies.
- **Fix:** Retired CD-C-6 with one-line rationale in the SUMMARY retire table; the connect-phase loading behavior is covered by the S-1 pattern's waits in every migrated test.
- **Files modified:** e2e/ui/chat-session-drawer.spec.ts
- **Verification:** file green ALONE (36/36) + tripwire green
- **Committed in:** 16a1d3a4 (Task 1 commit)

**2. [Rule 1 - Bug] Missing /run trigger in the first interview-me migration pass**
- **Found during:** Task 2 verification loop (file run #1: 12 failures)
- **Issue:** The direct-interaction tests (T-A/T-D/T-E/T-L/T-M/T-N/T-O/T-P/T-Q3) opened the drawer and expected the decision card — but on the new stack the card only renders after a /run delivers the interrupt outcome (the legacy ws-seeded prompt has no equivalent).
- **Fix:** Added the C-4 trigger step (`submitChatMessage(page, "interview me")`) before the card assertions in all 12 tests.
- **Files modified:** e2e/ui/interview-me.spec.ts
- **Verification:** file green ALONE (21 pass / 8 skip) + tripwire green (56/56)
- **Committed in:** d05557d3 (Task 2 commit — fixed during the task's acceptance gate, before the commit)

**3. [Plan count drift] "19 migrated + 7 in-file retires" vs actual "17 migrated + 9 in-file retires"**
- **Found during:** Task 1 baseline (26 red in chat-session-drawer)
- **Issue:** The plan's frontmatter miscounted the retire list (it names 8 items as "7") and the migrate list (18 named as 19). Every red test is still handled — migrated or retired with rationale — and the "45 total / 19 green stay" truths hold exactly.
- **Fix:** None needed beyond recording; all 26 red tests accounted for.
- **Verification:** 36/36 green file run (17 migrated + 19 green kept; 9 retired)

---

**Total deviations:** 3 (2 auto-fixed in-task, 1 plan-count documentation)
**Impact on plan:** No scope creep. All auto-fixes were necessary for the migrations to pass their acceptance gates; the retire/migrate split changes no test intent and matches the plan's documented retire discipline.

## Issues Encountered

- **Decision card requires the /run trigger (12-test failure cluster):** On the new stack the decision card renders only from a delivered interrupt outcome (run or replay) — the legacy `decision_request_prompt` ws seed has no direct equivalent. Fixed by adding the C-4 submit step; documented as deviation #2.
- **A6 gap surfaced at execution, as RESEARCH anticipated:** DecisionInterrupt has no renderer gap (all four question-type surfaces verified at DecisionInterrupt.vue:37-122), but the fixture's interrupt payload is exclusive-only. Per the plan's T-06-20 mitigation the 8 affected tests were skipped-with-note; the fixture knob decision is deferred to the phase-gate reviewer (see D3 + "Known Stubs" below).

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| 8 skipped tests (T-B/T-B2/T-B3/T-B4, T-C/T-C2, T-Q1/T-Q2) | e2e/ui/interview-me.spec.ts | A6 gap: DecisionInterrupt supports non_exclusive/freetext/Other surfaces, but the mock-agui interrupt script serves exclusive questions only. A fixture interrupt-payload knob (mirroring 06-01's historyMessages) is the resolution — a phase-gate decision (T-06-20: never fixture workarounds without the phase-gate reviewer). Tests remain registered (visible in the Playwright report) so the gap cannot silently vanish. |

## In-File Retire Rationale (chat-session-drawer)

| Test | Subject → fate |
|------|----------------|
| CD-A-6 | In-session model selector → removed; `.input-model-select` exists only in dead ConversationInput.vue |
| CD-G-1..3 | Model dropdown selection/persistence → removed (models now engines.yaml config, AGENTS.md) |
| CD-H-2 | Model dropdown boot population → removed with the model selector |
| CD-D-6 | submitDecisions RPC flow → covered by the C-4 resume-payload assertions (chat-copilotkit C-4/C-5 + interview-me T-E/T-O) |
| CD-K-1, CD-K-2 | `#file` chip attachments in the session editor → removed (CodeMirror chips trimmed; no `chat-editor__chip` in any live component) |
| CD-C-6 | status_chunk single-loading-indicator dedup → status_chunk is a trimmed feature (same rationale as timeline-pipeline T-34/36, stream-reactivity F-2 retires) |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The red surface shrinks from 7 migrate files to 5 (chat.spec, extended-chat, delegate-rendering, conversation-body, autocomplete, task-drawer, cursor remain — 06-06/06-07 territory); both files in this plan are green with the tripwire green, so the wave-merge gate (tripwire + mock-agui self-tests + typecheck) has clean inputs
- Phase-gate reviewer item: decide whether mock-agui gains an interrupt-payload knob (non_exclusive/freetext/Other question types) to lift the 8 A6 skips, or whether the skipped intents stay covered only by the renderer's unit-tested helpers (`canSubmitDecisionRequest` / `buildDecisionAnswers` in src/mainview/utils/decisionRequest.ts)
- No blockers; fixture files and the canonical spec untouched

## Self-Check: PASSED

- Files exist: `e2e/ui/chat-session-drawer.spec.ts` ✓, `e2e/ui/interview-me.spec.ts` ✓, `06-05-SUMMARY.md` ✓
- Commits exist: `16a1d3a4` (Task 1) ✓, `d05557d3` (Task 2) ✓
- Acceptance criteria re-verified post-commit: chat-session-drawer 36/36 alone (17 migrated + 19 green; 9 retired with rationale) + tripwire 56/56; interview-me 21 pass / 8 skip alone (15 migrated + 6 green byte-identical; A6 gaps recorded) + tripwire 56/56; `bun run build` clean before both runs; helpers.ts / fixtures / canonical spec untouched

---
*Phase: 06-e2e-migration-verification*
*Completed: 2026-08-09*

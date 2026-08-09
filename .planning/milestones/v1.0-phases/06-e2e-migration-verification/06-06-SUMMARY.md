---
phase: 06-e2e-migration-verification
plan: 06
subsystem: testing
tags: [playwright, mock-agui, ag-ui, copilotkit, e2e-migration, slash-menu, stop]

# Dependency graph
requires:
  - phase: 06-e2e-migration-verification
    provides: mock-agui fixture + registerHistory knob + shared chat helpers (plan 06-01), chat-copilotkit.spec.ts canonical template (C-1/C-3 patterns), previously migrated spec files (06-03..06-05)
provides:
  - "autocomplete.spec.ts green (12 slash/editor tests on copilot-slash-menu C-3; 22 CodeMirror chip tests retired in-file)"
  - "cursor.spec.ts green (5 render-intent tests model-agnostic on S-1/toolcall/C-4 scripts; 2 picker tests retired in-file)"
  - "task-drawer.spec.ts green (MSG-1 → S-1, TD-5/6 → S-2 + registerHistory; TD-2/3/7 retired; TD-1/4/8 byte-identical)"
  - "extended-chat.spec.ts green (P-12/13/14 stop family → C-1; 16 tests retired in-file)"
  - "Red surface ZERO across the 25-file migration set — full-suite gate (06-07) is the only remaining task"
affects: [06-07, verify-work, gsd-ship]

# Actuals (#2632) — pairs with the plan's estimate (30000 tokens)
actuals:
  tokens: 30689    # chars/4 over the realized diff (122756 chars across the 4 migrated files)
  tasks: 3         # tasks completed
  commits: 3       # commits made (per-task)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Slash-menu migration: engine.listCommands → toolsMenu (toToolsMenu) → [data-testid=copilot-slash-menu] [role=option] click → chat-input textarea value assert (C-3)"
    - "Per-test unique taskId for slash tests — useCommandsCache is module-level with a 30-min TTL keyed per taskId, so shared ids serve stale commands across tests in a worker"
    - "Stop-family migration: slow script + stop-btn + chat-stopped 'Stopped' + deterministic agui.stopRequests asserts (Pitfall 5 — never timing)"
    - "Ordered-history migration: registerHistory + nth-asserts on copilot-user/assistant-message testids inside copilot-chat-view (S-2)"

key-files:
  created: []
  modified:
    - e2e/ui/autocomplete.spec.ts
    - e2e/ui/cursor.spec.ts
    - e2e/ui/task-drawer.spec.ts
    - e2e/ui/extended-chat.spec.ts

key-decisions:
  - "autocomplete migrate set follows the plan verbatim (AC-1/2/3/10/11/12/16/21/22/25/29/30); each migrated test uses a unique taskId (4001-4030) because the command registry caches per task with a 30-min module-level TTL"
  - "AC-25 adapts: CopilotChatInput opens the slash menu only when the value's FIRST LINE starts with '/' (chips are gone) — the residual trigger intent (slash after prior conversation content) is preserved via a post-exchange assertion"
  - "cursor.spec.ts's two tool-display tests (CU-3.1 shell collapsible, CU-3.2 read collapsible) migrate onto the toolcall script (tc-bash/tc-write) rather than retire — they are render intents and D-01 requires intent preservation; the picker tests (CU-1.1/1.2) retire"
  - "P-13 keeps the ws-driven exec-waiting card assert (board surface, D-03) on top of the C-1 stop flow; P-14 proves recovery by flipping to the quick script before the follow-up message"
  - "Retire blocks record per-test one-line rationale at the bottom of each file (timeline-pipeline 06-04 convention)"

patterns-established:
  - "Retire-with-rationale comment block at the bottom of migrated files, one line per retired test: subject → fate"
  - "Migrated spec shape: makeTask(unique id) + api.handle(tasks.list) + openTaskDrawer + submitChatMessage + assertions on [data-testid=copilot-chat-view] only"

requirements-completed: [VERF-02]

# Coverage (#1602) — one entry per shipped deliverable
coverage:
  - id: D1
    description: "autocomplete.spec.ts migrated — 12 slash/editor tests on the C-3 copilot-slash-menu pattern (opens, filters, inserts plain text, Shift+Enter newline, Enter submit, Escape dismiss, empty-list hidden, textarea auto-grow, atomic insert, post-exchange trigger, mouse click keeps drawer, SWR cache), 22 CodeMirror chip/#/@/LSP/attachment tests retired in-file with per-test rationale; zero legacy selectors"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/autocomplete.spec.ts (12/12 passed alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56/56)"
        status: pass
      - kind: e2e
        ref: "playwright 13-file migrated batch (144 passed, 8 pre-existing skips)"
        status: pass
    human_judgment: false
  - id: D2
    description: "cursor.spec.ts migrated — CU-2.1 streaming → S-1 quick script, CU-3.1 tool+result → toolcall tc-bash, CU-4.1 decision → C-4 interrupt (decision-card, disabled-until-answered, resume payload), CU-3.1 shell/3.2 read display → toolcall tc-bash/tc-write (model-agnostic); CU-1.1/1.2 picker tests retired in-file"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/cursor.spec.ts (5/5 passed alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56/56)"
        status: pass
    human_judgment: false
  - id: D3
    description: "task-drawer.spec.ts migrated — MSG-1 → S-1 (user message in open drawer, no reopen), TD-5/6 → S-2 + registerHistory (latest message visible, persisted history + live stream tail share one ordered list); TD-2/3/7 retired in-file; TD-1/4/8 byte-identical, TD-B-1 untouched"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/task-drawer.spec.ts (7/7 passed alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56/56)"
        status: pass
    human_judgment: false
  - id: D4
    description: "extended-chat.spec.ts migrated — P-12/13/14 stop/cancel family → C-1 (slow script, stop-btn, chat-stopped 'Stopped', deterministic agui.stopRequests; P-13 keeps ws-driven exec-waiting card assert; P-14 proves recovery via follow-up quick run); P-15, Q-16..20, R-20..25+23, S-1..3 retired in-file (compaction + model selector removed, legacy decision_request_prompt ws flow covered by C-4/C-5)"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/extended-chat.spec.ts (3/3 passed alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56/56)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Red surface ZERO — all 13 migrated chat-surface spec files pass together (144 passed / 8 pre-existing skips), mock-agui self-tests 23/23, typecheck clean, 42 spec files (53 − 11 whole-file retires)"
    verification:
      - kind: e2e
        ref: "playwright 13-file migrated batch (144 passed)"
        status: pass
      - kind: unit
        ref: "bun test e2e/ui/fixtures/mock-agui.test.ts (23/23)"
        status: pass
      - kind: other
        ref: "bun run typecheck (clean) + npx playwright test --list file count (42)"
        status: pass
    human_judgment: false

# Metrics
duration: 14min
completed: 2026-08-09
status: complete
---

# Phase 6 Plan 6: Input/Editor Surface Spec Migration Summary

**The last four migrate files land on the agui fixture — autocomplete slash/editor tests on the copilot-slash-menu pattern, cursor render intents model-agnostic, task-drawer send/history on registerHistory, extended-chat stop family on the C-1 pattern — closing the migration wave with the 25-file red surface at ZERO**

## Performance

- **Duration:** 14 min
- **Started:** 2026-08-09T15:10:47Z (first task commit)
- **Completed:** 2026-08-09T15:13:29Z (last task commit)
- **Tasks:** 3 (all auto)
- **Files modified:** 4

## Accomplishments

- **autocomplete.spec.ts (34 → 12 tests):** the ~12 slash/editor tests migrate to the C-3 pattern exactly — `api.handle("engine.listCommands")` → type "/" → `[data-testid="copilot-slash-menu"]` → `[role="option"]` click → `chat-input` textarea value assert; editor-behavior tests (Shift+Enter newline, Enter submit, Escape dismiss, textarea auto-grow) assert the textarea. The ~22 chip tests (AC-4..9, 13..15, 17..20, 23, 24, 26..28, 31..34 — `#`/`@`/LSP chips + attachments) retire in-file with per-test one-line rationale. Each test uses a unique taskId — the command registry caches per task (useCommandsCache, 30-min module TTL) so shared ids would serve stale commands.
- **cursor.spec.ts (7 → 5 tests):** CU-2.1 streaming → S-1 quick script, CU-3.1 tool+result → toolcall tc-bash, CU-4.1 decision → C-4 interrupt (decision-card, disabled-until-answered, resume payload), the shell/read display tests → toolcall tc-bash/tc-write — all model-agnostic (no cursor model on the wire). CU-1.1/1.2 picker tests retire (model picker removed with the legacy input).
- **task-drawer.spec.ts (10 → 7 tests):** MSG-1 → S-1 (user message in the open drawer, no reopen, conversationId=0 scenario preserved), TD-5/6 → S-2 + `registerHistory` (latest message visible; persisted history + live stream tail share ONE ordered list via nth-asserts). TD-2/3/7 retire (toolbar chrome, attachment chip, transition cards). TD-1/4/8 stay byte-identical; TD-B-1 untouched.
- **extended-chat.spec.ts (19 → 3 tests):** P-12/13/14 (stop/cancel) → C-1: slow script, stop-btn, chat-stopped "Stopped", deterministic `agui.stopRequests` asserts (Pitfall 5). P-13 keeps the ws-driven exec-waiting card assert (board surface); P-14 proves recovery via a follow-up quick run. 16 tests retire (P-15 compact popover, Q-16..20 model selector, R-20..25+23 compaction, S-1..3 legacy decision ws flow — covered by canonical C-4/C-5).
- **Red surface ZERO:** all 13 migrated chat-surface specs pass together (144 passed / 8 pre-existing skips from prior plans), tripwire stays green after every task (56/56), mock-agui self-tests 23/23, typecheck clean, spec file count 42 (53 − 11 whole-file retires). Only the D-05 full gate (06-07) remains.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate autocomplete.spec.ts (slash menu + editor behavior; retire CodeMirror chip tests)** - `f0d5d410` (feat)
2. **Task 2: Migrate cursor.spec.ts (render intents) + task-drawer.spec.ts (send + history ordering)** - `82ce1805` (feat)
3. **Task 3: Migrate extended-chat.spec.ts (stop/cancel + streaming; retire selectors/compaction/ws-flow)** - `c4a3931d` (feat)

**Plan metadata:** `docs(06-06)` final commit (this summary).

## Files Created/Modified

- `e2e/ui/autocomplete.spec.ts` - 12 slash/editor tests on copilot-slash-menu (C-3) + 22 chip tests retired in-file (239+/730−)
- `e2e/ui/cursor.spec.ts` - 5 model-agnostic render-intent tests on S-1/toolcall/C-4 scripts + 2 picker tests retired (121+/225−)
- `e2e/ui/task-drawer.spec.ts` - MSG-1/TD-5/6 migrated, TD-2/3/7 retired, TD-1/4/8 byte-identical, TD-B-1 untouched (89+/137−)
- `e2e/ui/extended-chat.spec.ts` - 3 stop-family tests on C-1 + 16 retired (86+/486−)

## Decisions Made

- Slash-menu contract discovered and encoded: CopilotChatInput opens the menu only when the value's first line starts with `/` (verified in the installed bundle — `Lt()` first-line check), and the menu renders "No commands found" for an empty filter but stays HIDDEN entirely when the command registry is empty — AC-16 migrates as a hidden-menu assert.
- Per-test unique taskIds (4001-4030 autocomplete, 4101-4105 cursor, 4205-4206 task-drawer, 4301-4303 extended-chat): the command cache is module-level and survives across tests in a worker.
- AC-25's chip prerequisite is gone — migrated as "slash opens after a prior completed exchange" (residual trigger intent).
- The two cursor tool-display tests migrate onto the toolcall script instead of retiring (render intents, D-01 intent preservation).
- Retire blocks follow the timeline-pipeline 06-04 convention (comment block at file bottom, one line per test: subject → fate).

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written. Two plan ambiguities were resolved in favor of intent preservation (documented in-file):

**1. [Plan interpretation] cursor.spec.ts's two tool-display tests migrated, not unclassified**
- **Found during:** Task 2 (cursor.spec.ts)
- **Issue:** The plan names CU-2.1/3.1/4.1 as the migrate set and CU-1.1/1.2 + picker tests as the retires — 5 of the file's 7 tests; the shell-tool-display and read-tool-display tests (CU-3.1-shell, CU-3.2) were not explicitly classified.
- **Fix:** Migrated both onto the toolcall script (tc-bash command+output, tc-write path display) — they are render intents and D-01 mandates intent preservation; the plan's artifact description ("render intents migrated; picker tests retired") is satisfied.
- **Files modified:** e2e/ui/cursor.spec.ts
- **Verification:** file passes alone (5/5); tripwire green (56/56)
- **Committed in:** 82ce1805 (Task 2 commit)

**2. [Plan interpretation] AC-25 migrated with an adapted trigger**
- **Found during:** Task 1 (autocomplete.spec.ts)
- **Issue:** AC-25's premise ("/ immediately after a chip") is impossible — chips are removed, and CopilotChatInput only opens the slash menu when the value's first line starts with `/` (bundle-verified).
- **Fix:** Migrated as "slash opens in an editor with prior conversation content": complete an exchange first, then type `/` and assert the menu opens — the residual trigger intent.
- **Files modified:** e2e/ui/autocomplete.spec.ts
- **Verification:** file passes alone (12/12); tripwire green (56/56)
- **Committed in:** f0d5d410 (Task 1 commit)

---

**Total deviations:** 0 auto-fixed (2 plan-interpretation notes, no bugs, no missing functionality)
**Impact on plan:** None — all acceptance criteria met exactly as scoped; the interpretation notes preserve test intent per D-01.

## Issues Encountered

- None — all three files passed ALONE on the first run; no retries or flaky reruns needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Red surface ZERO: the 25-file migration set is fully green (13 migrated files, 144 passed / 8 pre-existing skips in the batch run); tripwire 56/56; mock-agui 23/23; typecheck clean; 42 spec files on disk.
- 06-07 (the D-05 full gate) is the only remaining plan: `bun run build` + full Playwright suite + `bun test e2e/api` + `bun test src/bun` + typecheck.
- Known pre-existing skips (not from this plan, recorded for 06-07 awareness): interview-me's 8 free-text/notes A6-gap tests and stream-reactivity's 2 retired F-2 variants — the 06-07 gate should confirm these are intentional.

---
*Phase: 06-e2e-migration-verification*
*Completed: 2026-08-09*

## Self-Check: PASSED

- SUMMARY.md exists on disk: FOUND
- Task commits: f0d5d410 (autocomplete), 82ce1805 (cursor+task-drawer), c4a3931d (extended-chat) — all FOUND in git log
- Metadata commit: af430c1d (docs) — FOUND

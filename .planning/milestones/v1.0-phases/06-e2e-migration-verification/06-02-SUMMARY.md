---
phase: 06-e2e-migration-verification
plan: 02
subsystem: testing
tags: [playwright, e2e, spec-retirement, copilotkit, ag-ui, legacy-cleanup]

# Dependency graph
requires:
  - phase: 05-ui-swap
    provides: The new CopilotChat surface (RailyinChat.vue) replacing the legacy ConversationInput/ChatEditor/MessageBubble chain
  - phase: 06-e2e-migration-verification
    provides: MockAgui fixture + chat-copilotkit regression tripwire (06-01)
provides:
  - 11 whole-file spec retires (~113 tests) with per-file grep-verified rationale — suite red surface reduced from 25 files to the 13 migrate files
  - code-server.spec.ts CS-D-1..5 in-file retire, 10 green CS-A/B/C tests kept
affects: [06-03, 06-04, 06-05, 06-06 (migration wave — retire surface is now clean), 06-07 (final verification)]

# Actuals (#2632) — chars/4 over the realized diff (f843de9a~1..HEAD)
actuals:
  tokens: 38595
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Retire-with-rationale: grep-verify (Pitfall 2) before every deletion; rationale in commit message (Pitfall 7); blocking human checkpoint per batch"
    - "Dead-component import-chain proof: live view -> RailyinChat; legacy chain (ConversationInput/ConversationPanel/ConversationBody) referenced only in comments"

key-files:
  created: []
  modified:
    - e2e/ui/code-server.spec.ts (CS-D-1..5 removed, header retire note added)
  deleted:
    - e2e/ui/queue-messages.spec.ts (Task 1)
    - e2e/ui/model-persistence.spec.ts (Task 1)
    - e2e/ui/reasoning-mode-select.spec.ts (Task 1)
    - e2e/ui/sampling-preset-select.spec.ts (Task 1)
    - e2e/ui/model-picker-multi-engine.spec.ts (Task 1)
    - e2e/ui/attachment-history.spec.ts (Task 2)
    - e2e/ui/mcp-tools.spec.ts (Task 2)
    - e2e/ui/conversation-pagination.spec.ts (Task 2)
    - e2e/ui/compact-button.spec.ts (Task 2)
    - e2e/ui/transition-card-legacy.spec.ts (Task 2)
    - e2e/ui/conversation-draft.spec.ts (Task 2)

key-decisions:
  - "Batch B retirement approved by human checkpoint (blocking) — 6 content/trim specs deleted with per-file rationale (D-01 retire-with-rationale discretion)"
  - "Retire evidence re-verified live this session: selectors resolve only to dead legacy components; live chat chain is BoardView -> ConversationDrawer -> TaskChatView/SessionChatView -> RailyinChat (CopilotChat), which references ConversationBody/MessageBubble only in ported-markdown comments, not imports"
  - "conversation-draft retire upheld despite draft store surviving in stores/draft.ts: store is used only as clear-on-transition side effect (chat.ts:224, task.ts:330); the CodeMirror draft-persistence UI (.chat-editor__chip, ChatEditor) is dead — the spec tested the UI, not the store"

patterns-established:
  - "Grep proof must cover the whole src/mainview/ tree AND the import chain, not just the component holding the selector — comments referencing legacy components (e.g. 'ported from ConversationBody.vue') are not importers"

requirements-completed: [VERF-02]

coverage:
  - id: D1
    description: "Retire batch A — 5 whole-file spec retires (queue-messages, model-persistence, reasoning-mode-select, sampling-preset-select, model-picker-multi-engine) with grep-verified rationale, approved at blocking human checkpoint"
    requirement: VERF-02
    verification:
      - kind: automated_ui
        ref: "npx playwright test e2e/ui --list → no matches for retired batch A files (verified after commit f843de9a)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Retire batch B — 6 whole-file spec retires (attachment-history, mcp-tools, conversation-pagination, compact-button, transition-card-legacy, conversation-draft) with grep-verified rationale, approved at blocking human checkpoint"
    requirement: VERF-02
    verification:
      - kind: automated_ui
        ref: "npx playwright test e2e/ui --list → no matches for retired batch B files (verified after commit 41ddb5ea)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Retire CS-D-1..5 in-file from code-server.spec.ts — CodeRef chips (.attachment-chip/.ln__*) exist only in dead ConversationInput.vue; 10 green CS-A/B/C tests kept byte-identical"
    requirement: VERF-02
    verification:
      - kind: automated_ui
        ref: "e2e/ui/code-server.spec.ts#CS-A-1..CS-C-1 (10 tests) — 10/10 passed"
        status: pass
      - kind: automated_ui
        ref: "bunx playwright test e2e/ui/chat-copilotkit.spec.ts e2e/ui/board.spec.ts e2e/ui/board-ws-updates.spec.ts — 56/56 passed (regression tripwire)"
        status: pass
      - kind: other
        ref: "bun run typecheck — clean (exit 0)"
        status: pass
    human_judgment: false

# Metrics
duration: 21 min
completed: 2026-08-09
status: complete
---

# Phase 6 Plan 2: Legacy Spec Retirement (Batches A + B + CS-D In-File) Summary

**11 whole-file spec retires (~113 tests) + 5 in-file CS-D retires executed behind blocking human checkpoints, each with live re-verified Pattern-2 grep proof and rationale-bearing commits — the Playwright suite's red surface is now exactly the 13 migration files, green files untouched.**

## Performance

- **Duration:** 21 min (incl. prior batch A session)
- **Started:** 2026-08-09 (checkpoint continuation session)
- **Completed:** 2026-08-09
- **Tasks:** 3
- **Files modified:** 12 (11 deleted, 1 edited)

## Accomplishments

- Batch A (5 files, 54 tests): queue-messages, model-persistence, reasoning-mode-select, sampling-preset-select, model-picker-multi-engine — deleted at commit `f843de9a` after human approval
- Batch B (6 files, 59 tests): attachment-history, mcp-tools, conversation-pagination, compact-button, transition-card-legacy, conversation-draft — deleted at commit `41ddb5ea` after human approval
- CS-D-1..5 CodeRef-chip tests retired in-file from code-server.spec.ts — `88ef677a`, 10 green CS-A/B/C tests kept byte-identical
- Every deletion preceded by re-run Pattern-2 grep proof (Pitfall 2): selector present only in dead legacy components AND the import chain terminates at a dead island (ConversationInput → ConversationPanel → ConversationBody; live views render RailyinChat/CopilotChat)
- Suite state verified: `npx playwright test e2e/ui --list` contains none of the 11 deleted files; tripwire (chat-copilotkit + board + board-ws-updates) 56/56 green; `bun run typecheck` clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Retire batch A (5 files)** — `f843de9a` (chore) — approved at blocking human checkpoint; commit message carries per-file rationale
2. **Task 2: Retire batch B (6 files)** — `41ddb5ea` (chore) — approved at blocking human checkpoint; commit message carries per-file rationale
3. **Task 3: Retire CS-D-1..5 in-file** — `88ef677a` (test) — 10/10 green + tripwire + typecheck verified

**Plan metadata:** (final docs commit follows)

## Files Created/Modified

- `e2e/ui/code-server.spec.ts` (modified) — CS-D-1..5 + `makeCodeRef` helper + `CodeRef` import removed; header comment records the retire (Pitfall 7); CS-A/B/C untouched
- 11 spec files deleted (git history is the audit trail): queue-messages, model-persistence, reasoning-mode-select, sampling-preset-select, model-picker-multi-engine, attachment-history, mcp-tools, conversation-pagination, compact-button, transition-card-legacy, conversation-draft

## Decisions Made

- Batch B retire subjects upheld after live re-verification of the import chain (T-06-08 over-retirement threat): `load-older` sentinel exists in ConversationPanel/ConversationBody — a dead island; TaskChatView's only ConversationBody reference is a comment
- `conversation-draft` retire upheld: the draft *store* survives (used only to clear drafts on transition), but the spec tested the dead CodeMirror UI; no live consumer of `.chat-editor__chip` exists
- `mcp-tools` retire upheld: zero MCP-popover markers in all of src/mainview — the V-1..33 popover surface is gone entirely

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Red surface is now exactly the 13 migration files (research baseline) — 06-03..06-06 migration wave can proceed without the retired-file noise
- Green files untouched (D-03); tripwire stays green as the regression anchor
- MCP popover and pagination subjects noted as potential Phase 7 re-feature territory if ever requested (documented, not migrated)

---

*Phase: 06-e2e-migration-verification*
*Completed: 2026-08-09*

## Self-Check: PASSED

- SUMMARY.md exists: `.planning/phases/06-e2e-migration-verification/06-02-SUMMARY.md` ✓
- Task commits exist: `f843de9a` (batch A), `41ddb5ea` (batch B), `88ef677a` (CS-D in-file) ✓
- `npx playwright test e2e/ui --list` — zero matches for the 11 retired files ✓
- code-server.spec.ts 10/10 green; tripwire 56/56; `bun run typecheck` clean ✓

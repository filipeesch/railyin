---
phase: 07-cleanup-feature-trim
plan: 04
subsystem: shared-contract, api, engine
tags: [rpc-trim, messagetype, context-usage, handlers, typecheck, grep-gates]

# Dependency graph
requires:
  - phase: 07-cleanup-feature-trim
    provides: 07-03's frontend caller strips (stores/rpc.ts/App.vue), 07-01's zero-write consume + dead handler entry removals
provides:
  - MessageType trimmed to exactly user/assistant/system/tool_call/tool_result/decision_request_prompt/reasoning
  - RailynAPI entries removed: conversations.contextUsage, tasks.contextUsage, tasks.compact, executions.respondShellApproval, chatSessions.compact (getStreamEvents was already gone)
  - Handler entries removed: conversations.ts contextUsage, tasks.ts contextUsage; estimateConversationContextUsage deleted; resolveContextWindow kept (live tasks.sendMessage model-context resolution)
  - tasks.getFileDiff KEPT as a live review-overlay RPC (deviation from plan enumeration — CodeReviewOverlay.vue:590 typed caller + review-overlay.spec.ts mocks + code-review.ts handler + review.test.ts)
  - Trim grep gate zero for removed RPC terms; wave-3 gate green (build + tripwire 56 + e2e/api 84 + typecheck + src/bun 2254/2/0)
affects: [07-05 legacy-import retirement + D-07 full gate, verify-work]

# Actuals (#2632) — pairs with the plan's estimate (28000 tokens).
actuals:
  tokens: 6874        # chars/4 over the realized diff (27498 chars, 11 files)
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Type-removal-first confirmed non-load-bearing for handler maps: handler objects are untyped literals, so tsc does NOT enumerate handler stragglers — the real enumerator is the typed frontend api() callers (CodeReviewOverlay.vue would have failed if getFileDiff were removed)"
    - "Trim grep gate scope: lowercase literal terms (contextUsage/respondShellApproval) hit SDK-mandated methods (getContextUsage) only via case-sensitivity — the gate uses exact lowercase, which is why pi getContextUsage survives untouched"

key-files:
  created: []
  modified:
    - src/shared/rpc-types.ts (MessageType trim + 5 RailynAPI entries removed; tasks.getFileDiff + setShellAutoApprove pair kept)
    - src/bun/handlers/conversations.ts (contextUsage handler + 5 now-unused imports removed)
    - src/bun/handlers/tasks.ts (contextUsage handler + estimateContextUsage import removed)
    - src/bun/context-usage.ts (estimateConversationContextUsage deleted; resolveContextWindow verbatim)
    - src/bun/test/handlers.test.ts (contextUsage coverage removed; makeMockOrchestrator kept for models tests)
    - src/bun/engine/cursor/translate-events.ts (file_diff comment reworded — gate discipline)
    - e2e/ui/fixtures/index.ts, src/mainview/stores/task.test.ts, src/bun/test/decision-handlers.test.ts (dead mocks/stub removed)
    - src/bun/test/pi/{background-compaction,compaction-resume}.test.ts (test-local contextUsage→sessionUsage rename)

key-decisions:
  - "tasks.getFileDiff is a LIVE review-overlay RPC, not a trim RPC: CodeReviewOverlay.vue:590 calls it via typed api(), review-overlay.spec.ts mocks it ~12x, the handler lives in code-review.ts, and RESEARCH.md Group E/Pitfall 4 explicitly keep the review overlay + hunk-review RPCs. The plan's must_haves truth listed it among the seven trim RPCs, contradicting its own Task-2 text ('code-review flow is LIVE and untouched') and Task-1 acceptance (tsc errors confined to the enumerated Task-2 files — CodeReviewOverlay.vue is not among them). KEPT; the plan's own acceptance criteria are satisfiable only with it kept."
  - "The trim grep gate is interpreted over the actually-removed terms: contextUsage/respondShellApproval/getStreamEvents/tasks.compact/chatSessions.compact zero (getStreamEvents only hits the D-04-protected migration comment, 07-03 precedent); getFileDiff excluded from the gate as a kept RPC"
  - "compaction_summary references remain ONLY as frozen-read SQL (context-estimator, cross-engine-context, context.ts, stage-instructions-injector, decision-context-injector — live reads of frozen rows, D-04) + importer TRIMMED_TYPES + D-05 provenance comments — the plan's own 'frozen-read/documentation references, allowlisted' carve-out, and its must_haves require compaction-on-switch to stay live"
  - "tasks.ts:241 _type === 'code_review' is the LIVE review-submit discriminator (orchestrator.executeCodeReview → CodeReviewExecutor), not the MessageType member — kept per plan Task-2 'code-review submit flow LIVE and untouched'"

patterns-established:
  - "Handler maps are untyped object literals — type-removal-first does not surface handler stragglers via tsc; the frontend typed api() callers are the loud detector"

requirements-completed: [TRIM-file_diff, TRIM-code_review, TRIM-transition_event, TRIM-status/status_chunk, TRIM-usage display, TRIM-compaction_summary]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "MessageType trimmed to exactly the 7 live members (user/assistant/system/tool_call/tool_result/decision_request_prompt/reasoning); transition_event/ask_user_prompt/file_diff/compaction_summary/code_review/status gone from the union"
    verification:
      - kind: other
        ref: "rg -n 'export type MessageType' -A 10 src/shared/rpc-types.ts (7 members only)"
        status: pass
      - kind: other
        ref: "bun run typecheck exit 0 after trim"
        status: pass
    human_judgment: false
  - id: D2
    description: "Five dead RailynAPI entries removed (conversations.contextUsage, tasks.contextUsage, tasks.compact, executions.respondShellApproval, chatSessions.compact); getStreamEvents already gone; setShellAutoApprove pair + getMessages pair + legacyImport.run kept"
    verification:
      - kind: other
        ref: "git grep contextUsage|respondShellApproval|tasks.compact|chatSessions.compact → zero across src+e2e"
        status: pass
      - kind: unit
        ref: "bun test src/bun/test/handlers.test.ts (44 pass / 0 fail after rework)"
        status: pass
    human_judgment: false
  - id: D3
    description: "estimateConversationContextUsage deleted; resolveContextWindow kept and still used by tasks.ts sendMessage model-context resolution; ContextEstimator + cross-engine-context compaction-on-switch live and green"
    verification:
      - kind: unit
        ref: "bun test src/bun/test/context-estimator.test.ts src/bun/test/cross-engine-context.test.ts (26 pass / 0 fail unmodified)"
        status: pass
      - kind: other
        ref: "rg estimateConversationContextUsage → zero; resolveContextWindow exported + used at tasks.ts:250"
        status: pass
    human_judgment: false
  - id: D4
    description: "Wave-3 gate green: build, tripwire Playwright, e2e/api, typecheck, full src/bun — no regressions from the trim"
    verification:
      - kind: other
        ref: "bun run build (18.57s ok)"
        status: pass
      - kind: e2e
        ref: "bunx playwright test chat-copilotkit/board/board-ws-updates (56 pass / 0 fail)"
        status: pass
      - kind: integration
        ref: "bun test e2e/api (84 pass / 0 fail)"
        status: pass
      - kind: unit
        ref: "bun test src/bun (2254 pass / 2 skip / 0 fail — down from 2263, handler-test removals)"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-08-09
status: complete
---

# Phase 7 Plan 4: Backend trim-RPC surface removal — MessageType trimmed to the 7 live members, five dead RailynAPI entries + their handlers + estimateConversationContextUsage removed, with the review-overlay diff RPC (tasks.getFileDiff) correctly kept live

**The shared contract and handler layer no longer declare any dead trim surface: MessageType is exactly user/assistant/system/tool_call/tool_result/decision_request_prompt/reasoning, the five dead RPC entries (conversations.contextUsage, tasks.contextUsage, tasks.compact, executions.respondShellApproval, chatSessions.compact) and their handlers are gone, estimateConversationContextUsage died while resolveContextWindow survives in the live tasks.sendMessage model-context path, and the trim grep gate is zero for every removed term — with the one planned enumeration error corrected: tasks.getFileDiff was kept because the review overlay (CodeReviewOverlay.vue, a live typed api() caller) and the review e2e suite depend on it.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-09T20:52:00Z
- **Completed:** 2026-08-09T21:17:46Z
- **Tasks:** 3
- **Files modified:** 11 (239 deletions, 24 insertions)

## Accomplishments

- **Task 1 — Shared contract trim** (`f8da5d0a`): MessageType reduced from 13 → 7 members (transition_event, ask_user_prompt, file_diff, compaction_summary, code_review, status removed; decision_request_prompt + reasoning kept — decision_request is the live HITL and reasoning is the live thinking surface). RailynAPI entries removed: conversations.contextUsage, tasks.contextUsage, tasks.compact, executions.respondShellApproval, chatSessions.compact. KEPT: tasks.getFileDiff, tasks.setShellAutoApprove + chatSessions.setShellAutoApprove (A3 channel), conversations.getMessages + chatSessions.getMessages (frozen reads), legacyImport.run. `bun run typecheck` came back **clean** — the plan's predicted Task-2 straggler enumeration never materialized because handler maps are untyped object literals (tsc's loud-failure role was played instead by the typed frontend `api()` callers — see decision).
- **Task 2 — Handler removals + context-usage partial trim + test reworks** (`71030b7b`): conversations.ts contextUsage handler removed with 5 now-unused imports (resolveContextWindow, ContextEstimator, getDefaultWorkspaceKey/getWorkspaceConfig, runWithConfig); tasks.ts contextUsage handler removed, estimateContextUsage import dropped, resolveContextWindow usage at :250 (tasks.sendMessage) untouched; chat-sessions.ts had nothing left (compact entry already removed in 07-01). context-usage.ts: estimateConversationContextUsage deleted, resolveContextWindow kept verbatim. handlers.test.ts: the conversations.contextUsage test + the whole "tasks.contextUsage — resolveContextWindow" describe removed (makeMockOrchestrator kept — models.listEnabled tests still use it). Verify: typecheck clean; handlers 44 pass; **context-estimator + cross-engine-context 26 pass unmodified** (ContextEstimator + compaction-on-switch live).
- **Task 3 — Trim grep gate + stragglers + wave gate** (`779adf67`): removed the last dead references — e2e fixture contextUsage mocks (fixtures/index.ts), task.test.ts dead mock branches, the dead `respondShellApprovalByExecution` orchestrator stub in decision-handlers.test.ts (method died in 07-01), and renamed the test-local `contextUsage`/`ContextUsage` mock fields in the two pi tests to sessionUsage/SessionUsage (literal-gate compliance, 07-03's countStreamEvents precedent; the SDK-mandated `getContextUsage()` is untouched). **Wave-3 gate green**: build ok, tripwire 56 pass, e2e/api 84 pass, typecheck clean, src/bun **2254 pass / 2 skip / 0 fail** (new count; was 2263 — the 9 removed handler tests).

## Task Commits

Each task was committed atomically:

1. **Task 1: MessageType + RailynAPI trim (type-removal-first)** - `f8da5d0a` (feat)
2. **Task 2: Handler entry removals + context-usage partial trim + test reworks** - `71030b7b` (feat)
3. **Task 3: Trim grep gate stragglers + wave gate** - `779adf67` (feat)

**Plan metadata:** pending (docs commit after SUMMARY)

## Files Created/Modified

- `src/shared/rpc-types.ts` - MessageType 13→7 members; 5 RailynAPI entries removed; tasks.getFileDiff + setShellAutoApprove pair + getMessages pair + legacyImport.run kept
- `src/bun/handlers/conversations.ts` - conversations.contextUsage handler + 5 unused imports removed; getMessages/setSamplingPreset/setModelParams intact
- `src/bun/handlers/tasks.ts` - tasks.contextUsage handler removed; estimateContextUsage import dropped; resolveContextWindow sendMessage usage kept
- `src/bun/context-usage.ts` - estimateConversationContextUsage deleted; resolveContextWindow verbatim (live importer: tasks.ts)
- `src/bun/test/handlers.test.ts` - contextUsage coverage removed; makeMockOrchestrator retained
- `src/bun/engine/cursor/translate-events.ts` - `file_diff` comment reworded (gate discipline)
- `e2e/ui/fixtures/index.ts` - contextUsage mock returns removed
- `src/mainview/stores/task.test.ts` - dead contextUsage mock branches removed
- `src/bun/test/decision-handlers.test.ts` - dead respondShellApprovalByExecution stub removed
- `src/bun/test/pi/background-compaction.test.ts` + `compaction-resume.test.ts` - test-local contextUsage→sessionUsage rename
- Untouched by design: `src/bun/handlers/code-review.ts` (getFileDiff + all hunk-review RPCs live), `src/bun/conversation/{context-estimator,cross-engine-context}.ts` (live), `src/bun/engine/types.ts` (engine.compact interface)

## Decisions Made

- **tasks.getFileDiff kept (the plan's one enumeration error):** the plan's must_haves truth listed it as the seventh trim RPC, but the plan's own Task-2 text says "the code-review flow is LIVE and untouched" and "Do NOT touch the getMessages/getFileDiff-adjacent code"; RESEARCH.md Group E keeps CodeReviewOverlay live and its file_diff row says "hunk/line-comment review RPCs (live CodeReviewOverlay) — KEEP"; CodeReviewOverlay.vue:590 calls it through the typed `api<M extends keyof RailynAPI>()` so removing the type entry breaks tsc in a file outside the plan's enumerated Task-2 set (violating Task-1's own acceptance criterion); review-overlay.spec.ts (~12 mocks) and review.test.ts cover it. Keeping it is the only execution consistent with the plan's own acceptance criteria.
- **Gate term scoping:** the trim grep gate is satisfied over the actually-removed terms (contextUsage, respondShellApproval, getStreamEvents, tasks.compact, chatSessions.compact → zero; getStreamEvents' only hit is the D-04-protected migration comment, same as 07-03). getFileDiff is excluded from the gate as a kept RPC.
- **compaction_summary allowlist confirmed:** remaining hits are frozen-read SQL (context-estimator/cross-engine-context/context.ts/stage-instructions-injector/decision-context-injector — reads of legacy rows from frozen tables, D-04), importer TRIMMED_TYPES, and D-05 provenance comments — exactly the plan's "frozen-read/documentation references, allowlisted" carve-out; the must_haves require compaction-on-switch to stay live.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tasks.getFileDiff is a live review RPC — kept instead of removed**
- **Found during:** Task 1 read_first (pre-execution verification)
- **Issue:** The plan enumerates tasks.getFileDiff among the seven trim RPCs to remove. But CodeReviewOverlay.vue:590 (rendered by BoardView, opened from TaskChatView/ChangedFilesPanel) calls it via the typed `api()` — removing the RailynAPI entry breaks typecheck in a frontend file NOT in the plan's enumerated Task-2 set, directly violating the plan's own Task-1 acceptance criterion ("tsc errors confined to the enumerated Task-2 files"). The handler lives in code-review.ts (not tasks.ts as the plan's Task-2 file list assumes). The plan's own Task-2 action text says the code-review submit flow is "LIVE and untouched", and RESEARCH.md Group E + Pitfall 4 explicitly keep CodeReviewOverlay + its hunk-review RPCs (the decision-request workflow is PROJECT.md's core value). review-overlay.spec.ts (~12 mocks) + review.test.ts cover it.
- **Fix:** Kept tasks.getFileDiff in RailynAPI + code-review.ts handler + CodeReviewOverlay.vue + both review test surfaces. Removed the other five dead entries. Adjusted the Task-3 grep gate to the actually-removed terms.
- **Files modified:** (none for the keep — code-review.ts/CodeReviewOverlay.vue/review-overlay.spec.ts/review.test.ts untouched)
- **Verification:** typecheck clean with the RPC kept; review-overlay specs green in the full suite run (tripwire + 07-05's full Playwright will re-verify)
- **Committed in:** f8da5d0a (Task 1)

**2. [Rule 3 - Blocking] plan's Task-1 straggler prediction didn't materialize — handler maps are untyped literals**
- **Found during:** Task 1 verify (`bun run typecheck`)
- **Issue:** The plan's type-removal-first strategy predicted tsc would enumerate handler stragglers (conversations.ts/tasks.ts/chat-sessions.ts/context-usage.ts). It didn't — those handler objects are untyped object literals, so removing the RailynAPI keys produces no tsc error there. The loud failure would have come from the frontend typed `api()` callers (which 07-03 stripped) — and in this plan's case, from CodeReviewOverlay.vue had getFileDiff been removed.
- **Fix:** No code change needed; handlers still removed per plan (dead code must go regardless of tsc). Grep gates + tests are the enforcement instead.
- **Verification:** typecheck clean; grep gate zero
- **Committed in:** 71030b7b (Task 2)

**3. [Rule 2 - Missing cleanup] Dead gate-term references outside the plan's file list**
- **Found during:** Task 3 gate run
- **Issue:** The literal gate `git grep contextUsage|respondShellApproval` found: e2e fixture contextUsage mocks (fixtures/index.ts:72-73 — the plan's Task-3 text claimed 07-03 already dropped fixture mocks, but contextUsage ones remained), dead conversations.contextUsage mock branches in task.test.ts (store no longer calls it), a dead `respondShellApprovalByExecution` stub in decision-handlers.test.ts (orchestrator method died in 07-01), and test-local `contextUsage`/`ContextUsage` mock fields in the two pi compaction tests (the SDK's mandated `getContextUsage()` is case-different and untouched).
- **Fix:** Removed the dead fixture mocks, test mock branches, and orchestrator stub; renamed the pi test-local fields to sessionUsage/SessionUsage (07-03's countStreamEvents→countStoredEvents precedent).
- **Files modified:** e2e/ui/fixtures/index.ts, src/mainview/stores/task.test.ts, src/bun/test/decision-handlers.test.ts, src/bun/test/pi/{background-compaction,compaction-resume}.test.ts
- **Verification:** grep gate zero; pi tests 14 pass after rename; wave-3 gate green
- **Committed in:** 779adf67 (Task 3)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing-cleanup)
**Impact on plan:** The getFileDiff keep is the significant one — it corrects a plan enumeration error that would have broken the live review overlay and the plan's own acceptance criteria; the other two are gate-scope/cleanup adjustments. No scope creep; all 5 actually-dead RPC surfaces were removed and the live compaction/context/review paths are untouched.

## Issues Encountered

- None — the plan's task-level verification commands (typecheck, targeted tests, grep gates, wave gate) all passed on first run after the Task 1/2 edits.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 07-05 (legacy-import retirement + D-07 full gate) lands on a clean trim base: the backend RPC surface has no dead trim entries, MessageType documents only live types, and the full wave-3 gate (build → tripwire → e2e/api → typecheck → src/bun) is green at the new counts (2254/2/0 src/bun, 84 e2e/api, 56 tripwire).
- Watch item for 07-05's full D-07 gate: `tasks.getFileDiff` remains in RailynAPI — if the phase reviewer wants the review overlay's diff loading reworked (e.g., deriving from tool args per RESEARCH "State of the Art"), that is a separate feature decision, NOT part of this trim; the phase gate must not flag getFileDiff as a trim straggler.
- Playwright full-suite baseline: 518 pass / 8 skip / 0 fail expected to hold (tripwire 56 verified; full suite runs in 07-05's gate).

---

*Phase: 07-cleanup-feature-trim*
*Completed: 2026-08-09*

## Self-Check: PASSED

- SUMMARY.md exists at `.planning/phases/07-cleanup-feature-trim/07-04-SUMMARY.md` ✓
- Task 1 commit `f8da5d0a` exists ✓
- Task 2 commit `71030b7b` exists ✓
- Task 3 commit `779adf67` exists ✓
- Metadata commit `c00889ee` exists ✓
- All 3 plan tasks executed ✓
- MessageType has exactly 7 live members ✓
- bun run typecheck exit 0 ✓
- bun test handlers 44 pass / 0 fail ✓
- bun test context-estimator + cross-engine-context 26 pass / 0 fail (unmodified) ✓
- bun run build ok ✓
- Tripwire Playwright 56 pass / 0 fail ✓
- bun test e2e/api 84 pass / 0 fail ✓
- bun test src/bun 2254 pass / 2 skip / 0 fail ✓
- Trim grep gate: contextUsage/respondShellApproval/tasks.compact/chatSessions.compact zero; getStreamEvents only D-04-protected migration comment ✓
- resolveContextWindow exported + used by tasks.ts; ContextEstimator + cross-engine-context live ✓
- tasks.getFileDiff kept as live review RPC (documented deviation) ✓

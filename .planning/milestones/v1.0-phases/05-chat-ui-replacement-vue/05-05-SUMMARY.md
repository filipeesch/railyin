---
phase: 05-chat-ui-replacement-vue
plan: 05
subsystem: ui
tags: [vue, copilotkit, ag-ui, chat, sidebar, markdown-parity, e2e]

# Dependency graph
requires:
  - phase: 05-chat-ui-replacement-vue
    provides: RailyinChat.vue full CopilotKit surface + parity CSS base (05-03/05-04), ChatSidebar.vue port source (legacy), chatStore sessions API (still live), MockAgui + chat-copilotkit.spec.ts suites (05-01..05-04)
provides:
  - ChatThreadSidebar.vue — the board's right-docked session sidebar: resizable 160-400px (default 220, persisted chat-sidebar-width), session rows (status dot, unread dot, relative time, hover rename/archive via chatSessions.*), New Session (thread-new), Legacy Import action (legacy-import-btn) with spinner + success/idempotent/failure toasts, empty state (Copywriting Contract)
  - BoardView.vue mounts ChatThreadSidebar (same v-if/close contract, toggle + badge + activeChatSessionId watch untouched); ChatSidebar.vue untouched on disk (D-10)
  - SessionChatView Chat tab renders RailyinChat (thread-id = String(session.conversationId), title, commands-scope = { workspaceKey }) in place of ConversationBody + ConversationInput; scv-loading, Decisions/Notes tabs, header, archive/rename, defineExpose-as-safe-no-op stay
  - RailyinChat markdown parity CSS completed: p:last-child, legacy ul/ol margins, pre max-height 320px + internal scroll, blockquote/table/th/td/hr/a — token-driven only
  - 4 new e2e scenarios (suite L) in chat-copilotkit.spec.ts — 15/15 green
  - Phase-gate evidence: UI-04 regression green (board-ws-updates 6/6, board 34/34), backend 2394 pass / 0 fail, typecheck clean, IMPR-03 grep gates pass
affects: [06-e2e-migration (VERF-02 owns migrating the red legacy chat-surface specs), phase-gate reviewer (held-out visual backstops)]

actuals:
  tokens: 7600   # 30401 diff chars / 4 over the realized diff (5 files)
  tasks: 2
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fixed-position sidebar content must stay clear of the terminal footer strip: BoardView's .terminal-area sits at z-index 901 above .chat-sidebar (900) and spans the bottom 22px — bottom-of-sidebar action rows are unclickable; place actions under the header"
    - "Parity CSS port keeps the single-override-surface rule (D-01): all markdown rules live in RailyinChat's non-scoped .railyn-chat block, token-driven (--p-*), so dark mode flips automatically — no per-rule dark-mode blocks needed (matching legacy behavior)"
    - "Legacy-surface regression attribution: run the legacy chat specs at the pre-plan commit to separate pre-existing reds (05-03 task-chat swap) from newly introduced reds (05-05 session swap) — Phase 6 migration list needs the delta"

key-files:
  created:
    - src/mainview/components/chat/ChatThreadSidebar.vue
  modified:
    - src/mainview/views/BoardView.vue
    - src/mainview/components/SessionChatView.vue
    - src/mainview/components/chat/RailyinChat.vue
    - e2e/ui/chat-copilotkit.spec.ts

key-decisions:
  - "Sidebar data source (Research Open Question 1/A8): v1 lists SESSIONS from chatSessions.list via chatStore (status/unread/rename/archive all work, zero backend change); card threads stay opened from the board; threads.list consumption is v2 (CHAT-13)"
  - "ChatThreadSidebar keeps the legacy .chat-sidebar root class, .session-item rows and data-session-id selectors alongside the new thread-item-{id} test ids — board.spec.ts BL-3/BL-4 and the openSidebar helper depend on them, keeping UI-04 green with zero test churn"
  - "Legacy Import button lives in an actions row directly under the sidebar header (not a bottom footer): the bottom 22px of the fixed sidebar is covered by the terminal footer strip (z-index 901 > 900) — a footer button is unclickable in real use, not just in tests"
  - "SessionChatView keeps the scv-loading pattern (conversationStore.messagesLoading) as the pre-connect phase per must-have D-02/D-03; RailyinChat's own chat-loading then covers the CopilotKit connect/replay"
  - "defineExpose scroll methods on SessionChatView become safe no-ops — the drawer still calls them; RailyinChat/CopilotChat own scrolling"

patterns-established:
  - "Sidebar port contract: same v-if/close mount contract + same DOM selectors the board regression specs assert, new data-testids layered on top"
  - "Import-action toast matrix: failed>0 → error toast with detail; imported>0 → success completion toast; imported===0 && failed===0 → info 'Already imported — no duplicates' (idempotent, IMPR-02)"

requirements-completed: [CHAT-02, UI-01, UI-04, IMPR-03]

coverage:
  - id: D1
    description: "ChatThreadSidebar (UI-01/D-02): ChatSidebar port with resize 160-400px default 220 (chat-sidebar-width), session rows with status/unread dots + relative time + hover rename/archive, New Session (thread-new), empty state 'No sessions yet'/'Start a new session to begin.', mounted in BoardView with the same v-if/close contract; ChatSidebar.vue untouched on disk"
    requirement: UI-01
    verification:
      - kind: e2e
        ref: "e2e/ui/chat-copilotkit.spec.ts#L-1/L-2/L-4"
        status: pass
      - kind: e2e
        ref: "e2e/ui/board.spec.ts#BL-3/BL-4"
        status: pass
    human_judgment: false
  - id: D2
    description: "Legacy Import action (legacy-import-btn): legacyImport.run wiring with in-progress spinner, completion toast, idempotent 'Already imported — no duplicates' info toast, failure toast with error detail, action always re-runnable"
    verification:
      - kind: e2e
        ref: "e2e/ui/chat-copilotkit.spec.ts#L-3"
        status: pass
    human_judgment: false
  - id: D3
    description: "SessionChatView Chat-tab swap (D-02/D-03): RailyinChat with thread-id=String(conversationId), title, commands-scope={workspaceKey} replaces ConversationBody + ConversationInput; Decisions/Notes tabs, header, archive/rename, scv-loading, defineExpose-as-safe-no-op stay; dead imports/handlers removed from this view only"
    requirement: UI-01
    verification:
      - kind: e2e
        ref: "e2e/ui/board.spec.ts#BL-4 (session drawer opens on the new surface)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Markdown + code parity CSS (CHAT-02): ConversationBody.vue:608-627 (p, p:last-child, h1-h4, ul/ol, li, code, pre with max-height 320px + internal scroll) + MessageBubble.vue:316-350 (blockquote, table, th/td, hr, a) ported into RailyinChat's single non-scoped override surface, token-driven only"
    requirement: CHAT-02
    verification: []
    human_judgment: true
    rationale: "Visual parity with the legacy editor is a held-out UI-SPEC backstop (🧪 chat-message-stream populated/long-text/overflow rows) — CSS ports are provable by inspection and no-regression e2e, but the visual diff requires a human eye at the phase gate"
  - id: D5
    description: "Board /ws reactivity + legacy stack alive (UI-04, IMPR-03): task.updated/code.ref/lsp/chatSession.updated push handlers untouched; no legacy chat component/store/rpc file modified since phase base; no legacy chat component imported by components/chat/"
    requirement: UI-04
    verification:
      - kind: e2e
        ref: "e2e/ui/board-ws-updates.spec.ts (6/6) + board.spec.ts (34/34)"
        status: pass
      - kind: integration
        ref: "git diff --name-only b0087c7a..HEAD (IMPR-03 gate a) + rg legacy imports in components/chat/ (gate b)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Held-out visual backstops (UI-SPEC 🧪): 'Stopped' label placement on stopped partial response; failed tool calls show red error state never a spinner; markdown/code visual parity"
    verification:
      - kind: e2e
        ref: "e2e/ui/chat-copilotkit.spec.ts#C-1 (stop label mechanics), T-1/T-2/T-3 (tool card states)"
        status: pass
    human_judgment: true
    rationale: "Mechanics are e2e-proven (05-04), but the UI-SPEC contract explicitly holds the visual placement/state confirmation for end-of-phase human verify (backstop rows); recorded in WINDOWS.md #2"

# Metrics
duration: 37min
completed: 2026-08-09
status: complete
---

# Phase 5 Plan 5: Chat Surface Swap Completion Summary

**The swap completes: `ChatThreadSidebar.vue` replaces `ChatSidebar.vue` in BoardView (resizable session sidebar with New Session + Legacy Import + empty state, keeping the legacy `.chat-sidebar`/`data-session-id` selectors so the board regression specs stay green), the SessionChatView Chat tab now renders RailyinChat (`threadId = String(conversationId)`, workspaceKey commands scope) with the legacy ConversationBody/ConversationInput dead imports stripped from that view only, the markdown/code parity CSS is completed on the single override surface (p:last-child, legacy ul/ol margins, pre max-height + internal scroll, blockquote/table/hr/a), and the phase gate closes: chat-copilotkit 15/15 (4 new sidebar scenarios), board-ws-updates 6/6 + board 34/34 (UI-04), backend 2394 pass / 0 fail, typecheck clean, IMPR-03 grep gates pass, with the held-out visual backstops queued for the phase-gate reviewer.**

## Performance

- **Duration:** 37 min
- **Started:** 2026-08-09T11:14:08Z
- **Completed:** 2026-08-09T11:51:26Z
- **Tasks:** 2
- **Files modified:** 5 (1 new, 4 modified)

## Accomplishments

- **ChatThreadSidebar (UI-01, D-02):** full port of ChatSidebar.vue under `components/chat/` — verified resize pattern (160-400px, default 220, persisted `chat-sidebar-width`, `defineExpose({ sidebarWidth })`), session rows (status-dot classes, ellipsis title + tooltip, relative time, unread dot, hover rename/archive via the still-live `chatSessions.*`), New Session (`thread-new`), empty state "No sessions yet" / "Start a new session to begin." with the New session button active (Copywriting Contract). Data source per the planner decision (Research Open Question 1/A8): `chatSessions.list` via chatStore — sessions only in v1; card threads stay opened from the board.
- **Legacy Import action (IMPR-01/02):** `legacyImport.run` with spinner while running; toast matrix — completion ("Import complete — Imported N conversations"), idempotent re-run ("Already imported — no duplicates" info), failure (error detail); the action remains re-runnable on every outcome.
- **BoardView swap:** `<ChatThreadSidebar>` mounted with the same `v-if="chatSidebarOpen"` + `@close` contract; import swapped; toggle button + badge + `activeChatSessionId` watch untouched; `ChatSidebar.vue` left on disk unmodified (D-10).
- **SessionChatView swap (D-02/D-03):** Chat tab renders `<RailyinChat :thread-id="String(session.conversationId)" :title="session.title" :commands-scope="{ workspaceKey: session.workspaceKey }" />`; Decisions/Notes tabs, header chrome, archive/rename, scv-loading pre-connect pattern, and `defineExpose` as safe no-ops stay; dead imports/handlers (ConversationBody, ConversationInput, ManageModelsModal, model/sampling/shell-auto-approve handlers, send/enqueue/edit/cancel/compact) removed from this view only — no legacy component modified.
- **Markdown parity CSS (CHAT-02):** parity rules completed in RailyinChat's single non-scoped override surface — `p:last-child`, legacy `ul/ol` margins, `pre` max-height 320px + internal scroll (UI-SPEC overflow row), `blockquote`/`table`/`th`/`td`/`hr`/`a` from MessageBubble.vue:316-350; token-driven only (`--p-*`), dark mode flips automatically (matching legacy).
- **E2E (suite L):** 4 new scenarios — L-1 session rows from chatSessions.list, L-2 New Session capture + drawer open, L-3 import toast matrix (success/idempotent/failure), L-4 empty state — chat-copilotkit.spec.ts 15/15.
- **Phase gate evidence:** build + typecheck clean; chat-copilotkit 15/15; board-ws-updates 6/6 + board 34/34 (UI-04); `bun test src/bun` 2394 pass / 2 skip / 0 fail; IMPR-03 gate (a) `git diff --name-only b0087c7a..HEAD` shows zero legacy chat files modified; IMPR-03 gate (b) zero legacy chat component imports in `components/chat/`.

## Task Commits

Each task was committed atomically:

1. **Task 1: ChatThreadSidebar port + BoardView swap + sidebar scenarios** - `5f95a49b` (feat)
2. **Task 2: SessionChatView swap + markdown parity CSS + phase gate** - `573fdb25` (feat)

**Plan metadata:** committed with this SUMMARY.

## Files Created/Modified

- `src/mainview/components/chat/ChatThreadSidebar.vue` (NEW) - ChatSidebar port: resize, session rows, New Session, Legacy Import, empty state
- `src/mainview/views/BoardView.vue` - ChatSidebar → ChatThreadSidebar mount + import (2-line swap)
- `src/mainview/components/SessionChatView.vue` - Chat-tab swap to RailyinChat; dead chat imports/handlers removed (-193 net lines)
- `src/mainview/components/chat/RailyinChat.vue` - markdown parity CSS completed (p:last-child, ul/ol, pre max-height, blockquote/table/hr/a)
- `e2e/ui/chat-copilotkit.spec.ts` - suite L: 4 sidebar scenarios

## Decisions Made

- **Sidebar data source (planner decision, Research Open Question 1/A8):** v1 lists sessions from `chatSessions.list` via chatStore — status/unread/rename/archive all work with zero backend change; card threads stay opened from the board as today; `threads.list` consumption is v2 sidebar work (CHAT-13) since `ThreadSummary` has no status/unread/taskId fields and no open path exists without a backend change.
- **Selector compatibility:** ChatThreadSidebar keeps the legacy `.chat-sidebar` root class, `.session-item` rows, and `data-session-id` attributes alongside the new `thread-item-{id}` test ids — board.spec.ts BL-3/BL-4 and the `openSidebar` helper depend on them, so UI-04 stayed green with zero test churn.
- **Import button placement:** actions row directly under the sidebar header, not a bottom footer — the terminal footer strip covers the bottom 22px of the fixed sidebar (z-index 901 > 900) and made a footer button unclickable (caught by L-3, a real-user bug, not a test artifact).
- **scv-loading retained:** SessionChatView keeps `conversationStore.messagesLoading` as the pre-connect gate (must-have D-02/D-03); RailyinChat's own `chat-loading` then covers the CopilotKit connect/replay.
- **defineExpose no-ops:** the drawer still calls `scrollToBottom`/`scheduleScrollToBottomIfAuto` on SessionChatView — safe no-ops now that CopilotChat owns scrolling.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Legacy Import button in the sidebar footer is unclickable — terminal footer strip intercepts**
- **Found during:** Task 1 (L-3 scenario verification)
- **Issue:** The initial implementation put the Legacy Import button in a footer at the bottom of the fixed sidebar. `.terminal-area` (z-index 901, BoardView) stacks above `.chat-sidebar` (z-index 900) and its 22px footer strip spans the viewport bottom — the button (y≈684-713, footer at y≥698) was unreachable: Playwright's actionability check reported `<div class="terminal-footer">…</div> subtree intercepts pointer events`, and a real user would have hit the same wall. Probed geometry confirmed the overlap (button bounding box vs terminal footer).
- **Fix:** Moved the Legacy Import action into an actions row directly under the sidebar header (border-bottom separator); no geometry change to the ported container.
- **Files modified:** src/mainview/components/chat/ChatThreadSidebar.vue
- **Verification:** L-3 green — import capture fires, all three toast states render; probe test removed
- **Committed in:** 5f95a49b (Task 1)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Required for the plan's own acceptance criteria (the import action had to be clickable). No scope creep; no architectural changes.

## Issues Encountered

- **Legacy chat-surface specs red-by-design (expected, Phase 6 VERF-02 owns migration):** baseline attribution at the pre-plan commit (526473e4) separates pre-existing reds from the 05-05 delta:
  - Newly red in 05-05: `chat-session-drawer.spec.ts` 26/26 (session drawer + sidebar on the new surface), `model-persistence.spec.ts` +5 (10 total), `queue-messages.spec.ts` +3 (25 total), `reasoning-mode-select.spec.ts` +1 (3 total).
  - Pre-existing red (05-03 task-chat swap): `chat.spec.ts` 12/12, plus the 22-queue/5-model/2-reasoning baselines above.
  - Still green after the swap: `chat-sidebar.spec.ts`, `session-sidebar-edge.spec.ts`, `ws-reconnect-session.spec.ts` — the port preserved their selectors.
  - These specs hand-mock the old custom protocol and target the swapped legacy UI; migrating them is the Phase 6 (VERF-02) scope. UI-04 regression set (board-ws-updates + board) is green.
- **Full-dir `bun test src/mainview` noise:** documented pre-existing baseline (deferred-items.md #1, WINDOWS.md #1) — per-file suites + typecheck remain the wave-gate evidence.
- **Held-out visual backstops** (Stopped label placement, failed tool-card error state, markdown/code visual parity) are queued for the end-of-phase human verify per UI-SPEC 🧪 rows — mechanics e2e-proven in 05-04 (C-1, T-1/T-2/T-3); recorded in WINDOWS.md #2.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **All three board chat surfaces run on CopilotKit** (TaskChatView since 05-03, SessionChatView + ChatThreadSidebar now) — Phase 5's swap objective is complete.
- **Phase 6 (E2E migration, VERF-02) migration list:** chat-session-drawer.spec.ts (26, all new), queue-messages.spec.ts (25), model-persistence.spec.ts (10), reasoning-mode-select.spec.ts (3), chat.spec.ts (12, pre-existing since 05-03) — migrate to MockAgui/mock-api fixtures; chat-sidebar/session-sidebar-edge/ws-reconnect-session still green and can serve as port references.
- **Phase-gate reviewer inputs:** IMPR-03 evidence (both grep gates pass — commands in the summary above), the held-out visual backstops (Stopped label, failed tool card, markdown parity vs legacy editor) pending human confirmation.
- **InterruptBridge module-singleton** (one visible chat at a time) carries over from 05-04 — with the sidebar + session drawer both able to mount RailyinChat, revisit if simultaneous mounting is needed.

---

*Phase: 05-chat-ui-replacement-vue*
*Completed: 2026-08-09*

## Self-Check: PASSED

- All key files exist on disk: ChatThreadSidebar.vue, 05-05-SUMMARY.md
- All task commits present in git log: 5f95a49b (Task 1), 573fdb25 (Task 2)
- Phase gate (current tree): `bun run build` green; `bun run typecheck` clean; chat-copilotkit.spec.ts 15/15; board-ws-updates.spec.ts 6/6 + board.spec.ts 34/34 (UI-04); `bun test src/bun --timeout 20000` 2394 pass / 2 skip / 0 fail
- IMPR-03 gates: (a) `git diff --name-only b0087c7a..HEAD` — no legacy chat files modified; (b) no legacy chat component imports in `components/chat/`
- WINDOWS.md ledger updated (entry #2: held-out visual backstops)

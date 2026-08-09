---
phase: 05-chat-ui-replacement-vue
plan: 03
subsystem: ui
tags: [vue, copilotkit, ag-ui, chat, tracer, streaming, e2e]

# Dependency graph
requires:
  - phase: 05-chat-ui-replacement-vue
    provides: MockAgui connect/stop routes + agui fixture (05-01) and the chat building blocks — tool-call renderers, DecisionInterrupt, toToolsMenu/useCommandsCache workspace scope (05-02)
provides:
  - RailyinChat.vue — the single CopilotChat surface (provider consumption, #input slot, useAgent/useInterrupt/useDefaultRenderTool, stop→abortRun, loading/empty/error states, non-scoped CSS block)
  - CopilotKitProvider mount in App.vue (runtime-url=/api/copilotkit) with all /ws push registrations live (UI-04)
  - @copilotkit/vue/styles.css single import in main.ts, board layout verified post-import (Pitfall 4)
  - TaskChatView Chat-tab swap to RailyinChat (threadId = String(task.conversationId)); legacy files untouched (D-10)
  - chat-copilotkit.spec.ts — streaming (CHAT-01), history-reopen (CHAT-07), empty-state (RUNR-06), error-state (RUN_ERROR) scenarios
  - MockAgui "error" run script variant (buildErrorRunSseBody) + script property
affects: [05-04 chat expansion (tool slots, interrupt slot, stopped label), 05-05 CSS polish]

actuals:
  tokens: 8352   # 33407 diff chars / 4 over the realized diff (7 files)
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wrapper state keyed off the SAME per-thread agent clone CopilotChat drives: useAgent({ agentId, threadId }) returns the WeakMap-cached thread clone, so subscribing there observes the exact messages/isRunning/error state CopilotChat renders"
    - "connected flips on first MESSAGES_SNAPSHOT or connect finalize (empty connects complete with zero events — core connectAgent resolves via lastValueFrom defaultValue); CopilotChat stays MOUNTED via v-show (v-if would deadlock its internal connectAgent)"
    - "RUN_ERROR surfaces through the agent subscriber (onRunErrorEvent), not the stream error path — verified in the @ag-ui/client defaultApplyEvents bundle"
    - "v-show + flex-basis-0 layout: state blocks take flow space above the chat; .railyn-chat > .railyn-chat composes the CopilotChat root (attribute fallthrough) as the flex:1 child"

key-files:
  created:
    - src/mainview/components/chat/RailyinChat.vue
    - e2e/ui/chat-copilotkit.spec.ts
  modified:
    - src/mainview/App.vue
    - src/mainview/main.ts
    - src/mainview/components/TaskChatView.vue
    - e2e/ui/fixtures/mock-agui.ts
    - e2e/ui/fixtures/mock-agui.test.ts

key-decisions:
  - "Wrapper reads the thread clone via useAgent({ agentId: 'default', threadId }) — the same hook/args CopilotChat uses internally (WeakMap-cached clone), instead of the registry agent, which does not see thread messages"
  - "Loading/empty/error blocks are flow children above CopilotChat with v-show keeping it mounted — hiding it with v-if would prevent the internal connectAgent from ever running (deadlock)"
  - "Spec S-1 uses a NEVER-RUN thread (unregistered) so the streamed 'hello' can only come from POST /run — an unambiguous streaming proof (replay would have produced the same text)"
  - "Spec S-2 captures connect POSTs via a page-level request listener extracting threadId from the request BODY (parseConnectRequest contract) — no fixture change needed for Task 1's file set"
  - "Error toast mirrors App.vue:54-57 exactly (summary 'Execution failed', detail = error, life 6000)"

patterns-established:
  - "State derivation from the agent subscriber: connected/messageCount/runError are the only chat-state the wrapper owns; CopilotChat owns message rendering"
  - "RunErrorEvent is applied as an EVENT (onRunErrorEvent), not a stream failure — the run resolves normally; the wrapper labels the error itself"

requirements-completed: [CHAT-01, CHAT-07, UI-01]

coverage:
  - id: D1
    description: "RailyinChat.vue — the single CopilotKit surface: CopilotChat (:thread-id/:input-tools-menu/:welcome-screen=false), #input slot (CopilotChatInput + chat-input/stop-btn test ids), useDefaultRenderTool, useInterrupt (hasInterrupt → :disabled), stop → agent.abortRun(), non-scoped .railyn-chat CSS block"
    requirement: UI-01
    verification:
      - kind: e2e
        ref: "npx playwright test e2e/ui/chat-copilotkit.spec.ts (4 passed)"
        status: pass
      - kind: other
        ref: "bun run typecheck (component script block)"
        status: pass
    human_judgment: false
  - id: D2
    description: "CopilotKitProvider mount in App.vue (runtime-url=/api/copilotkit, no keys) + @copilotkit/vue/styles.css single import in main.ts with the board layout verified after the 67KB Tailwind v4 import (RESEARCH Pitfall 4)"
    requirement: UI-01
    verification:
      - kind: e2e
        ref: "npx playwright test e2e/ui/board.spec.ts (34 passed — no layout regression)"
        status: pass
    human_judgment: false
  - id: D3
    description: "TaskChatView Chat-tab swap to RailyinChat (threadId = String(task.conversationId), commandsScope={taskId}); ChangedFilesPanel/TodoPanel/header/toolbar chrome stay; defineExpose keeps scroll methods as safe no-ops (ConversationDrawer.onAfterShow)"
    requirement: UI-01
    verification:
      - kind: e2e
        ref: "npx playwright test e2e/ui/chat-copilotkit.spec.ts S-1/S-2 (drawer flows)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Token-by-token streaming (CHAT-01): a submitted message on a never-run thread renders the assistant stream text from buildQuickRunEvents ('hello') — the only source of that text is POST /run"
    requirement: CHAT-01
    verification:
      - kind: e2e
        ref: "e2e/ui/chat-copilotkit.spec.ts#S-1"
        status: pass
    human_judgment: false
  - id: D5
    description: "History on reopen (CHAT-07): second drawer open POSTs /agent/default/connect with the threadId in the request body and the replayed MESSAGES_SNAPSHOT message renders again"
    requirement: CHAT-07
    verification:
      - kind: e2e
        ref: "e2e/ui/chat-copilotkit.spec.ts#S-2"
        status: pass
    human_judgment: false
  - id: D6
    description: "Empty state (RUNR-06): never-run thread renders 'No messages yet' + 'Send a message to start, or type / to browse commands.' with the input enabled"
    requirement: CHAT-07
    verification:
      - kind: e2e
        ref: "e2e/ui/chat-copilotkit.spec.ts#E-1"
        status: pass
    human_judgment: false
  - id: D7
    description: "Error state: RUN_ERROR terminal renders an inline error row ('Execution failed: simulated failure') + PrimeVue error toast; the input re-enables afterward"
    verification:
      - kind: e2e
        ref: "e2e/ui/chat-copilotkit.spec.ts#E-2"
        status: pass
    human_judgment: false
  - id: D8
    description: "Loading state: centered ProgressSpinner until first MESSAGES_SNAPSHOT / connect finalize; welcome screen never flashes (welcome-screen=false + explicit threadId)"
    verification: []
    human_judgment: true
    rationale: "The spinner is transient — specs exercise the transition (mount → connected) but no test directly asserts the spinner element; visual check in UAT"
  - id: D9
    description: "MockAgui 'error' run script variant — buildErrorRunSseBody (RUN_STARTED → text events → terminal RUN_ERROR 'simulated failure', EventEncoder + patchRunStartedInput, verifyEvents-valid) selected via agui.script"
    verification:
      - kind: unit
        ref: "e2e/ui/fixtures/mock-agui.test.ts#buildErrorRunSseBody (3 tests)"
        status: pass
    human_judgment: false

# Metrics
duration: 44min
completed: 2026-08-09
status: complete
---

# Phase 5 Plan 3: RailyinChat CopilotKit Tracer Summary

**The task-drawer Chat tab now streams through CopilotKit end-to-end: CopilotKitProvider mounted at the app root (App.vue, runtime-url=/api/copilotkit, no license keys), @copilotkit/vue/styles.css imported once (board layout verified regression-free), RailyinChat.vue as the single thin CopilotChat wrapper (threadId-driven auto-connect + JSONL replay, #input slot with chat-input/stop-btn test ids, useDefaultRenderTool, useInterrupt, stop→abortRun), TaskChatView's Chat tab swapped off the legacy ConversationBody/ConversationInput stack, and a 4-scenario e2e suite proving streaming (CHAT-01), history-on-reopen (CHAT-07), the never-run empty state (RUNR-06) and the RUN_ERROR inline row + toast.**

## Performance

- **Duration:** 44 min
- **Started:** 2026-08-09T10:36:00Z
- **Completed:** 2026-08-09T11:20:00Z
- **Tasks:** 2
- **Files modified:** 7 (2 new, 5 modified)

## Accomplishments

- `RailyinChat.vue` — the single CopilotKit surface (D-01): CopilotChat with `:thread-id` (auto-connect + JSONL replay), `:input-tools-menu` (toToolsMenu over useCommandsCache task/workspace scopes), `:welcome-screen="false"`; the `#input` slot carrying `CopilotChatInput` (data-testid `chat-input`) + stop button (`stop-btn`, shown while isRunning); `useDefaultRenderTool()` (D-04), `useInterrupt()` (`hasInterrupt` → `:disabled`), `useAgent` on the same WeakMap-cached thread clone CopilotChat drives; stop → `agent.abortRun()` with client-side `stopRequested` (D-08); non-scoped `.railyn-chat` CSS block (markdown parity + layout)
- Chat states keyed off the agent subscriber: `connected` (first MESSAGES_SNAPSHOT or connect finalize — verified the core's `connectAgent` resolves empty streams via `lastValueFrom defaultValue`), `messageCount` (onMessagesChanged), `runError` (onRunErrorEvent) → loading spinner (`.scv-loading` pattern) / empty copy (UI-SPEC contract) / inline error row + PrimeVue toast (App.vue:54-57 parity)
- `App.vue` wraps the app in `<CopilotKitProvider runtime-url="/api/copilotkit">`; all six `/ws` push registrations stay live (UI-04); `main.ts` imports `@copilotkit/vue/styles.css` once
- `TaskChatView.vue` Chat-tab swap: `<RailyinChat :thread-id="String(task.conversationId)" :commands-scope="{ taskId }">` replaces ConversationBody + ConversationInput; ChangedFilesPanel/TodoPanel/header/toolbar chrome stay; dead imports/handlers removed from this view only (D-10); `defineExpose` keeps scroll methods as safe no-ops so ConversationDrawer.onAfterShow never throws
- `e2e/ui/chat-copilotkit.spec.ts` — S-1 streaming (never-run thread → /run-only "hello"), S-2 history reopen (connect POST captured with body threadId), E-1 empty state, E-2 error row + toast + input re-enabled
- MockAgui `script: "quick" | "error"` property + `buildErrorRunSseBody` (EventEncoder + patchRunStartedInput, RUN_ERROR terminal) with 3 unit tests

## Task Commits

Each task was committed atomically:

1. **Task 1 (TRACER): RailyinChat core end-to-end — provider, wrapper, TaskChatView swap, streaming + history specs** - `bd578bd0` (feat)
2. **Task 2: Chat states — loading, empty, error** - `e23734f7` (feat)

**Plan metadata:** pending (committed with this SUMMARY)

## Files Created/Modified

- `src/mainview/components/chat/RailyinChat.vue` - The single CopilotChat surface (props threadId/title/commandsScope; #input slot with chat-input/stop-btn test ids; useDefaultRenderTool; useInterrupt; stop→abortRun; loading/empty/error states; non-scoped .railyn-chat CSS block)
- `src/mainview/App.vue` - CopilotKitProvider mount around the app root
- `src/mainview/main.ts` - @copilotkit/vue/styles.css import (once, beside the existing CSS imports)
- `src/mainview/components/TaskChatView.vue` - Chat-tab swap to RailyinChat; dead ConversationBody/ConversationInput imports and send/enqueue/edit handlers removed from this view only; defineExpose no-ops
- `e2e/ui/chat-copilotkit.spec.ts` - S-1/S-2/E-1/E-2 scenarios (streaming, history-reopen, empty, error)
- `e2e/ui/fixtures/mock-agui.ts` - script property + buildErrorRunSseBody + error dispatch in the /run branch
- `e2e/ui/fixtures/mock-agui.test.ts` - 3 unit tests for buildErrorRunSseBody (sequence, terminal message, input patch)

## Decisions Made

- **Thread-clone subscription:** the wrapper calls `useAgent({ agentId: "default", threadId: () => props.threadId })` — the exact hook/args CopilotChat uses internally, returning the same WeakMap-cached per-thread clone — so `subscribe()` observes the precise messages/isRunning/error state CopilotChat renders. Subscribing to the registry agent instead would see nothing (thread messages live on the clone).
- **v-show, not v-if, for the states:** hiding CopilotChat behind `v-if="connected"` would unmount it and its internal `connectAgent` would never run — a deadlock. `v-show` keeps it mounted and merely hides it while the spinner shows.
- **Never-run threads resolve connected via `onRunFinalized`:** the core's `connectAgent` completes empty streams without error (`lastValueFrom(..., { defaultValue })`), then `onFinalize` fires — this is what flips the loading state for RUNR-06 threads.
- **RUN_ERROR is an event, not a stream failure:** verified in the @ag-ui/client bundle that `RUN_ERROR` is applied via `onRunErrorEvent` while the run resolves normally — the wrapper owns the error label (inline row + toast), and `isRunning` resets via the finalize operator so the input re-enables without extra work.
- **Unambiguous streaming proof:** S-1 uses a never-run thread so the streamed "hello" can only come from the /run POST (the connect replay would have produced identical text); S-2 asserts the connect POST count ≥ 2 and extracts the threadId from the request BODY per the parseConnectRequest contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Error-builder unit tests hit RunAgentInputSchema required arrays**
- **Found during:** Task 2 (MockAgui error variant tests)
- **Issue:** The three new `buildErrorRunSseBody` tests passed minimal `{ threadId, runId }` inputs; `RunAgentInputSchema.parse` rejects them (`tools`/`context`/`messages` required) — the same schema constraint 05-01 recorded as its deviation #2.
- **Fix:** All three tests share a valid minimal input (`messages: [], tools: [], context: []`).
- **Files modified:** e2e/ui/fixtures/mock-agui.test.ts
- **Verification:** 8/8 fixture tests pass; typecheck clean.
- **Committed in:** e23734f7 (Task 2)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test-input correction only; no production code, fixture route behavior, or plan scope affected.

## Issues Encountered

- None beyond the documented deviation. The tracer gate re-run on the committed state passed (S-1/S-2 green) before expansion — the end-to-end slice held.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The full CopilotKit surface is proven end-to-end on the agent's best early-context tokens (mount → thread wiring → input slot → streaming render → fixture replay) — if the architecture were wrong (slot prop mismatch, connect contract drift) it would have failed here after one commit.
- 05-04 expansion can now wire: `#tool-call-${name}` slots (renderers from 05-02), the `#interrupt` slot (DecisionInterrupt), the "Stopped" label (stopRequested state already tracked), and SessionChatView's swap.
- Expected-soon-red (documented in the plan's verification): legacy chat-surface specs (chat.spec.ts, extended-chat, conversation-*, queue-messages, tool-rendering, delegate-rendering, interview-me) now break because the swapped UI no longer renders the old stack — Phase 6 migration fodder (VERF-02). Not chased green this phase.
- Pre-existing `bun test src/mainview` full-tree failures (85, Pinia store suites) remain documented in deferred-items.md; per-file suites + typecheck are the wave-gate evidence convention.

---

*Phase: 05-chat-ui-replacement-vue*
*Completed: 2026-08-09*

## Self-Check: PASSED

- All key files exist on disk (verified via `[ -f ]`): RailyinChat.vue, chat-copilotkit.spec.ts, 05-03-SUMMARY.md
- All task commits present in git log: bd578bd0 (Task 1 tracer), e23734f7 (Task 2 states), f1915ace (docs: complete plan)
- Wave gate: `bun run build` green; `chat-copilotkit.spec.ts` 4/4; `board.spec.ts` 34/34 (no layout regression from styles.css — Pitfall 4); `bun run typecheck` clean; unit suites 74 pass (mock-agui 8, toolCardDisplay/decisionRequest/useCommandsCache 66); full-dir `bun test src/mainview` at documented pre-existing baseline (deferred-items.md)

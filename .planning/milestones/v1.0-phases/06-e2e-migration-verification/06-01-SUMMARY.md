---
phase: 06-e2e-migration-verification
plan: 01
subsystem: testing
tags: [playwright, mock-agui, ag-ui, sse, copilotkit, e2e-migration]

# Dependency graph
requires:
  - phase: 05-chat-ui-replacement-vue
    provides: RailyinChat.vue new DOM (data-testids), mock-agui fixture + /run /connect /stop scripts, chat-copilotkit.spec.ts canonical template
provides:
  - "MockAgui.historyMessages knob on buildConnectReplaySseBody (Pattern 3) — configurable multi-message history replay, backward-compatible"
  - "MockAgui.registerHistory(threadId, messages) per-instance history registry (WR-05 parity)"
  - "Shared chat-surface helpers chatTextarea / submitChatMessage / collectConnectRequests in fixtures/helpers.ts + re-exports"
  - "conversation-stream-state.spec.ts migrated onto the agui fixture (3/3 green) — the migration pattern proven end-to-end"
affects: [06-03, 06-04, 06-05, 06-06, 06-07, chat.spec, task-drawer.spec, stream-reactivity.spec]

# Actuals (#2632) — pairs with the plan's estimate (28000 tokens)
actuals:
  tokens: 5113    # chars/4 over the realized diff (20450 chars)
  tasks: 3        # tasks completed
  commits: 4      # commits made (1 RED test + 3 feat)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "threadId-switch migration: per-thread registerHistory/registerThread + streaming via submitChatMessage + /run (S-1 pattern)"
    - "Fixture knob pattern: optional param defaults to byte-identical behavior; self-tests ship with the builder change (Pitfall 6)"
    - "Per-instance fixture state (WR-05): history map beside knownThreadIds, never module-level"

key-files:
  created: []
  modified:
    - e2e/ui/fixtures/mock-agui.ts
    - e2e/ui/fixtures/mock-agui.test.ts
    - e2e/ui/fixtures/helpers.ts
    - e2e/ui/fixtures/index.ts
    - e2e/ui/conversation-stream-state.spec.ts

key-decisions:
  - "historyMessages knob is `historyMessages ?? script-default` — it replaces the WHOLE snapshot ternary when provided (PATTERNS.md:211-263); omitted => byte-identical default body"
  - "registerHistory also marks the thread as has-run (registerThread parity) — a thread with history answers connect with a replay, never an empty body"
  - "Helpers extracted VERBATIM from chat-copilotkit.spec.ts:31-59 (same bodies, same JSDoc) — canonical spec keeps its inline copies (frozen, Pitfall 8)"
  - "SS-2 uses registerHistory for task A's prior content (fixture-driven replay on reopen) instead of ws.pushStreamEvent persistence"

patterns-established:
  - "Migrated spec shape: per-thread registerHistory + submitChatMessage stream + assertions on [data-testid=copilot-chat-view] only"
  - "Tracer-spec gate: migrated file must run green ALONE (Pitfall 4) before the aggregate tripwire"

requirements-completed: [VERF-02]

# Coverage (#1602) — one entry per shipped deliverable
coverage:
  - id: D1
    description: "MockAgui multi-message history knob — buildConnectReplaySseBody historyMessages param + MockAgui.registerHistory per-instance registry, default behavior byte-identical"
    requirement: VERF-02
    verification:
      - kind: unit
        ref: "e2e/ui/fixtures/mock-agui.test.ts#historyMessages knob: MESSAGES_SNAPSHOT carries the provided messages in order"
        status: pass
      - kind: unit
        ref: "e2e/ui/fixtures/mock-agui.test.ts#historyMessages omitted: snapshot stays the default single 'hello' message (backward compat)"
        status: pass
      - kind: unit
        ref: "e2e/ui/fixtures/mock-agui.test.ts#WR-05 parity: history registered on one instance never replays through another instance"
        status: pass
      - kind: unit
        ref: "e2e/ui/fixtures/mock-agui.test.ts#historyMessages knob keeps MESSAGES_SNAPSHOT strictly before the single terminal RUN_FINISHED"
        status: pass
    human_judgment: false
  - id: D2
    description: "Shared chat-surface helpers chatTextarea / submitChatMessage / collectConnectRequests extracted verbatim into fixtures/helpers.ts and re-exported from fixtures/index.ts; six legacy helpers byte-identical"
    verification:
      - kind: unit
        ref: "bun run typecheck (clean)"
        status: pass
      - kind: automated_ui
        ref: "playwright chat-copilotkit + board + board-ws-updates (56 passed, tripwire)"
        status: pass
    human_judgment: false
  - id: D3
    description: "conversation-stream-state.spec.ts migrated onto the agui fixture — SS-1/SS-2 threadId-switch pattern with per-thread registerHistory + /run streaming, SS-3 background isolation; zero legacy selectors, zero ws.pushStreamEvent"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/conversation-stream-state.spec.ts (3/3 passed alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56 passed)"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-08-09
status: complete
---

# Phase 6 Plan 1: Mock Foundation Extension + Tracer Spec Migration Summary

**MockAgui gains the configurable multi-message history replay knob (`historyMessages` + per-instance `registerHistory`), the chat-surface helpers move into the shared fixture layer, and the first spec (conversation-stream-state, 3 tests) is migrated onto the agui fixture — proving the 13-file migration wave pattern end-to-end**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-09T15:08:02Z (first task commit)
- **Completed:** 2026-08-09T15:10:58Z (last task commit)
- **Tasks:** 3 (1 tracer TDD, 2 auto)
- **Files modified:** 5

## Accomplishments

- `buildConnectReplaySseBody` accepts an optional `historyMessages` knob that replaces the script-default MESSAGES_SNAPSHOT (order preserved); omitted → byte-identical default body (backward compat proven by test)
- `MockAgui.registerHistory(threadId, messages)` stores per-thread history in a per-instance map beside `knownThreadIds` (WR-05 parity — isolation self-test); registerHistory implies has-run so a registered-history thread always replays
- mock-agui.test.ts grew 19 → 23 cases (≥4 new, matching the RESEARCH baseline expectation); every frame still EventEncoder + patchRunStartedInput framed — zero hand-rolled frames, /run branch untouched (Pitfall 3)
- `chatTextarea` / `submitChatMessage` / `collectConnectRequests` extracted VERBATIM from the frozen canonical spec into `fixtures/helpers.ts`, re-exported via `fixtures/index.ts`; all six legacy helpers byte-identical (append-only, Pitfall 3); chat-copilotkit.spec.ts untouched (Pitfall 8)
- conversation-stream-state.spec.ts rewritten onto the agui fixture: SS-1/SS-2 threadId-switch pattern (per-thread registerHistory + streaming via submitChatMessage + /run), SS-3 background-thread isolation; `taskTextChunk` helper, `StreamEvent` import, `conversations.getMessages` stubs, and all `ws.pushStreamEvent` usage deleted; zero `.msg--user` / `.msg--assistant` / `.msg__bubble.streaming` selectors
- Tracer spec proven end-to-end: file green ALONE (3/3, Pitfall 4) → tripwire green (56/56) → build clean; the tracer feedback gate re-verified the fixture + tripwire before expansion tasks

## Task Commits

Each task was committed atomically:

1. **Task 1 (tracer, TDD): MockAgui history knob + self-tests** — RED `d84c2065` (test), GREEN `94ce52d8` (feat)
2. **Task 2: Extract chat-surface helpers into fixtures** — `f5de68ed` (feat)
3. **Task 3: Migrate conversation-stream-state.spec.ts** — `1b94288b` (feat)

**Plan metadata:** `docs(06-01)` final commit (this summary).

## Files Created/Modified

- `e2e/ui/fixtures/mock-agui.ts` - `HistoryMessage` type, `historyMessages` knob on `buildConnectReplaySseBody`, `historyByThread` map + `registerHistory` on MockAgui, connect branch threading
- `e2e/ui/fixtures/mock-agui.test.ts` - 4 new builder cases: provided-messages order, default backward compat, per-instance isolation (WR-05 parity), snapshot-before-single-terminal
- `e2e/ui/fixtures/helpers.ts` - 3 new exports appended verbatim (chatTextarea, submitChatMessage, collectConnectRequests); legacy helpers untouched
- `e2e/ui/fixtures/index.ts` - re-export line extended with the 3 new helpers
- `e2e/ui/conversation-stream-state.spec.ts` - fully rewritten migration (65+/48−)

## Decisions Made

- Knob semantics: `historyMessages ?? script-default` replaces the entire snapshot ternary when provided — the ONLY builder change per PATTERNS.md:211-263; default path byte-identical
- `registerHistory` implies `registerThread` (thread marked has-run) so history-bearing threads never hit the empty-body path
- SS-2's "persistence" intent is expressed via fixture-driven replay (registerHistory) on reopen — the agui-fixture analog of ws-push persistence
- Helpers are verbatim copies (bodies + JSDoc) — the canonical spec's inline copies stay, keeping the frozen template untouched

## Deviations from Plan

None - plan executed exactly as written. TDD produced the expected RED (2 knob-dependent cases failed; the backward-compat guard passed as designed — it asserts pre-existing behavior) → GREEN (23/23) sequence.

## Issues Encountered

- **Type-probe finding (no code impact):** `e2e/tsconfig.json` strict typecheck has pre-existing errors in mock-agui.ts's MESSAGES_SNAPSHOT frame construction and index.ts fixture wiring (snapshot arrays are not assignable to the zod discriminated union). These predate this plan, are NOT covered by the plan's gate (`bun run typecheck` = root tsconfig, src-only), and were left untouched per the scope boundary. The knob follows the plan's exact `Array<{ id; role; content? }>` spec; runtime wire validity is guaranteed by EventEncoder framing + the 23 self-tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The 13-file migration wave (06-03..06-06) has its foundation: the history knob (consumed by chat.spec O-10, chat-session-drawer CD-E-1/E-4, task-drawer TD-5/6, stream-reactivity C-1/C-2/E-7) and the shared chat helpers
- conversation-stream-state (the smallest spec) proves the whole loop: fixture knob → shared helper → migrated spec green — the template for 06-03..06-06
- No blockers; remaining red surface is the other 12 migration-target files

---
*Phase: 06-e2e-migration-verification*
*Completed: 2026-08-09*

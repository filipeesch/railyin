---
phase: 06-e2e-migration-verification
plan: 04
subsystem: testing
tags: [playwright, mock-agui, ag-ui, sse, copilotkit, toolcall, reasoning, autoscroll, e2e-migration]

# Dependency graph
requires:
  - phase: 06-e2e-migration-verification
    plan: 01
    provides: MockAgui registerHistory knob + shared chat helpers (chatTextarea/submitChatMessage/collectConnectRequests)
  - phase: 05-chat-ui-replacement-vue
    provides: RailyinChat.vue new DOM + chat-copilotkit.spec.ts canonical template (S-1/C-1/C-2/T-1/T-2/T-3)
provides:
  - "tool-rendering.spec.ts migrated 13/13 onto the toolcall fixture (T-1/T-2/T-3): batched card order, FileChangesRenderer path+stats, subagent markdown, replay-completed stale state, cursor family model-agnostic"
  - "stream-reactivity.spec.ts migrated 17/17: quick/toolcall script floods, /connect replay reload, autoscroll contracts on the verified CopilotChat scroller, writtenFiles stats via tool-card-tc-write"
  - "timeline-pipeline.spec.ts migrated 7/7: S-1 quick streaming intents + C-2 reasoning intents; status_chunk + 12 legacy pipeline-mechanics tests retired in-file with rationale"
  - "The suite's red surface shrinks from 10 migrate files to 7 (chat.spec, chat-session-drawer, extended-chat, autocomplete, interview-me, cursor, task-drawer remain)"
affects: [06-05, 06-06, 06-07, chat.spec, chat-session-drawer.spec, extended-chat.spec, autocomplete.spec, interview-me.spec, cursor.spec, task-drawer.spec]

# Actuals (#2632) — pairs with the plan's estimate (33000 tokens)
actuals:
  tokens: 34513    # chars/4 over the realized diff (138050 chars, 3 spec files)
  tasks: 3         # tasks completed
  commits: 4       # commits made (3 feat + 1 docs)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Autoscroll assertions target the verified CopilotChat scroller ([data-testid=copilot-chat-view-scroll], overflow-y-scroll) — the .railyn-chat wrapper is NOT the scroller (T-06-15)"
    - "CopilotChat scroll-to-bottom affordance (copilot-chat-view-scroll-to-bottom) as the deterministic autoscroll-engagement signal"
    - "History-flood intents use registerHistory (06-01 knob) instead of ws.pushStreamEvent floods; geometry pre-check + test.skip for insufficient overflow"

key-files:
  created: []
  modified:
    - e2e/ui/tool-rendering.spec.ts
    - e2e/ui/stream-reactivity.spec.ts
    - e2e/ui/timeline-pipeline.spec.ts

key-decisions:
  - "B-1 (isolation) adapted instead of byte-identical: the file-level zero-ws.pushStreamEvent / zero-.conv-body gate conflicts with 'stay byte-identical'; the observer retargets the live chat surface and inert background textChunk pushes are dropped — D-1 stayed byte-identical"
  - "Autoscroll container: plan named .railyn-chat, but verification (T-06-15) found the actual scroller is [data-testid=copilot-chat-view-scroll] (overflow-y-scroll) — all E-suite assertions use it"
  - "tool-rendering S-28/S-29/S-30 retired in-test nuances (long-line horizontal scroll, read-family content, lsp_rename): the frozen toolcall fixture carries no read tool and no hunk data — no hand-rolled frames (T-06-18)"
  - "timeline-pipeline: only the plan-enumerated intents migrate (T-28/30/31/33/35 → quick, T-29/32 → reasoning); the 12 unenumerated legacy-pipeline-mechanics tests retire in-file with per-test rationale (T-06-17); T-33 is absent from the source (no-op)"
  - "G-1/G-2 writtenFiles stats derive from the canonical toolcall payload (+2 added, 0 removed) — the multi-file combined-stats nuance is retired (T-06-18, never hand-rolled seeds)"

patterns-established:
  - "Migrated streaming spec shape: registerHistory for floods/history, submitChatMessage + /run for live streams, tool-card-{id} testids for tools, [data-message-id] for message rows"
  - "Autoscroll contracts on CopilotChat: scroll-up disengages (button appears, viewport not dragged), scroll-to-bottom re-engages, reading position stable below the fold"

requirements-completed: [VERF-02]

# Coverage (#1602) — one entry per shipped deliverable
coverage:
  - id: D1
    description: "tool-rendering.spec.ts migrated 13/13 onto the toolcall fixture family — S-24 batched card order, S-25 FileChangesRenderer path+stats, S-26/S-31 subagent intent+markdown, S-27 T-3 replay-completed (no stale spinner), S-28/S-29 expanded FileDiff dispatch (no raw JSON), S-30 stat chips, cursor S-29..33 model-agnostic quick script; zero writtenFiles seeds / .tc / .fdiff__body constructs"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/tool-rendering.spec.ts (13/13 passed alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56 passed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "stream-reactivity.spec.ts migrated 17/17 — A-1..3 text/tool floods on quick/toolcall scripts, C-1/2 reopen replay via /connect + registerHistory, E-1..7 autoscroll contracts on the verified CopilotChat scroller (copilot-chat-view-scroll), F-1 progressive turn order, G-1/2 stats via tool-card-tc-write; B-2 (data-stream-version) + F-2 (status_chunk) retired in-file with rationale; B-1 adapted, D-1 byte-identical; zero ws.pushStreamEvent / .conv-body"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/stream-reactivity.spec.ts (17/17 passed alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56 passed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "timeline-pipeline.spec.ts migrated 7/7 — T-28/30/31/35 + T-37 on S-1 quick (stream renders, persists, merges into m1, settles, consecutive runs), T-29/32 on C-2 reasoning (r1 card + DOM order before m1); T-34/36 (status_chunk) + 12 legacy pipeline-mechanics tests retired in-file with per-test rationale; mkEvent/StreamEvent builders and .msg__bubble.streaming/.rb selectors deleted"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/timeline-pipeline.spec.ts (7/7 passed alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56 passed)"
        status: pass
      - kind: unit
        ref: "bun test e2e/ui/fixtures/mock-agui.test.ts (23/23 — fixture layer untouched)"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-08-09
status: complete
---

# Phase 6 Plan 4: Tool-Card, Stream-Reactivity & Timeline-Pipeline Migration Summary

**All three richest streaming specs migrated onto the agui fixture: tool-rendering 13/13 on the toolcall family (default/domain/replay-completed cards + model-agnostic cursor), stream-reactivity 17/17 with autoscroll contracts moved to the verified CopilotChat scroller and writtenFiles stats via tool-card-tc-write, timeline-pipeline 7/7 with status_chunk and 12 dead pipeline-mechanics tests retired — the suite's red surface shrinks from 10 migrate files to 7**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-09T15:16:00Z (first plan read)
- **Completed:** 2026-08-09T15:45:56Z (last task commit)
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **tool-rendering.spec.ts 13/13** on the toolcall fixture: S-24 batched cards in call order (generic + bash + sub + write testids), S-25 write card shows `src/auth.ts` + `+2` (FileChangesRenderer dispatch, verified at FileChangesRenderer.vue:15), S-26/S-31 subagent intent + markdown result, S-27 stale-state via the T-3 replay-completed path (`registerThread` before open; `.pi-check-circle` present, no `.pi-spinner`/`.pi-spin`, no "Running…"), S-28/S-29 expanded FileDiff dispatch with no raw JSON envelope, S-30 stat chips (+N present, no phantom −N), and the cursor S-29..33 family normalized to model-agnostic quick-script assertions (zero engine mocks — the cursor engine no longer drives chat rendering, D-01)
- **stream-reactivity.spec.ts 17/17**: A-1..3 text/tool floods via quick/toolcall script streams, C-1/2 history reload via `/connect` replay + `registerHistory` per-thread isolation, E-1..7 autoscroll suites on the **verified** CopilotChat scroll container `[data-testid="copilot-chat-view-scroll"]` (overflow-y-scroll; the `.railyn-chat` wrapper is not the scroller — T-06-15) — including disengage-on-scroll-up, re-engage-on-scroll-to-bottom, stable reading position below the fold, upward-wheel no-snap-back, and end-of-stream persistence; G-1/2 writtenFiles stats assert via `tool-card-tc-write` +N chips derived from the canonical payload (never hand-rolled seeds, T-06-18)
- **timeline-pipeline.spec.ts 7/7**: T-28/30/31/35 + T-37 on the S-1 quick pattern (live render, persistence after terminal, single merged `m1` row, settled state with no live indicator, consecutive-run freshness with a deterministic `runInputs.length === 2` poll); T-29/32 on the C-2 reasoning pattern (`[data-message-id="r1"]` collapsed card + DOM order before the text message); T-34/36 (status_chunk — trimmed) and 12 legacy pipeline-mechanics tests retired in-file with per-test rationale (T-06-17)
- **Legacy surface fully purged**: zero `ws.pushStreamEvent`, zero `.conv-body` / `.msg__bubble.streaming` / `.rb` / `.tc` / `.fdiff__body` selectors, zero `writtenFiles` seeds, zero `StreamEvent`/`mkEvent` builders across all three files (grep-verified — remaining mentions are retire-rationale comments)
- **Green-file protection held**: canonical chat-copilotkit.spec.ts untouched (Pitfall 8), shared helpers/fixtures untouched (Pitfall 3), mock-agui self-tests still 23/23; tripwire (chat-copilotkit + board + board-ws-updates) stayed 56/56 green after every migration

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate tool-rendering.spec.ts (13 tests — full tool-card family)** - `63d8f94f` (feat)
2. **Task 2: Migrate stream-reactivity.spec.ts (floods, autoscroll, writtenFiles stats)** - `e37e056b` (feat)
3. **Task 3: Migrate timeline-pipeline.spec.ts (streaming + reasoning intents)** - `09e0b0bf` (feat)

**Plan metadata:** `docs(06-04)` final commit (this summary).

## Files Created/Modified

- `e2e/ui/tool-rendering.spec.ts` - rewritten migration (217+/562−): 13 toolcall-family tests; writtenFiles seeds, `.tc` cards, `.fdiff__body` gone; cursor family model-agnostic
- `e2e/ui/stream-reactivity.spec.ts` - rewritten migration (496+/919−): 17 tests on quick/toolcall scripts + registerHistory; autoscroll on `copilot-chat-view-scroll`; B-2/F-2 retired in-file
- `e2e/ui/timeline-pipeline.spec.ts` - rewritten migration (155+/354−): 7 migrated tests (S-1 quick + C-2 reasoning); T-34/36 + 12 legacy-mechanics tests retired with rationale

## Decisions Made

- **B-1 adapted, not byte-identical** (plan-internal conflict): the file-level acceptance gate "zero ws.pushStreamEvent / zero .conv-body remain" cannot hold if B-1 keeps its legacy observer target and inert background text-chunk pushes. The isolation intent (background activity never mutates the active chat DOM) is preserved — observer retargeted to `[data-testid="copilot-chat-view"]`, positive proof via the task.updated unread dot. D-1 stayed byte-identical.
- **Autoscroll container resolved by verification** (T-06-15): the plan's `.railyn-chat` is the flex wrapper; the actual scroller is `[data-testid="copilot-chat-view-scroll"]` (overflow-y-scroll, verified in the installed @copilotkit/vue bundle). All E-suite scroll assertions and the scroll-to-bottom affordance checks use it.
- **In-file retire scope**: tool-rendering S-28 (long-line horizontal scroll — hunk-less fixture payload), top-level S-29 (read-family — no read tool in the frozen fixture), S-30 (lsp_rename — not in the fixture tool set), F-1 (per-token interleaving — fixture streams the full sequence), G-2 (multi-file combined stats — single-entry canonical payload), and the 12 timeline-pipeline legacy-mechanics tests all retire with explicit rationale rather than hand-rolled frames (T-06-18) or fixture extension (out of scope this plan).
- **T-35 implemented on the S-1 quick pattern** per the plan's mapping (settle intent: no live-run affordance after the terminal), even though its name references reasoning — the reasoning-card equivalent is covered by C-2's settled-label assertion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan-internal conflict] B-1 (isolation) minimally adapted instead of byte-identical**
- **Found during:** Task 2 (stream-reactivity migration)
- **Issue:** The plan's acceptance criteria simultaneously demand B-1 "stay byte-identical" and "zero ws.pushStreamEvent calls and zero .conv-body selectors remain" — B-1's legacy form uses both (background textChunk pushes + a `.task-detail .conv-body` MutationObserver target).
- **Fix:** Retargeted the observer to the live chat surface (`[data-testid="copilot-chat-view"]`), dropped the inert background textChunk pushes (the new stack has no background chat stream channel), kept the positive unread-dot proof via `ws.push(task.updated)` and the zero-mutations negative proof. D-1 untouched.
- **Files modified:** e2e/ui/stream-reactivity.spec.ts
- **Verification:** B-1 passes alone; file 17/17; tripwire 56/56.
- **Committed in:** e37e056b (Task 2 commit)

**2. [Rule 1 - Plan-internal conflict] timeline-pipeline unenumerated tests retired**
- **Found during:** Task 3 (timeline-pipeline migration)
- **Issue:** The plan enumerates 6-7 migrating intents + 2 status_chunk retires, but the source file holds 21 tests; the 12 unenumerated tests (T-38, S-1/S-2/S-4, T-46/48/49/53, T-56/57/58, R-1) exercise legacy stream-pipeline mechanics (executionId state machines, .rb pulse lifecycle, virtualized-body ordering/nesting) with no new-stack surface; T-33 is absent from the source entirely (the plan's list references it as migrating).
- **Fix:** Retired them in-file with a per-test rationale block (T-06-17), mapping each surviving intent to its canonical coverage (stop → C-1, tool rendering → T-2/S-24, ordering → T-32, consecutive runs → T-37, isolation → conversation-stream-state).
- **Files modified:** e2e/ui/timeline-pipeline.spec.ts
- **Verification:** 7/7 green alone; tripwire 56/56; grep confirms zero live legacy constructs.
- **Committed in:** 09e0b0bf (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (2 plan-internal conflicts resolved toward the file-level acceptance gates)
**Impact on plan:** Both fixes are required for the plan's own acceptance criteria to hold. No scope creep; no fixture or canonical-spec changes.

## Issues Encountered

- **E-3/E-4 initial failure (dev-cycle, not shipped):** the first stream-reactivity run failed two autoscroll tests because the run-count poll expected 2 runs where the design submits once (`agui.runInputs.length` toBe(2) vs toBe(1)). Fixed before commit; no code shipped broken.
- **Scroll-container discovery:** the plan's `.railyn-chat` selector proved to be the non-scrolling flex wrapper — resolved by bundle inspection (T-06-15 mitigation) before writing any scroll assertion, so no assertion ever targeted the wrong element.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The 3 richest streaming specs are green on the fixture foundation; remaining red migrate files: chat.spec, chat-session-drawer, extended-chat, autocomplete, interview-me, cursor, task-drawer (7 files for plans 06-05/06-06)
- Established for those plans: the registerHistory flood pattern (chat.spec O-10, chat-session-drawer CD-E-1/E-4, task-drawer TD-5/6), the CopilotChat scroller contract (chat-session-drawer scroll intents), and the toolcall-card retire discipline (no hand-rolled frames)
- No blockers; the canonical spec and fixtures remain untouched and green (tripwire 56/56, mock-agui self-tests 23/23)

---

*Phase: 06-e2e-migration-verification*
*Completed: 2026-08-09*

## Self-Check: PASSED

- SUMMARY file exists at `.planning/phases/06-e2e-migration-verification/06-04-SUMMARY.md`
- All 3 task commits exist: `63d8f94f`, `e37e056b`, `09e0b0bf`
- All three migrated spec files green alone (13/13, 17/17, 7/7) + tripwire 56/56 + mock-agui self-tests 23/23

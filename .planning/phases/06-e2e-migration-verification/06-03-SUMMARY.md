---
phase: 06-e2e-migration-verification
plan: 03
subsystem: testing
tags: [playwright, mock-agui, ag-ui, sse, copilotkit, e2e-migration, tool-cards, reasoning]

# Dependency graph
requires:
  - phase: 06-e2e-migration-verification (plan 06-01)
    provides: MockAgui history knob (registerHistory), chat-surface helpers, tracer-spec migration pattern
provides:
  - "chat.spec.ts migrated (12/12 green): M-1..M-4 streaming via /run (S-1), N-6 stop via slow-script + stop-btn + chat-stopped + agui.stopRequests (C-1), N-5/N-7 exec-* task-card asserts kept (board surface), N-8 empty-editor no-submit, N-9 editor-enabled-while-running (queue half retired), O-9/O-11 registerThread replay (S-2), O-10 registerHistory ordered 4-message replay"
  - "delegate-rendering.spec.ts migrated (5/5 green in parallel): all tests on tool-card-tc-sub (T-2 toolcall script, DelegateSummaryRenderer), serial mode dropped, makeDelegateMessages seed deleted"
  - "conversation-body.spec.ts migrated (3/3 green): CB-1/CB-1b reasoning via C-2 pattern (data-message-id=r1, collapsed→expand), CB-3 tool groups via T-2; CB-2 (virtualization — PERF-01 deferred) and CB-4 (transition cards — trimmed) retired in-file with rationale"
  - "Suite red surface shrinks from 13 migrate files to 10"
affects: [06-04, 06-05, 06-06, 06-07, chat-session-drawer.spec, extended-chat.spec, tool-rendering.spec]

# Actuals (#2632) — pairs with the plan's estimate (30000 tokens)
actuals:
  tokens: 13764    # chars/4 over the realized diff (3 spec rewrites: ~55k chars)
  tasks: 3         # tasks completed
  commits: 4       # commits made (3 task + 1 docs)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-file migration gate: migrated file green ALONE (Pitfall 4) before tripwire; tripwire (chat-copilotkit + board + board-ws-updates) green after every task (Pitfall 8 — canonical spec never edited)"
    - "C-1 stop pattern reuse: agui.script = 'slow' BEFORE submitChatMessage; assert stopRequests contains threadId; stop-btn visible during the 3s fixture hold, streamed text lands after the fulfill"
    - "In-file retire discipline: one-line rationale per retired test (queue half, CB-2, CB-4) + header comment; re-grep before deleting (Pitfall 2); zero legacy selectors verified per file"
    - "registerHistory ordering assertions: role-scoped row testids (copilot-user-message / copilot-assistant-message) for nth-message order in the chat view"
    - "Replayed reasoning collapse assertion via header aria-expanded (deterministic, not visibility-dependent)"

key-files:
  created: []
  modified:
    - e2e/ui/chat.spec.ts
    - e2e/ui/delegate-rendering.spec.ts
    - e2e/ui/conversation-body.spec.ts

key-decisions:
  - "M-2 streaming-while-running uses the slow script: stop-btn visible during the 3s response hold, then streamed text 'working on it' renders — the run finalizes when the terminal-less body completes, so stop-btn is asserted BEFORE the text lands"
  - "N-8 empty-editor intent maps to agui.runInputs.length === 0 after Enter (CopilotChatInput trims empty values — verified in node_modules source); the surface has no send button"
  - "CB-1b persisted-reasoning-collapsed is expressed via registerHistory reasoning-role snapshot: non-streaming replayed reasoning renders collapsed (aria-expanded=false, 'Thought for' label) — the agui-fixture analog of the legacy DB-loaded .rb"
  - "S-D5 orphaned-children intent becomes: every emitted tool call renders its own standalone card keyed by toolCallId (flat surface, nothing grouped away)"
  - "Serial mode dropped in delegate-rendering: per-test agui fixtures make parallel workers safe — proven by 5/5 green with default workers, zero did-not-run"

patterns-established:
  - "Migrated chat.spec shape: makeTask with explicit ids + api.handle('tasks.list') + agui fixture; N-* board-surface tests keep ws.push task.updated to drive exec-* card classes (D-03 board surface untouched)"
  - "Tool-family test shape (T-2): agui.script = 'toolcall' → submitChatMessage → tool-card-{toolCallId} assertions + expand via locator('button').first()"

requirements-completed: [VERF-02]

# Coverage (#1602) — one entry per shipped deliverable
coverage:
  - id: D1
    description: "chat.spec.ts migrated onto the agui fixture — 12 tests green (streaming via /run S-1, stop via slow-script C-1, history via registerThread/registerHistory S-2, exec-* task-card asserts kept, queue half retired with rationale); zero legacy chat selectors"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/chat.spec.ts (12/12 passed alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56 passed after task 1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "delegate-rendering.spec.ts migrated to tool-card-tc-sub (T-2 toolcall script) — 5/5 green with default parallel workers, serial mode dropped, makeDelegateMessages seed and legacy selectors deleted"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/delegate-rendering.spec.ts (5/5 passed alone, 5 workers, zero did-not-run)"
        status: pass
    human_judgment: false
  - id: D3
    description: "conversation-body.spec.ts migrated — CB-1/CB-1b reasoning via C-2 (data-message-id=r1 collapsed→expand, aria-expanded assertions), CB-3 tool groups via T-2; CB-2/CB-4 retired in-file with rationale; zero legacy selectors"
    requirement: VERF-02
    verification:
      - kind: e2e
        ref: "playwright e2e/ui/conversation-body.spec.ts (3/3 passed alone)"
        status: pass
      - kind: automated_ui
        ref: "playwright tripwire chat-copilotkit + board + board-ws-updates (56 passed after task 3 and final aggregate)"
        status: pass
      - kind: unit
        ref: "bun test e2e/ui/fixtures/mock-agui.test.ts (23 passed) + bun run typecheck (clean) — wave-merge gate"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-08-09
status: complete
---

# Phase 6 Plan 3: Streaming-Surface Spec Migration Summary

**The three core streaming-surface specs (chat.spec 12 tests, delegate-rendering 5 tests, conversation-body 3 tests) migrate onto the agui fixture — streaming via /run, stop via the slow-script C-1 pattern, history via registerThread/registerHistory — with the suite's red surface shrinking from 13 migrate files to 10**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-09T15:28:28Z (first task commit)
- **Completed:** 2026-08-09T15:30:07Z (last task commit)
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **chat.spec.ts (12/12 green)** — the largest legacy streaming spec: M-1/M-3/M-4 stream via submitChatMessage + /run quick script (S-1), replacing tasks.sendMessage stubs + ws.pushStreamEvent; M-2 proves streaming-while-running with the slow script (stop-btn during the held response, streamed text after); N-6 is the full C-1 stop pattern (slow script + stop-btn + chat-stopped + `agui.stopRequests` contains threadId); N-5/N-7 keep the `[data-task-id]` exec-* task-card class assertions byte-intact (board surface, ws-driven — D-03); N-8 asserts the empty editor cannot submit (`agui.runInputs` stays 0 — verified CopilotChatInput trims empty values); N-9 asserts the editor stays enabled while running (slow script), with its queue-button half retired in-file (queue UI removed, Research Open Question 5); O-9/O-11 use registerThread + collectConnectRequests history replay (S-2); O-10 uses registerHistory with the alternating 4-message array and asserts nth-message order via role-scoped row testids (`copilot-user-message` / `copilot-assistant-message`)
- **delegate-rendering.spec.ts (5/5 green, parallel)** — all five tests assert the DelegateSummaryRenderer via `[data-testid="tool-card-tc-sub"]` (agui.script = "toolcall", T-2): card renders (S-D1), header intent "Write the auth module" (S-D2), expand reveals the markdown result (S-D3), exactly one delegate card (S-D4), and every emitted tool call renders its own standalone card (S-D5 — the orphaned-children intent on the flat per-toolCallId surface). `test.describe.configure({ mode: "serial" })` deleted — the file ran 5/5 green with default workers, zero did-not-run (Pitfall 4). The 93-line makeDelegateMessages seed and all `.delegate-divider`/`.msg--assistant`/`.tc` selectors deleted
- **conversation-body.spec.ts (3/3 green)** — CB-1 migrates to the C-2 reasoning pattern (`[data-message-id="r1"]`, Thinking…|Thought for label, expand via first button → "Comparing two candidate designs", streamed answer follows); CB-1b expresses the persisted-reasoning-starts-collapsed intent via a registerHistory reasoning-role snapshot — replayed reasoning renders collapsed (header `aria-expanded="false"`, "Thought for" label) and expands on click; CB-3 migrates to the T-2 toolcall pattern (tc-bash/tc-sub/tc-write group rendering with expand assertions). CB-2 (virtualization — PERF-01 deferred, full-history replay is v1) and CB-4 (transition cards — transition_event in the trim list) are retired in-file with one-line rationales each
- Every migrated file ran green ALONE before its tripwire (Pitfall 4/9); the tripwire (chat-copilotkit + board + board-ws-updates) stayed 56/56 green after every task and in the final aggregate (D-03, Pitfall 8 — canonical spec never touched); no green non-chat spec was edited
- Wave-merge gate: `bun test e2e/ui/fixtures/mock-agui.test.ts` 23/23, `bun run typecheck` clean, red surface 593 tests across 42 spec files (no new files; counts 12/5/3 per migrated file)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate chat.spec.ts (12 tests)** — `214ef6cf` (feat)
2. **Task 2: Migrate delegate-rendering.spec.ts (5 tests, drop serial mode)** — `d14db5b2` (feat)
3. **Task 3: Migrate conversation-body.spec.ts (reasoning + tool groups, retire CB-2/CB-4)** — `626d2b24` (feat)

**Plan metadata:** `docs(06-03)` final commit (this summary).

## Files Created/Modified

- `e2e/ui/chat.spec.ts` - Full rewrite (214+/207−): suites M/N/O onto the agui fixture; S-1 streaming, C-1 stop, S-2 replay, registerHistory ordering; exec-* task-card asserts kept; N-9 queue half retired in-file
- `e2e/ui/delegate-rendering.spec.ts` - Full rewrite (110+/207−): 5 tests on tool-card-tc-sub (T-2); serial mode, makeDelegateMessages seed, and legacy selectors deleted
- `e2e/ui/conversation-body.spec.ts` - Full rewrite (89+/162−): CB-1/CB-1b → C-2 reasoning, CB-3 → T-2 toolcall; CB-2/CB-4 retired in-file; ws.pushStreamEvent seeds deleted

## Decisions Made

- **M-2 ordering:** with the slow script the run finalizes when the terminal-less body completes, so the stop-btn assertion (during the 3s response hold) must precede the streamed-text assertion — the legacy "streaming bubble" intent splits into "stop affordance while running" + "partial text renders"
- **N-8 rewrite:** the new surface has no send button; the empty-editor intent is expressed as "Enter on an empty editor never reaches the agent" (`agui.runInputs.length === 0`), verified against CopilotChatInput's trim guard
- **CB-1b via snapshot:** registerHistory reasoning-role message renders a non-streaming reasoning card that starts collapsed (aria-expanded=false) — the fixture-driven analog of the DB-loaded collapsed bubble; asserted via `aria-expanded` (deterministic) rather than text visibility (the collapsed content stays in the DOM behind the 0fr grid)
- **S-D5 flattening:** legacy orphaned-children grouping has no analog in the flat per-toolCallId tool-card surface — the intent becomes "every emitted tool call renders its own card"

## Deviations from Plan

None - plan executed exactly as written. All three files migrated per the PATTERNS map (rows 195/198/199); no fixture, helper, or canonical-spec changes were needed (registerHistory and the chat helpers arrived in 06-01).

## Issues Encountered

- **M-2 stop-btn flake on first run:** asserting stop-btn AFTER the streamed text failed — with the slow script the stop button is only visible during the 3s response hold (isRunning), and the text renders after the fulfill completes (when the run finalizes client-side). Fixed by reordering the assertions (stop-btn first, then text). Verified stable across re-runs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The three streaming-core files prove the migration pattern at scale: chat.spec (the oldest, most-referenced chat spec) validates S-1/S-2/C-1 + registerHistory ordering + board-surface coexistence; delegate-rendering proves the tool-call family (T-2); conversation-body proves the reasoning surface (C-2) — exactly the confidence the larger 06-04..06-06 files build from
- Red surface now 10 migrate files: chat-session-drawer, extended-chat, autocomplete, interview-me, timeline-pipeline, stream-reactivity, tool-rendering, cursor, task-drawer (conversation-stream-state done in 06-01)
- No blockers

---
*Phase: 06-e2e-migration-verification*
*Completed: 2026-08-09*

## Self-Check: PASSED

- SUMMARY.md exists at `.planning/phases/06-e2e-migration-verification/06-03-SUMMARY.md` ✓
- Commit `214ef6cf` (chat.spec migration) verified in git log ✓
- Commit `d14db5b2` (delegate-rendering migration) verified in git log ✓
- Commit `626d2b24` (conversation-body migration) verified in git log ✓

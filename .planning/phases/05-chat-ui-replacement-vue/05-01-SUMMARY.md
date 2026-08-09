---
phase: 05-chat-ui-replacement-vue
plan: 01
subsystem: testing
tags: [playwright, ag-ui, sse, fixtures, copilotkit, mock]

# Dependency graph
requires:
  - phase: 01-copilotruntime-hosting-thread-apis-spike
    provides: MockAgui byte-validated SSE fixture (mock-agui.ts) + buildQuickRunEvents canonical event source
provides:
  - MockAgui /connect SSE history replay route (CHAT-07 mock) with unit-tested buildConnectReplaySseBody
  - MockAgui /stop route ({ success: true }, CHAT-04 mock)
  - MockAgui.registerThread fixture-side thread registry (RUNR-06 empty-body path)
  - agui auto-use fixture wired into e2e/ui/fixtures/index.ts
  - vitest.config.ts include extended to e2e/ui/fixtures/**/*.test.ts
affects: [05-02, 05-03, 05-04, 05-05]

actuals:
  tokens: 3591   # 14362 diff chars / 4 over the realized diff
  tasks: 2
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mock routes dispatch run → connect → stop → info → 404, all framing through EventEncoder + MOCK_AGUI_SSE_HEADERS (never hand-rolled)"
    - "Fixture-side thread registry (registerThread) flips connect between replay and empty-body semantics (RUNR-06)"
    - "Auto-use fixture wiring for AG-UI traffic: agui installed alongside api; ApiMock route.fallback() defers /api/copilotkit/*"

key-files:
  created:
    - e2e/ui/fixtures/mock-agui.test.ts
  modified:
    - e2e/ui/fixtures/mock-agui.ts
    - e2e/ui/fixtures/index.ts
    - vitest.config.ts

key-decisions:
  - "threadId for /connect is parsed from the REQUEST BODY (mirroring the real runtime's parseConnectRequest → RunAgentInputSchema), not the URL path — the connect URL carries only agentId (plan text inaccuracy, fixed to match the real wire)"
  - "Replay body order is verifyEvents-valid: quick events minus their terminal RUN_FINISHED + MESSAGES_SNAPSHOT + single final RUN_FINISHED — the client rejects any event after RUN_FINISHED"

patterns-established:
  - "Connect replay reuses buildQuickRunEvents as the historic event base and the same encoder/patch path as buildQuickRunSseBody — the mock can never drift from the real wire format"

requirements-completed: [CHAT-01, CHAT-07]

coverage:
  - id: D1
    description: "buildConnectReplaySseBody unit-proven — canonical sequence (RUN_STARTED → MESSAGES_SNAPSHOT → RUN_FINISHED, single terminal), snapshot references the replayed hello message, empty body for never-run threads (RUNR-06), registerThread flip path"
    requirement: CHAT-07
    verification:
      - kind: unit
        ref: "e2e/ui/fixtures/mock-agui.test.ts#buildConnectReplaySseBody (5 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "MockAgui /connect + /stop routes dispatched before the 404 fallthrough (connect: SSE replay body per registered thread, 400 on malformed body; stop: { success: true } JSON)"
    requirement: CHAT-07
    verification: []
    human_judgment: true
    rationale: "Route dispatch needs a live Playwright page; exercised end-to-end by the 05-03+ chat specs that consume the agui fixture"
  - id: D3
    description: "agui auto-use fixture wired into e2e/ui/fixtures/index.ts — legacy regression proof: chat.spec.ts 12/12 passes with the fixture installed; no legacy spec modified"
    requirement: CHAT-01
    verification:
      - kind: e2e
        ref: "npx playwright test e2e/ui/chat.spec.ts (12 passed)"
        status: pass
    human_judgment: false

# Metrics
duration: 14min
completed: 2026-08-09
status: complete
---

# Phase 5 Plan 1: MockAgui connect/stop routes + agui fixture wiring Summary

**E2E fixture foundation for the Phase 5 chat suite: MockAgui now answers `/connect` with an EventEncoder-framed SSE history replay (RUN_STARTED + quick events + MESSAGES_SNAPSHOT + RUN_FINISHED; empty body for never-run threads per RUNR-06) and `/stop` with `{ success: true }`, unit-tested via a pure-node builder test suite, and wired as the auto-use `agui` fixture with legacy chat.spec.ts proven green.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-08-09T09:58:00Z
- **Completed:** 2026-08-09T10:12:18Z
- **Tasks:** 2
- **Files modified:** 4 (+1 new plan artifact: deferred-items.md)

## Accomplishments

- `POST /agent/:agentId/connect` route in MockAgui — SSE history replay driving CHAT-07 (threadId from the request body, mirroring the real runtime's `parseConnectRequest`)
- `buildConnectReplaySseBody(threadId)` — exported builder: registered thread → RUN_STARTED + quick event sequence (reusing `buildQuickRunEvents`) + MESSAGES_SNAPSHOT + single final RUN_FINISHED; never-run thread → empty body (RUNR-06); every frame through `EventEncoder` + `patchRunStartedInput` (never hand-rolled)
- `MockAgui.registerThread(threadId)` — fixture-side thread registry flipping empty → replay semantics
- `POST /agent/:agentId/stop/:threadId` → `{ success: true }` (CHAT-04 mock)
- `agui` auto-use fixture registered in `e2e/ui/fixtures/index.ts` (ws pattern, before `api`; install-order safe via ApiMock's `route.fallback()` for `/api/copilotkit/*`)
- `vitest.config.ts` include extended to `e2e/ui/fixtures/**/*.test.ts`; 5 unit tests pass, typecheck green

## Task Commits

Each task was committed atomically (TDD RED/GREEN for Task 1):

1. **Task 1 (RED): failing connect replay builder test** - `d5c48171` (test)
2. **Task 1 (GREEN): MockAgui connect/stop routes + builder + registry** - `7e81d6af` (feat)
3. **Task 2: agui auto-fixture wired, legacy chat.spec.ts green** - `bf3d73e4` (feat)

**Plan metadata:** pending — committed with this SUMMARY

## Files Created/Modified

- `e2e/ui/fixtures/mock-agui.ts` - connect/stop dispatch branches, `buildConnectReplaySseBody`, `registerThread`, updated usage header
- `e2e/ui/fixtures/mock-agui.test.ts` - 5 pure-node unit tests for the replay builder (sequence order, snapshot payload, RUNR-06 empty path, registerThread flip)
- `e2e/ui/fixtures/index.ts` - `agui: MockAgui` auto-use fixture
- `vitest.config.ts` - test.include extended to fixture tests
- `.planning/phases/05-chat-ui-replacement-vue/deferred-items.md` - pre-existing wave-gate issue logged (out of scope)

## Decisions Made

- **threadId source for /connect:** parsed from the request body (`RunAgentInput` JSON), mirroring the real runtime's `parseConnectRequest` — the connect URL path carries only the agentId (`fetch-router.mjs` "agent/connect" match). Plan text said "extract threadId from the path"; the wire contract says body. Fixture must stay byte-consistent with the real runtime (T-05-01 mitigation), so the body wins.
- **Replay terminal ordering:** `buildQuickRunEvents` already ends with `RUN_FINISHED`; appending `MESSAGES_SNAPSHOT` after it would be rejected by the client's `verifyEvents` ("The run has already finished with 'RUN_FINISHED'"). Dropped the quick terminal and appended snapshot + one final `RUN_FINISHED` — matches the plan's must-have truth (RUN_STARTED + historic events + MESSAGES_SNAPSHOT + RUN_FINISHED) while staying client-valid.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replay sequence order vs client verifyEvents**
- **Found during:** Task 1 (GREEN implementation)
- **Issue:** Plan's action said "reuse `buildQuickRunEvents(...)`, append a MESSAGES_SNAPSHOT, and end with RUN_FINISHED". Taken literally, `buildQuickRunEvents`' own terminal RUN_FINISHED would sit BEFORE the snapshot, and the client's `verifyEvents` rejects any event after RUN_FINISHED (verified in @ag-ui/client bundle) — the CHAT-07 specs would fail on mount.
- **Fix:** Filter the quick terminal out of the historic events, append MESSAGES_SNAPSHOT, then a single final RUN_FINISHED. Canonical sequence preserved (must-have truth), wire-valid.
- **Files modified:** e2e/ui/fixtures/mock-agui.ts
- **Verification:** Unit test asserts snapshot index < last RUN_FINISHED index and RUN_FINISHED is the last frame; `verifyEvents`-compatible ordering.
- **Committed in:** 7e81d6af (Task 1 GREEN)

**2. [Rule 3 - Blocking] RunAgentInputSchema requires tools/context arrays**
- **Found during:** Task 1 (GREEN implementation)
- **Issue:** Plan's minimal patch input `{ threadId, runId, messages: [], forwardedProps: { script: "quick" } }` fails `RunAgentInputSchema.parse` — `tools` and `context` are required (verified against installed @ag-ui/core@0.0.57).
- **Fix:** Added `tools: [], context: []` to the parsed input.
- **Files modified:** e2e/ui/fixtures/mock-agui.ts
- **Verification:** Builder test suite passes; parse succeeds.
- **Committed in:** 7e81d6af (Task 1 GREEN)

**3. [Rule 1 - Bug] Plan's "threadId from URL path" is not the wire contract**
- **Found during:** Task 1 (GREEN implementation)
- **Issue:** The connect URL (`/api/copilotkit/agent/:agentId/connect`) has no threadId segment — the real runtime reads it from the request body (`parseConnectRequest` → `RunAgentInputSchema.parse`). Following the plan text literally would yield an always-empty replay.
- **Fix:** Parse the POST body for `threadId`; malformed body → 400 (mirrors the runtime). Documented here as a plan-text correction.
- **Files modified:** e2e/ui/fixtures/mock-agui.ts
- **Verification:** Acceptance criteria met via body-parsed threadId + unit tests; future 05-03+ specs exercise the full round-trip.
- **Committed in:** 7e81d6af (Task 1 GREEN)

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking)
**Impact on plan:** All three keep the fixture byte-consistent with the real wire contract — the plan's core premise (T-05-01). No scope creep; no artifacts added beyond the plan's list.

## Issues Encountered

- **Wave gate `bun test src/mainview` (full directory) fails with 85 pre-existing failures** — Pinia store suites (task/chat/conversation/board/workspace/dispatch) fail only in full-tree runs (ref-unwrapping artifacts: `store.messages` → `{ value: [...] }`); every store test file passes in isolation and at the pre-plan commit `b0087c7a` (113 pass / 85 fail, identical). Not caused by this plan — logged to `deferred-items.md` per the scope boundary; wave-gate evidence instead uses the per-file runs + unaffected suites.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 05-02/05-03 chat specs can consume `agui` from `./fixtures` for CHAT-07 (connect replay) and CHAT-04 (stop) assertions.
- The `/connect` replay route needs its own spec coverage in 05-03+ (D2 classified human-judgment for now).
- Pre-existing `bun test src/mainview` full-tree failures (85) should be addressed before the phase's wave gates / ship — see deferred-items.md.

---
*Phase: 05-chat-ui-replacement-vue*
*Completed: 2026-08-09*

---
phase: 1-copilotruntime-hosting-thread-apis-spike
plan: 3
subsystem: testing
tags: [copilotkit, ag-ui, sse, playwright, fixtures, mock-agui, route-fallback, host-03, d-07]

# Dependency graph
requires:
  - phase: 1-copilotruntime-hosting-thread-apis-spike
    provides: 01-02 runtime mount + probe-agent.ts buildQuickRunEvents canonical event builder + copilotkitProbe server seam
provides:
  - MockAgui fixture class (e2e/ui/fixtures/mock-agui.ts) for /api/copilotkit/* — SSE quick-run stream, /info JSON, 404 fallthrough; SSE bodies built from EventEncoder (@ag-ui/encoder) + buildQuickRunEvents + RunAgentInputSchema input patch; validated byte-for-byte against the real server (D-07)
  - ApiMock route-conflict fix: /api/copilotkit/* skipped via route.fallback() before the 501 lookup (loud-501 preserved for all other unhandled paths); header doc declares mock-agui ownership
  - e2e/api/copilotkit/sse-text-diff.test.ts — Pattern 3 fixture validation: real-server capture vs fixture text, strict frame-array AND full-body byte equality + shared header assertions
  - PROJECT.md HOST-03 evidence record: fetch-native decision (supersedes hono assumption), exact pins, idleTimeout config (server.timeout(req,0) + global 30), stop-route shape, 1.66.4 thread-endpoint finding, verbatim /info + GET /threads JSON
affects: [phase 6 E2E fixture foundation (consumes MockAgui), phase 4 thread-index contract (CHAT-08), verify-work UAT]

actuals:
  tokens: 4685        # 18741 diff chars / 4 over the realized diff (4 files, 329 insertions)
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fixture framing single-source-of-truth: EventEncoder (@ag-ui/encoder) for SSE framing, buildQuickRunEvents (probe-agent.ts) for the event sequence, RunAgentInputSchema (@ag-ui/core) for the RUN_STARTED input patch — no hand-rolled string templates anywhere"
    - "Runner behavior replication: the fixture replicates InMemoryAgentRunner's RUN_STARTED input patching (in-memory.mjs) so mock wire text is byte-identical to the real server"
    - "Playwright route ownership: ApiMock dispatcher falls back /api/copilotkit/* to the next registered route (MockAgui) via route.fallback() — first route.fallback usage in the codebase (PATTERNS.md resolution A)"

key-files:
  created: [e2e/ui/fixtures/mock-agui.ts, e2e/api/copilotkit/sse-text-diff.test.ts, .planning/phases/01-copilotruntime-hosting-thread-apis-spike/deferred-items.md]
  modified: [e2e/ui/fixtures/mock-api.ts, .planning/PROJECT.md]

key-decisions:
  - "Runner input-patch replication: the plan's test sketch (encode buildQuickRunEvents directly) cannot be byte-identical — the real runner injects `input` into RUN_STARTED (in-memory.mjs line 377-380). The fixture builder parses the request with RunAgentInputSchema (schema key order matches the runner's patched object) and applies the same patch, keeping strict equality intact"
  - "Fixture /info mirrors the real shape (agents.default + mode sse); any Phase 6 capability additions must be re-validated against the real server (T-1-09)"
  - "MockAgui NOT wired into e2e/ui/fixtures/index.ts — Phase 6 consumes it; install() shape is identical from day one (PATTERNS.md)"

patterns-established:
  - "Pattern: validate wire-mirroring fixtures by byte-identical SSE text diff vs a real spawned server (research Pattern 3) — mechanical drift catch for framing, key order, double newlines"
  - "Pattern: scheme-less Playwright route globs resolve against playwright.config.ts baseURL — standalone verification harnesses must set baseURL to mirror the real runner"

requirements-completed: [HOST-01, HOST-03]

coverage:
  - id: D1
    description: "MockAgui fixture for /api/copilotkit/* (POST run → SSE quick stream, GET /info → agents.default + mode sse JSON, unknown paths → 404), SSE bodies built from EventEncoder + buildQuickRunEvents + RunAgentInputSchema input patch — fixture wire text proven byte-identical to the real server's captured SSE text for the quick scenario"
    requirement: HOST-01
    verification:
      - kind: unit
        ref: "e2e/api/copilotkit/sse-text-diff.test.ts#MockAgui SSE body builder (fixture framing, D-07) > quick scenario produces 5 `data: {json}` frames with no event:/id: fields"
        status: pass
      - kind: unit
        ref: "e2e/api/copilotkit/sse-text-diff.test.ts#MockAgui SSE body builder (fixture framing, D-07) > RUN_STARTED carries the runner-patched input (schema key order)"
        status: pass
      - kind: integration
        ref: "e2e/api/copilotkit/sse-text-diff.test.ts#SSE text diff vs the real server (D-07, Pattern 3) > fixture frames are byte-identical to real captured frames (quick scenario)"
        status: pass
    human_judgment: false
  - id: D2
    description: "ApiMock no longer 501s /api/copilotkit/* — route.fallback() hands the prefix to MockAgui (verified in a headless chromium run: run → 200 SSE, info → 200 JSON, unknown copilotkit path → 404); loud-501 preserved for other unhandled /api paths"
    verification:
      - kind: other
        ref: "headless chromium probe (baseURL mirroring playwright.config.ts): run 200 text/event-stream + info 200 JSON + unknown 404 + rpc-unhandled 501 => PASS"
        status: pass
    human_judgment: false
  - id: D3
    description: "PROJECT.md HOST-03 evidence: fetch-native decision recorded (supersedes hono assumption), exact pins (@ag-ui/*@0.0.57, @copilotkit/runtime|vue@1.66.4), idleTimeout config (server.timeout(req, 0) + global 30), stop-route shape, 1.66.4 thread-endpoint finding, verbatim /info + GET /threads JSON captures"
    requirement: HOST-03
    verification:
      - kind: other
        ref: "grep -v '^#' .planning/PROJECT.md | grep -c 'fetch-native' (3) / 'server.timeout(req, 0)' (1) / '1.66.4' (4) / '0.0.57' (2); bun run typecheck exit 0"
        status: pass
    human_judgment: false

# Metrics
duration: 7min
completed: 2026-08-08
status: complete
---

# Phase 1 Plan 3: Mock Runtime Fixtures & HOST-03 Evidence Summary

**MockAgui fixture for `/api/copilotkit/*` built with EventEncoder + buildQuickRunEvents + RunAgentInputSchema (no hand-rolled framing), validated byte-for-byte against the real server by the SSE text-diff test (D-07), ApiMock route conflict resolved via `route.fallback()`, and the fetch-native decision with verbatim `/info` + `GET /threads` evidence recorded in PROJECT.md (HOST-03)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-08T22:03:49Z
- **Completed:** 2026-08-08T22:10:34Z
- **Tasks:** 3
- **Files modified:** 4 (+1 deferred-items log)

## Accomplishments

- **MockAgui fixture (D-07 foundation):** `e2e/ui/fixtures/mock-agui.ts` — `MockAgui` class in the WsMock shape (`constructor(page)` / `install()`), registering `page.route("/api/copilotkit/**")` with run (SSE quick stream, 400 on malformed/schema-invalid bodies), `/info` (agents.default + mode sse), and 404 handlers. SSE bodies are built from **EventEncoder** (`@ag-ui/encoder`), the **canonical event sequence** (`buildQuickRunEvents` from probe-agent.ts), and a **RunAgentInputSchema-derived input patch** that replicates InMemoryAgentRunner's own RUN_STARTED patching — never a hand-rolled string template, so the fixture cannot drift from the wire format
- **Byte-identical fixture validation (D-07 / success criterion 5):** `sse-text-diff.test.ts` runs the same quick scenario against the real spawned server (`startServer({ copilotkitProbe: true })` + raw fetch, capture regenerated in-test — no stale capture file) and through the fixture builder; asserts **strict frame-array equality AND full-body byte equality** (pinning trailing `\n\n` framing), plus shared `content-type`/`cache-control` headers. 4/4 pass
- **ApiMock route conflict resolved (T-1-07 / PATTERNS.md resolution A):** `mock-api.ts` skips `/api/copilotkit/` via `route.fallback()` before the 501 lookup; the loud-501 fail-fast stays for every other unhandled path. Proven in a headless chromium run (run → 200 SSE, info → 200 JSON, unknown → 404, unhandled RPC path → 501)
- **HOST-03 evidence recorded (success criterion 4):** PROJECT.md Key Decisions hono row flipped to the decided fetch-native outcome; Context bullet corrected; E2E bullet updated; dated footer evidence subsection with exact pins (0.0.57 / 1.66.4), idleTimeout config (`server.timeout(req, 0)` on copilotkit paths + global 30 — verified >32s silence survival), stop-route shape, the 1.66.4 thread-endpoint finding, and **verbatim `/info` + `GET /threads` JSON captures** for the Phase 4 contract
- **Full API suite regression green:** 54 pass / 0 fail across 6 files (mount + fixtures coexist; includes the 32s HOST-02 silence test)

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1 (TDD RED):** `ccfea0f2` (test) — failing diff test: MockAgui framing unit assertions + real-server diff describe (fails on missing mock-agui module)
2. **Task 1 (TDD GREEN):** `6e84f131` (feat) — MockAgui fixture + ApiMock `route.fallback()` fix; 4/4 tests pass, typecheck clean
3. **Task 2:** `eb5647b9` (test) — hardened diff with full-body byte equality + trailing `\n\n` framing assertion
4. **Task 3:** `990533e4` (docs) — PROJECT.md HOST-03 evidence (fetch-native decision, pins, idleTimeout config, verbatim /info + /threads JSON)

**Plan metadata:** `01-03-SUMMARY.md` + `deferred-items.md` (docs: complete plan)

## Files Created/Modified

- `e2e/ui/fixtures/mock-agui.ts` - `MockAgui` class (constructor(page)/install()); `buildQuickRunSseBody` exported builder (EventEncoder + buildQuickRunEvents + RunAgentInputSchema input patch); `MOCK_AGUI_SSE_HEADERS`; run/info/404 route handlers; NOT wired into fixtures/index.ts (Phase 6 consumes it)
- `e2e/ui/fixtures/mock-api.ts` - `/api/copilotkit/` skipped via `route.fallback()` before the 501 lookup; header comment declares mock-agui ownership of the prefix
- `e2e/api/copilotkit/sse-text-diff.test.ts` - 4 tests: fixture framing unit checks (5 `data:` frames, no event:/id:, patched input) + real-server diff (frame-array AND full-body byte equality + shared headers)
- `.planning/PROJECT.md` - Key Decisions fetch-native row, corrected Context bullet, E2E bullet, dated HOST-03 evidence subsection
- `.planning/phases/01-copilotruntime-hosting-thread-apis-spike/deferred-items.md` - out-of-scope discovery log (pre-existing e2e tsconfig baseline errors)

## Decisions Made

- **Runner input-patch replication:** the plan's Task 2 sketch (encode `buildQuickRunEvents` directly) cannot yield byte-identical frames — the real runner injects `input` into RUN_STARTED (in-memory.mjs). The fixture parses the request with `RunAgentInputSchema` (schema key order exactly matches the runner's patched object) and applies the same patch; the strict-equality diff then passes with zero normalization. Keeps the "no re-typed literals" criterion (events still come from the shared builder)
- **Fixture /info mirrors the real shape** (agents.default + mode "sse", T-1-09): any Phase 6 capability additions must be re-validated against the real server before use
- **Full-body equality assertion added** (strictly stronger than frame-array equality): pins trailing `\n\n` and separator counts — the strongest form of the D-07 drift catch

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] RUN_STARTED input patching breaks the planned byte-identical diff**
- **Found during:** Task 1 (fixture design, empirical probe of the real wire text before authoring)
- **Issue:** The plan's test sketch — encode `buildQuickRunEvents("diff-t1", "diff-r1")` — cannot match the real wire: `InMemoryAgentRunner` injects `input` (the zod-parsed request) into RUN_STARTED before framing (in-memory.mjs lines 377-380), so the real frame is `{"type":"RUN_STARTED",...,"input":{threadId,runId,state,messages,tools,context,forwardedProps}}` in **schema key order** (verified empirically). The raw builder omits it — strict equality would fail on frame 1
- **Fix:** The fixture's `buildQuickRunSseBody` parses the request with `RunAgentInputSchema.parse()` (producing the same schema-ordered object the runner patches in) and applies the identical patch. Byte-identity restored without normalizing either side
- **Files modified:** e2e/ui/fixtures/mock-agui.ts, e2e/api/copilotkit/sse-text-diff.test.ts
- **Verification:** sse-text-diff.test.ts 4/4 pass (frame + full-body byte equality); typecheck clean
- **Committed in:** ccfea0f2 + 6e84f131 (Task 1 RED/GREEN)

**2. [Rule 3 - Blocking] Standalone Playwright verification resolved the wrong playwright-core version**
- **Found during:** Task 1 verification (route-conflict browser probe)
- **Issue:** Verification scripts run from outside the project tree made bun resolve a different playwright-core (1.62.1 global cache) than the project's 1.59.1, and scheme-less route globs (`/api/**`) only match against `playwright.config.ts`'s `baseURL` — the probe's fetches fell through to the stub server, initially misreading the fixture as broken
- **Fix:** Ran the probe with the script inside the project and `browser.newPage({ baseURL })` mirroring playwright.config.ts — the real runner semantics. Route-conflict verified: run → 200 SSE, info → 200 JSON, unknown → 404 `{error:"Not found"}`, unhandled RPC path → 501
- **Files modified:** none (verification harness only)
- **Verification:** ROUTE-CONFLICT VERIFIED: PASS
- **Committed in:** n/a (no artifact change)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes were necessary for the acceptance criteria (byte-identical diff) and for correct verification; no scope creep. The input-patch replication is the most important deliverable-quality correction — without it the fixture would silently drift from the real wire on frame 1, exactly the failure D-07 exists to catch.

## Issues Encountered

- **Pre-existing e2e typecheck baseline:** `tsc -p e2e/tsconfig.json` reports 95 pre-existing errors in unrelated Playwright specs (autocomplete.spec.ts, board.spec.ts, chat-session-drawer.spec.ts, …); zero in copilotkit/mock-agui files. Root `bun run typecheck` (the project's canonical command) does not include e2e and passes. Logged to `deferred-items.md` — out of scope for the spike

## Authentication Gates

- None. The spike is fully local (no external services, no API keys).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Phase 6 E2E foundation (D-07):** `MockAgui` is built, browser-verified, and byte-validated — Phase 6 wires it into `e2e/ui/fixtures/index.ts` (parallel `agui` auto-fixture, per PATTERNS.md) and consumes the proven wire format; any capability additions (connect/stop/threads mocks) must be re-validated against the real server first (T-1-09)
- **Phase 4 thread-index contract (CHAT-08):** PROJECT.md footer now carries the verbatim `/info` + `GET /threads` captures, the local-thread-endpoint finding (list/inspect work self-hosted; mutations 422), and the `threads/:threadId/events` route-shape correction — the contract can be written from evidence
- **Phase 2 engine bridge:** unchanged by this plan; the composition-root mount shape from 01-02 remains the slot-in point

---

*Phase: 1-copilotruntime-hosting-thread-apis-spike*
*Completed: 2026-08-08*

## Self-Check: PASSED

- All plan files exist on disk: `e2e/ui/fixtures/mock-agui.ts` (FOUND), `e2e/ui/fixtures/mock-api.ts` (modified, FOUND), `e2e/api/copilotkit/sse-text-diff.test.ts` (FOUND), `.planning/PROJECT.md` (modified, FOUND)
- All 4 task commits exist in git log: ccfea0f2 (test RED), 6e84f131 (feat GREEN), eb5647b9 (test), 990533e4 (docs)
- Plan-level verification re-run green: `bun test e2e/api/copilotkit/sse-text-diff.test.ts` (4 pass), `bun test e2e/api --timeout 30000` (54 pass, 0 fail), `bun run typecheck` (0 errors), PROJECT.md greps (fetch-native 3, server.timeout(req, 0) 1, 1.66.4 4, 0.0.57 2)
- Route-conflict browser probe: PASS (run 200 SSE / info 200 / unknown 404 / unhandled 501)

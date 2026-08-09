---
phase: 1-copilotruntime-hosting-thread-apis-spike
plan: 2
subsystem: api
tags: [copilotkit, ag-ui, bun, sse, runtime-mount, host-01, host-02]

# Dependency graph
requires:
  - phase: 1-copilotruntime-hosting-thread-apis-spike
    provides: 01-01 exact pins (@copilotkit/runtime@1.66.4, @ag-ui/*@0.0.57) + green install
provides:
  - CopilotRuntime mounted in the existing Bun.serve origin under /api/copilotkit/* via the fetch-native createCopilotRuntimeHandler (D-01, no CORS — D-03), dispatched BEFORE the RPC router (Pitfall 3)
  - HOST-02 mitigation: per-request srv.timeout(req, 0) on copilotkit paths only; global idleTimeout 30 stays — empirically proven by a 32s-silence survival test
  - RAILYN_COPILOTKIT_PROBE=1 env gate: ScriptedAgent registered only under the probe flag (dynamic import keeps e2e/ out of the prod module graph; prod /info shows agents:{} — T-1-03)
  - e2e/api/copilotkit/probe-agent.ts: ScriptedAgent (AbstractAgent, Observable run() contract) + buildQuickRunEvents canonical event builder (01-03 text-diff source of truth)
  - e2e/api/fixtures/server.ts copilotkitProbe seam; copilotkit.test.ts 8 integration tests (info/run/stop/silence/connect/400/404/threads) all green against a real spawned server
  - D-08 evidence: /info JSON shape, GET /threads {threads, nextCursor:null}, thread route shape correction (threads/:threadId/events — NOT threads/events/:threadId) recorded verbatim
affects: [01-03-fixture-validation, phase 2 engine-bridge, phase 4 thread-index contract]

actuals:
  tokens: 4720        # 18882 diff chars / 4 over the realized diff (4 files, 319 insertions)
  tasks: 2
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Prefix-dispatch runtime mount: copilotkit branch BEFORE the POST /api/ RPC router, srv.timeout(req, 0) on those requests only, no RPC try/catch wrap (would corrupt SSE)"
    - "Env-gated test-only injection: RAILYN_COPILOTKIT_PROBE=1 + dynamic await import of the e2e/ probe module — prod module graph never pulls e2e/"
    - "ScriptedAgent: AbstractAgent with run() returning rxjs Observable wrapping an async generator; RUN_STARTED emitted FIRST (runtime does not synthesize it) and RUN_FINISHED emitted by the agent (finalizeRunEvents would inject RUN_ERROR otherwise)"

key-files:
  created: [e2e/api/copilotkit/probe-agent.ts, e2e/api/copilotkit/copilotkit.test.ts]
  modified: [src/bun/index.ts, e2e/api/fixtures/server.ts]

key-decisions:
  - "D-01 executed: fetch-native createCopilotRuntimeHandler (NOT hono) mounted directly in the Bun.serve fetch handler — zero framework deps, reversible one-line swap"
  - "Dual-rxjs type bridge: top-level rxjs@7.8.2 from() vs @ag-ui/client's nested 7.8.1 Observable are structurally incompatible at the type level (Subscriber invariance) but interoperate at runtime (proven end-to-end); a targeted cast documents and bridges the gap"
  - "RUN_STARTED.input omitted from the agent — the InMemoryAgentRunner patches the full request input in before framing (verified in in-memory.mjs), keeping the canonical event builder true to what the agent emits"
  - "Thread route shape correction (D-08 evidence): 1.66.4 serves GET /threads/:threadId/events (threadId at len-2); the researched /threads/events/:threadId 404s — Phase 4 contract must use the real shape"

patterns-established:
  - "Pattern: fetch-native CopilotRuntime mount with per-request idle-timeout override — the composition-root shape Phase 2's real-engine bridge mounts into"

requirements-completed: [HOST-01, HOST-02]

coverage:
  - id: D1
    description: "CopilotRuntime mounted in the single Bun.serve origin under /api/copilotkit/* (fetch-native handler, multi-route, no CORS) — /info advertises agents.default + mode sse; run round-trips SSE with RUN_STARTED first and RUN_FINISHED last"
    requirement: HOST-01
    verification:
      - kind: integration
        ref: "e2e/api/copilotkit/copilotkit.test.ts#A: GET /api/copilotkit/info advertises agents.default and mode sse"
        status: pass
      - kind: integration
        ref: "e2e/api/copilotkit/copilotkit.test.ts#B: POST run round-trips SSE with RUN_STARTED first, RUN_FINISHED last, no CORS header"
        status: pass
      - kind: integration
        ref: "e2e/api/copilotkit/copilotkit.test.ts#C: POST stop/:threadId during a silence run returns {stopped:true}"
        status: pass
      - kind: integration
        ref: "e2e/api/copilotkit/copilotkit.test.ts#7: T-1-04 — unknown copilotkit subpath returns the runtime's own 404, not the RPC router's"
        status: pass
    human_judgment: false
  - id: D2
    description: "Long SSE streams survive extended agent silences — per-request server.timeout(req, 0) override on copilotkit paths proven by a 32s silence (> global idleTimeout 30) delivering TEXT_MESSAGE_CONTENT + RUN_FINISHED after"
    requirement: HOST-02
    verification:
      - kind: integration
        ref: "e2e/api/copilotkit/copilotkit.test.ts#4: HOST-02 — stream survives a >30s agent silence (server.timeout(req,0) override)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ScriptedAgent probe is registered ONLY under RAILYN_COPILOTKIT_PROBE=1 — prod-path /info returns agents:{} and run on default 404s (fake agent never exposed)"
    requirement: HOST-01
    verification:
      - kind: other
        ref: "manual probe: startServer() without copilotkitProbe -> /info agents:{} ; POST run -> 404 Agent not found"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-06 empty-snapshot contract + D-08 thread-route evidence: connect on never-run thread returns 200 SSE with zero frames; GET /threads lists t1 with nextCursor null; GET /threads/:threadId/events returns the run events verbatim (route shape correction recorded)"
    verification:
      - kind: integration
        ref: "e2e/api/copilotkit/copilotkit.test.ts#5: D-06 — connect on a never-run thread returns an empty SSE snapshot (zero frames)"
        status: pass
      - kind: integration
        ref: "e2e/api/copilotkit/copilotkit.test.ts#8: D-08 — GET /threads lists the run thread; /threads/:threadId/events recorded as evidence"
        status: pass
    human_judgment: false

# Metrics
duration: 34min
completed: 2026-08-08
status: complete
---

# Phase 1 Plan 2: CopilotRuntime Mount & Run/Stop SSE Round-Trip Summary

**Fetch-native CopilotRuntime mounted in the existing Bun.serve origin under /api/copilotkit/* with a per-request `server.timeout(req, 0)` idle-timeout override, proven by 8 green integration tests against a real spawned server — including a 32s-silence survival run (HOST-02), an empty-connect snapshot (D-06), and verbatim thread-route evidence (D-08)**

## Performance

- **Duration:** 34 min
- **Started:** 2026-08-08T21:49:27Z
- **Completed:** 2026-08-08T22:23:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- **HOST-01 proven:** `GET /api/copilotkit/info` returns 200 JSON with `agents.default` + `mode: "sse"`; `POST /agent/default/run` returns `text/event-stream` with `RUN_STARTED` as the first frame and `RUN_FINISHED` closing the stream; `POST /agent/default/stop/:threadId` returns `{stopped: true}` mid-silence — all from the SAME Bun.serve origin (single process, no second listener, D-01/D-02/D-03)
- **HOST-02 proven empirically (assumption A2):** a run with a 32-second agent silence (exceeding the global `idleTimeout: 30`) still delivered `TEXT_MESSAGE_CONTENT` + `RUN_FINISHED` after the silence — the per-request `srv.timeout(req, 0)` override works exactly as Bun documents, kept off all other paths
- **Env-gated probe (T-1-03):** the ScriptedAgent is loaded via dynamic `await import("../../e2e/api/copilotkit/probe-agent.ts")` ONLY when `RAILYN_COPILOTKIT_PROBE=1`; prod-path verification shows `/info` → `agents: {}` and a run on `default` → `404 Agent not found` — the fake agent never enters the prod module graph
- **Wire-level SSE verification:** raw-fetch probes parse `data: {json}\n\n` frames directly (no typed client), confirming the exact 1.66.4 framing, no `access-control-allow-origin` header (D-03 reconfirmed), and the runtime's own `404 {error:"Not found"}` on unknown copilotkit subpaths (T-1-04 — the RPC router never sees these paths)
- **D-08 evidence captured:** `/info` shape, `GET /threads` → `{threads, nextCursor: null}` listing the run thread, and `GET /threads/t1/events` returning the full run event history — with a **route-shape correction**: 1.66.4 serves `threads/:threadId/events`, the researched `threads/events/:threadId` 404s (recorded in test output as correction evidence)

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1 (tracer):** `069c1baf` (test — RED: probe-agent.ts + server.ts seam + tests A/B/C failing 404 without mount)
2. **Task 1 (tracer):** `5c459e47` (feat — GREEN: index.ts mount, env gate, timeout override — 3/3 tests pass, typecheck clean)
3. **Task 2:** `32734be6` (test — tests 4-8: HOST-02 silence, D-06 empty connect, 400, 404, threads evidence)

## Files Created/Modified

- `src/bun/index.ts` - Top-level `CopilotRuntime` + `createCopilotRuntimeHandler` imports; env-gated dynamic import of the probe agent; `copilotHandler` construction (basePath `/api/copilotkit`, multi-route, no cors); fetch-handler branch BEFORE the RPC router calling `srv.timeout(req, 0)` then delegating
- `e2e/api/fixtures/server.ts` - `StartServerOptions.copilotkitProbe?: boolean` → `extraEnv.RAILYN_COPILOTKIT_PROBE = "1"` seam
- `e2e/api/copilotkit/probe-agent.ts` - `ScriptedAgent extends AbstractAgent` (agentId "default"; run() returns `from(asyncGenerator)` per the Observable contract; RUN_STARTED → TEXT_MESSAGE_START/CONTENT/END → optional silenceMs pause → RUN_FINISHED) + `buildQuickRunEvents` canonical builder + `scriptedAgent` singleton
- `e2e/api/copilotkit/copilotkit.test.ts` - 8 integration tests: /info, run SSE round-trip (RUN_STARTED first / RUN_FINISHED last / no CORS), stop mid-silence {stopped:true}, 32s silence survival (60s per-test timeout), empty connect (D-06), 400 malformed body, runtime 404, /threads + /threads/:threadId/events evidence

## Decisions Made

- Executed D-01 with the fetch-native handler (the plan's locked decision; PROJECT.md's hono assumption remains superseded — evidence recorded in this plan's tests, PROJECT.md update deferred to the phase's evidence-recording step)
- **rxjs dual-instance bridge:** `from()` from top-level rxjs@7.8.2 feeding @ag-ui/client's nested 7.8.1 Observable pipeline — verified interoperable at runtime; type-level invariance (Subscriber's protected `isStopped`) bridged with a documented cast in the composition root and the probe
- **RUN_STARTED without `input`:** the runner patches the full request input into the event before framing (verified in `in-memory.mjs`), so the agent and the canonical builder omit it — keeping `buildQuickRunEvents` true to what the agent emits
- **Thread route shape (D-08 evidence):** the real 1.66.4 route is `GET /threads/:threadId/events`; the researched `threads/events/:threadId` 404s — the Phase 4 thread-index contract must use the real shape

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test C exceeded the default 5000ms per-test timeout**
- **Found during:** Task 1 GREEN (TDD run after mount)
- **Issue:** Test C awaits a run body that takes 5s silence + ~800ms start wait — the bun:test default per-test timeout (5000ms) killed it mid-await
- **Fix:** Added the explicit per-test timeout argument `, 10_000)` to Test C (the plan's design intent — silenceMs 5000 with margin)
- **Files modified:** e2e/api/copilotkit/copilotkit.test.ts
- **Verification:** 3/3 tests pass
- **Committed in:** 5c459e47 (Task 1 GREEN commit)

**2. [Rule 1 - Bug] Research's `AbstractAgent.run()` async-generator signature is wrong for the installed 0.0.57 client**
- **Found during:** Task 1 (probe authoring, verified against installed d.ts)
- **Issue:** The installed `@ag-ui/client@0.0.57` declares `abstract run(input): Observable<BaseEvent>` (rxjs), not an async generator — the plan's example would not compile
- **Fix:** Kept the deterministic async-generator body (mirroring mock-engine.ts) and wrapped it with rxjs `from()`; verified empirically that the wrapped observable flows through the runner's `runAgent`/`verifyEvents`/`apply` pipeline
- **Files modified:** e2e/api/copilotkit/probe-agent.ts
- **Verification:** probe tests pass end-to-end; typecheck clean
- **Committed in:** 069c1baf (Task 1 RED commit)

**3. [Rule 1 - Bug] Typecheck: `RUN_STARTED.input: {}` violates the zod output type**
- **Found during:** Task 1 GREEN (first typecheck run)
- **Issue:** The RunStartedEventSchema's `input` field is a full RunAgentInput object type; `input: {}` fails TS2322 (research's example predates the strict schema)
- **Fix:** Omitted `input` from the agent's RUN_STARTED and from `buildQuickRunEvents` — the InMemoryAgentRunner patches the sanitized request input into the event before framing, so the wire format is unaffected
- **Files modified:** e2e/api/copilotkit/probe-agent.ts
- **Verification:** typecheck clean; tests still green; wire evidence shows the patched input in RUN_STARTED
- **Committed in:** 5c459e47 (Task 1 GREEN commit)

**4. [Rule 1 - Bug] Typecheck: rxjs dual-instance Observable invariance (7.8.2 top-level vs 7.8.1 nested)**
- **Found during:** Task 1 GREEN (first typecheck run)
- **Issue:** `from()` (rxjs 7.8.2) returns an Observable whose type is structurally incompatible with @ag-ui/client's nested rxjs 7.8.1 Observable (Subscriber's protected `isStopped` makes them invariant) — both in the agents map typing and the `run()` override
- **Fix:** Composition root: `CopilotRuntimeOptions["agents"]` extracted and the map cast with a documented comment; probe: `run()` declared as `ReturnType<AbstractAgent["run"]>` with the cast. Runtime interop proven by the passing probe tests — the cast bridges only the type-level gap
- **Files modified:** src/bun/index.ts, e2e/api/copilotkit/probe-agent.ts
- **Verification:** typecheck clean (0 errors); all tests green
- **Committed in:** 5c459e47 (Task 1 GREEN commit)

**5. [Rule 1 - Bug] Thread-events route shape: `/threads/events/:threadId` is 404; real route is `/threads/:threadId/events`**
- **Found during:** Task 2 (Test 8 first run — 404 where the research expected 200)
- **Issue:** fetch-router.mjs matches `threads/<threadId>/events` (threadId at len-2, "events" LAST); the research-documented `/threads/events/:threadId` shape never matches — this is the empirical D-08 discovery the spike exists to make
- **Fix:** Test 8 now records the assumed-path 404 as correction evidence AND asserts the real route `GET /threads/t1/events` (200, events array with RUN_STARTED first), logging the body verbatim for the Phase 4 contract
- **Files modified:** e2e/api/copilotkit/copilotkit.test.ts
- **Verification:** 11/11 tests green; evidence logged in test output
- **Committed in:** 32734be6 (Task 2 commit)

---

**Total deviations:** 5 auto-fixed (5 bugs)
**Impact on plan:** All auto-fixes corrected plan/research assumptions against the installed package reality (Observable contract, zod schema strictness, dual-rxjs typing, real route table) or the test environment (per-test timeout). No scope creep; each fix was necessary for the acceptance criteria to pass.

## Issues Encountered

- None beyond the deviations above — the probe suite ran clean against the real spawned server on every GREEN run; the 32s silence test's accepted latency (>30s exceeds the Nyquist guideline by design, as the plan documented) is the HOST-02 evidence itself

## Authentication Gates

- None. The spike is fully local (no external services, no API keys).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready for plan 01-03 (fixture validation, D-07):** `buildQuickRunEvents` in probe-agent.ts is the canonical event builder the SSE text-diff fixture reuses; the wire format is verified (`data: {json}\n\n`, no event:/id: fields)
- **Phase 2 (engine bridge):** the mount branch, env-gate pattern, and `srv.timeout(req, 0)` override are the composition-root shape the real-engine runner slots into; the threat register's accepted T-1-06 (long-lived SSE on loopback) is the documented tradeoff
- **Phase 4 (thread-index contract):** use `GET /threads` (200, `{threads, nextCursor: null}`) and `GET /threads/:threadId/events` — NOT the researched `threads/events/:threadId` shape (D-08 correction evidence recorded in this plan's test output)
- **PROJECT.md evidence update** (success criterion 4/5 material): the /info JSON shape, thread route table, idle-timeout configuration, and the fetch-native decision evidence are now all captured in this plan's tests — the phase-level evidence-recording step (or 01-03) should fold them into PROJECT.md

---

*Phase: 1-copilotruntime-hosting-thread-apis-spike*
*Completed: 2026-08-08*

## Self-Check: PASSED

- All 4 plan files exist on disk (probe-agent.ts, copilotkit.test.ts, server.ts, index.ts)
- All 3 task commits exist in git log: 069c1baf (test RED), 5c459e47 (feat GREEN), 32734be6 (test expansion)
- Plan-level verification re-run green: `bun test e2e/api/copilotkit --timeout 30000` (11 pass, 0 fail) + `bun run typecheck` (0 errors)
- Prod-path gate verified: unset flag → `/info` agents:{} + run 404 Agent not found

---
phase: 01-copilotruntime-hosting-thread-apis-spike
verified: 2026-08-09T05:10:00Z
status: passed
score: 12/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Run `bun run dev --port=3001`, confirm no second listener appears, and open http://127.0.0.1:3001/api/copilotkit/info in a browser"
    expected: "Single Bun.serve process (no extra listener); /api/copilotkit/info returns JSON advertising agents.default and mode \"sse\" (or agents:{} with the probe flag unset)"
    why_human: "Plan 01-02 explicitly deferred this boot check to end-of-phase human verification (HOST-01 success criterion 1 dev-UX path). Automated tests prove the mount against a spawned real server, but the plan's stated human check for `bun run dev` was never executed by a human."
---

# Phase 1: CopilotRuntime Hosting & Thread APIs (Spike) Verification Report

**Phase Goal:** CopilotRuntime runs inside the existing Bun.serve server on the pinned AG-UI/CopilotKit stack, with run/connect/stop proven over SSE and mock fixtures validated against the real server
**Verified:** 2026-08-09T05:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | HOST-01 / SC1: `/api/copilotkit/*` served from the SAME single Bun.serve origin — no second server process | ✓ VERIFIED | `src/bun/index.ts:316` (single main `Bun.serve`) + mount branch at :348-351. Test A re-run: GET /api/copilotkit/info → 200, `agents.default` defined, `mode: "sse"`. Only other `Bun.serve` is the pre-existing `RAILYN_DEBUG=1`-gated /shutdown helper (:407), unrelated to the runtime |
| 2 | HOST-01 / SC2: run/connect/stop round-trip over SSE — RUN_STARTED first frame, RUN_FINISHED closes, stop `{stopped:true}`, connect on never-run thread empty | ✓ VERIFIED | Tests B, C, 5 re-run green: B → 200 `text/event-stream`, frames[0] RUN_STARTED, last RUN_FINISHED; C → `{stopped:true}` mid-silence (5.0s); 5 → 200 SSE zero frames on `never-run-1` (D-06) |
| 3 | HOST-02 / SC3: long SSE streams survive extended agent silences (idleTimeout mitigated) | ✓ VERIFIED | Test 4 re-run: 32s silence (silenceMs 32000 > global idleTimeout 30) delivered TEXT_MESSAGE_CONTENT("hello") + RUN_FINISHED after — 32008ms elapsed, stream survived. `srv.timeout(req, 0)` at index.ts:349, global `idleTimeout: 30` kept (:319) |
| 4 | HOST-03 / SC4: exact versions pinned; fetch-native vs hono decision recorded with evidence in PROJECT.md | ✓ VERIFIED | package.json: 5 exact pins no carets (runtime/vue 1.66.4, ag-ui/* 0.0.57); pins.test.ts 3/3 green (9 expects); PROJECT.md greps: `fetch-native` ×3, `server.timeout(req, 0)`, `1.66.4`, `0.0.57`, verbatim /info + GET /threads JSON captures; fetch-native handler used at index.ts:273-277 |
| 5 | D-07 / SC5: mock fixtures validated against the real server, usable as E2E foundation | ✓ VERIFIED | sse-text-diff.test.ts 4/4 green: fixture frames **byte-identical** to real captured frames (`fixtureBody === realBody` full-text equality, trailing `\n\n` pinned); MockAgui built from EventEncoder + buildQuickRunEvents (single source of truth, no hand-rolled framing); NOT wired into fixtures/index.ts (Phase 6 consumes — as planned) |
| 6 | ScriptedAgent registered ONLY under RAILYN_COPILOTKIT_PROBE=1 — prod never exposes the fake agent | ✓ VERIFIED | index.ts:256-271: `copilotProbeEnabled` ternary → `{}` when unset; dynamic `await import("../../e2e/api/copilotkit/probe-agent.ts")` only inside the gate (prod module graph clean); fixture seam server.ts:148-149 sets the env var |
| 7 | Mount order: copilotkit prefix dispatched BEFORE the POST /api/ RPC router; unknown subpaths get the runtime's own 404 | ✓ VERIFIED | index.ts:348 (prefix branch) precedes :353 (RPC router); branch NOT wrapped in RPC try/catch. Test 7 re-run: GET /api/copilotkit/not-a-route → 404 `{error:"Not found"}` (not "Unknown method:") |
| 8 | D-03: no CORS — no `access-control-allow-origin` on run responses | ✓ VERIFIED | Test B asserts header null; no `cors` option in `createCopilotRuntimeHandler` call (index.ts:273-277) |
| 9 | D-10: @copilotkit/vue pinned in `dependencies` but not imported anywhere | ✓ VERIFIED | package.json `dependencies["@copilotkit/vue"] === "1.66.4"`, absent from devDependencies; `rg` finds zero `@copilotkit/vue` imports in src/ or e2e/ |
| 10 | Pitfall 5: zod@3 nests under copilotkit; project zod@4 untouched | ✓ VERIFIED | `bun pm ls --all`: zod@3.25.76 nested (10 refs under copilotkit/ag-ui packages); zod@4.3.6 separate at project level; no peer conflicts |
| 11 | D-07 route conflict: ApiMock no longer 501s /api/copilotkit/* — `route.fallback()` hands the prefix to MockAgui | ✓ VERIFIED | mock-api.ts:91-96 (`url.pathname.startsWith("/api/copilotkit/")` → `await route.fallback()`); header comment declares mock-agui ownership; loud-501 preserved for other unhandled paths |
| 12 | Code-review findings fixed: CR-01 `process.exit` removed from patch-eventsource; WR-01 stop test synchronized (no fixed sleep) | ✓ VERIFIED | patch-eventsource.ts: exports `patchEventsource(): void`, returns on all skip paths, no `process.exit` anywhere; postinstall.ts imports it then runs code-server postinstall unconditionally. copilotkit.test.ts:85-96: bounded retry loop on `{stopped:true}` with deadline (0 fixed sleeps). Git log confirms: `b068649c`, `7a0d1907`, `882a3fe0` |

**Score:** 12/12 truths verified (0 present, behavior-unverified)

All behavior-dependent truths (SSE round-trip, stop mid-silence, 32s silence survival, byte-identical fixture diff) were re-proven by running the actual tests against a real spawned server — no truth rests on symbol presence alone.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `package.json` | 5 exact pins in dependencies, no carets | ✓ VERIFIED | runtime/vue 1.66.4, ag-ui/core/client/encoder 0.0.57; `@copilotkit/vue` not in devDependencies |
| `bun.lock` | zod@3 nested under copilotkit; @ag-ui/* exact | ✓ VERIFIED | zod@3.25.76 nested ×10; zod@4.3.6 project-level separate; rxjs@7.8.1/7.8.2 dual |
| `e2e/api/copilotkit/pins.test.ts` | Pin-lock unit test | ✓ VERIFIED | Exists; 3/3 pass (9 expects); no server spawned |
| `src/bun/index.ts` | copilotkit prefix branch + `srv.timeout(req, 0)` + env-gated runtime | ✓ VERIFIED | Lines 245-277 (runtime construction), 348-351 (branch); substantive comments; wired into fetch handler |
| `e2e/api/fixtures/server.ts` | `copilotkitProbe` seam | ✓ VERIFIED | Lines 33-38 (option), 148-149 (extraEnv) |
| `e2e/api/copilotkit/probe-agent.ts` | ScriptedAgent + buildQuickRunEvents | ✓ VERIFIED | AbstractAgent subclass, Observable run(), RUN_STARTED first, silence support; canonical builder exported |
| `e2e/api/copilotkit/copilotkit.test.ts` | 8 integration tests | ✓ VERIFIED | All 8 pass re-run (32 expects); includes D-08 route-shape evidence logging |
| `e2e/api/copilotkit/sse-text-diff.test.ts` | Pattern 3 fixture validation | ✓ VERIFIED | 4/4 pass re-run (33 expects); full-body byte equality |
| `e2e/ui/fixtures/mock-agui.ts` | MockAgui class | ✓ VERIFIED | EventEncoder + buildQuickRunEvents + RunAgentInputSchema patch; run/info/404 handlers; 400 on malformed JSON |
| `e2e/ui/fixtures/mock-api.ts` | route.fallback() skip | ✓ VERIFIED | Lines 91-96; header doc updated |
| `.planning/PROJECT.md` | HOST-03 evidence record | ✓ VERIFIED | fetch-native decision, pins, idleTimeout config, stop route, thread-endpoint finding, verbatim /info + /threads JSON |
| `scripts/patch-eventsource.ts` + `scripts/postinstall.ts` | CR-01 fix | ✓ VERIFIED | No process.exit; export-function shape; code-server postinstall unconditional |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `src/bun/index.ts` :348 | `copilotHandler(req)` | fetch-handler branch BEFORE RPC router, `srv.timeout(req, 0)` | WIRED | Line 348-351; no RPC try/catch wrap (SSE preserved) |
| `src/bun/index.ts` :258 | `e2e/api/copilotkit/probe-agent.ts` | dynamic `await import` behind env gate | WIRED | Only when `RAILYN_COPILOTKIT_PROBE === "1"` |
| `e2e/api/fixtures/server.ts` :148 | spawn env | `RAILYN_COPILOTKIT_PROBE="1"` | WIRED | gated by `copilotkitProbe` option |
| `mock-agui.ts` | `@ag-ui/encoder` EventEncoder | import + encode() | WIRED | Single framing source (no string templates) |
| `mock-agui.ts` :29 | `probe-agent.ts` buildQuickRunEvents | import | WIRED | Shared canonical event source |
| `mock-api.ts` :96 | mock-agui route | `route.fallback()` | WIRED | Playwright hands prefix to MockAgui |
| `sse-text-diff.test.ts` | real server + fixture builder | startServer({copilotkitProbe}) + buildQuickRunSseBody | WIRED | Byte-equality proven in-test (no stale captures) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| copilotkit.test.ts frames | SSE body from raw fetch | Real spawned server → ScriptedAgent → runtime framing | Yes (RUN_STARTED w/ patched input, deltas, RUN_FINISHED) | ✓ FLOWING |
| mock-agui.ts buildQuickRunSseBody | Request input → frames | RunAgentInputSchema.parse(request) + buildQuickRunEvents | Yes — byte-identical to real wire | ✓ FLOWING |
| index.ts copilotAgents | agents map | env-gated dynamic import | Real data when probe on; empty `{}` otherwise (intentional) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Pin assertions (HOST-03) | `bun test e2e/api/copilotkit/pins.test.ts` | 3 pass, 0 fail | ✓ PASS |
| Fixture byte-diff (D-07) | `bun test e2e/api/copilotkit/sse-text-diff.test.ts` | 4 pass, 0 fail (full-body byte equality) | ✓ PASS |
| HOST-01/02 round-trip + 32s silence | `bun test e2e/api/copilotkit/copilotkit.test.ts --timeout 30000` | 8 pass, 0 fail; silence test elapsed 32008ms, RUN_FINISHED delivered | ✓ PASS |
| Install build-clean (A1) | `bun run build` | exit 0, built in 15.24s | ✓ PASS |
| Typecheck | `bun run typecheck` | tsc --noEmit, 0 errors | ✓ PASS |
| Full API regression (mount coexists) | `bun test e2e/api --timeout 30000` | 54 pass, 0 fail across 6 files | ✓ PASS |
| zod@3 nesting / zod@4 separation | `bun pm ls --all` | zod@3.25.76 nested ×10; zod@4.3.6 project-level | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| — | — | No `scripts/*/tests/probe-*.sh` scripts exist in this phase; the spike's evidence is the integration tests above, all executed fresh in this verification (not taken from SUMMARY claims) | SKIPPED (no probe scripts) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| HOST-01 | 01-02, 01-03 | CopilotRuntime mounted inside the existing Bun.serve server (single origin, self-hosted, no extra server process) | ✓ SATISFIED | index.ts:348-351 mount in the single fetch handler; tests A/B/C/7 green; test 5 connect; D-08 threads evidence |
| HOST-02 | 01-02 | Long SSE streams survive extended agent silences (Bun idleTimeout tuned; no mid-stream kills) | ✓ SATISFIED | `srv.timeout(req, 0)` per-request override (index.ts:349); test 4 re-run: 32s silence survived, RUN_FINISHED after |
| HOST-03 | 01-01, 01-03 | Runtime handler choice (fetch-native vs hono) resolved with evidence and matches the pinned stack | ✓ SATISFIED | Fetch-native handler at index.ts:273; exact pins (package.json + pins.test.ts); PROJECT.md evidence record (fetch-native ×3, verbatim /info + /threads JSON, idleTimeout config, stop-route shape) |

**Orphaned requirements:** none — REQUIREMENTS.md maps exactly HOST-01, HOST-02, HOST-03 to Phase 1, and all three are claimed by the plans and satisfied by the code.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | none — debt-marker scan (TBD/FIXME/XXX/placeholder) clean across all 10 modified files | — | — |

### Human Verification Required

### 1. Dev boot check (HOST-01 success criterion 1 — deferred by plan 01-02)

**Test:** Run `bun run dev --port=3001`, confirm no second listener appears, and open http://127.0.0.1:3001/api/copilotkit/info in a browser.

**Expected:** The app serves from the single existing Bun.serve origin (no extra listener); `/api/copilotkit/info` returns JSON advertising `agents.default` and `mode: "sse"` (or `agents: {}` without `RAILYN_COPILOTKIT_PROBE=1` — the probe gate is on by design).

**Why human:** Plan 01-02 explicitly scheduled this as an end-of-phase human check for the dev-run UX path. Automated integration tests already prove the mount against a spawned real server (same composition root), so this is confirmation of the human-facing dev flow, not a correctness gap.

### Gaps Summary

No gaps found. All 12 must-haves verified against the actual codebase with fresh test executions; the phase goal (evidence: working probe, validated fixtures, pinned versions, recorded handler decision) is achieved. The two post-execution code-review findings (CR-01 process.exit, WR-01 stop-test timing) are verified fixed in code and confirmed by git history. Status is `human_needed` solely because plan 01-02 declared a single end-of-phase human boot check that remains unexecuted.

---

_Verified: 2026-08-09T05:10:00Z_
_Verifier: the agent (gsd-verifier)_

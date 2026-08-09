---
phase: 02-ag-ui-bridge-railyinagentrunner
verified: 2026-08-09T12:30:00Z
status: passed
score: 24/24 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
human_verification:
  - test: "Review the CR-01 per-call tool-seq map (toolSeqByCall in event-bridge.ts) — subagent/child tool call ids now resolve back to their START-time seq even when events interleave or parallel children resolve out of order"
    expected: "Confirm the namespaced id scheme (`parent::call::seq`) is correct for the real engines' event patterns; confirm no duplicate or never-started toolCallIds can reach the wire"
    why_human: "Fixer status: 'fixed: requires human verification' (algorithm change). Covered by 3 new unit tests (interleaved subagent, parallel children, nested subagents) but the id scheme deserves a human confirmation pass"
  - test: "Review the WR-02 event-driven completion guard trigger set (done/error/ask_user/shell_approval microtask in railyin-agent.ts) and the executionId === -1 pre-flight completion"
    expected: "Confirm the guard never fires while a legitimate stream is still flowing (no premature RUN_FINISHED cutting real runs) and that all wedge paths (pi non-fatal error, ask_user/shell_approval pause-return, pre-flight fail) complete the stream"
    why_human: "Fixer status: 'fixed: requires human verification' (state-machine behavior change). Covered by unit tests 4c/4d/4e and e2e test 9, but the trigger set deserves human review"
  - test: "Decide on the ROADMAP MVP-mode discrepancy: Phase 2 is marked `mode: mvp` but the goal is a capability statement, not a user story (`user-story.validate` → false)"
    expected: "Either accept the deviation (goal has 5 concrete success criteria that were verified) or re-shape the goal via /gsd mvp-phase before proceeding"
    why_human: "MVP-mode rules require a valid user-story goal to produce the User Flow Coverage table; the format guard surfaced the discrepancy — this is the escalation-gate decision point"
---

# Phase 2: AG-UI Bridge & RailyinAgentRunner Verification Report

**Phase Goal:** All five engines stream through one AG-UI boundary via the custom `RailyinAgentRunner`; conversations persist per-thread as JSONL with replay, run locking, and a complete tool-call lifecycle
**Verified:** 2026-08-09T12:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | SC1: One translation path — a chat turn on threadId = String(conversation.id) streams RUN_STARTED (FIRST, with input) → TEXT_MESSAGE_START/CONTENT/END → RUN_FINISHED (LAST) over SSE on a real spawned server; reasoning → REASONING_*, tools → complete TOOL_CALL_START/ARGS/END/RESULT with messageId on every RESULT (RUNR-01, BRDG-01/02/03) | ✓ VERIFIED | e2e tests a/b (12/12 railyin suite pass, real server); bridge `onEngineEvent` fires at stream-processor.ts:210 top of loop BEFORE the legacy switch; `/ws` broadcast machinery untouched — single translation path |
| 2   | SC2: Card conversations persist to `data/threads/{conversation.id}.jsonl`; standalone sessions are threads without a taskId — the mapping holds on the wire (RUNR-02/03) | ✓ VERIFIED | e2e test 7 reads the file from disk (RUN_STARTED-with-input first line, RUN_FINISHED last); railyin-runner.ts:117-147 pipe-tap persistence; threadId = String(session.conversation_id) in e2e scaffold |
| 3   | SC3: connect() on a cold thread (fresh process, file exists) replays the JSONL log with per-run boundaries and completed tool calls; an unterminated last run is finalized; replay truncates at the first RUN_ERROR; dangling tools synthesize TOOL_CALL_RESULT (RUNR-05/07) | ✓ VERIFIED | railyin-runner.ts:149-190 3-branch connect; unit tests 3c/3d/3e/4 pass; e2e test 10 (restart replay over one dataDir, two servers, 4.4s) pass |
| 4   | SC4: connect() on a never-run thread completes empty — zero frames, 200 (RUNR-06) | ✓ VERIFIED | e2e test 8 pass; runner test 3a pass; base `super.connect()` completes empty |
| 5   | SC5: A second concurrent run on the same thread throws `Error("Thread already running")` synchronously at the runner level; over SSE it surfaces as HTTP 200 with EMPTY body — plus the advisory cross-path lock (executions `running`/`waiting_user` → RUN_ERROR THREAD_BUSY) (RUNR-04) | ✓ VERIFIED | Runner unit test 1 (throw) + e2e test 9 (200 + zero frames, never 500) pass; agent test 10 (advisory lock, completed rows never block) pass; layering documented in agent comment (runner lock fires first) |
| 6   | The executeChatTurn seam fires `onEngineEvent` for every raw EngineEvent in exact order and `onRunEnd` at the six terminal code points (done/error/aborted/decision); byte-identical when `opts` absent (BRDG-01) | ✓ VERIFIED | ChatTurnOpts in coordinator.ts:7-9, 9th trailing param through orchestrator.ts:172-174 → chat-executor.ts:188 → stream-processor.ts:130/150; onEngineEvent at :210; onRunEnd at :203, :450, :468, :506, :558, :574; execution-seam.test.ts 6/6 pass (order, absent-opts, 4 outcomes) |
| 7   | Every bridge-emitted event zod-parses via `EventSchemas` from `@ag-ui/core`; every run stream ends in exactly one terminal event — no INCOMPLETE_STREAM RUN_ERROR (Pitfall 3) | ✓ VERIFIED | event-bridge.test.ts 19 tests (part of 50/50 copilotkit unit pass) zod-parse every event; agent terminal guard + guardedComplete; e2e d (RUN_ERROR terminal frame) |
| 8   | `clone()` re-attaches injected deps (Pitfall 1) and `abortRun()` routes to `orchestrator.cancel(executionId)`; the probe gate (`RAILYN_COPILOTKIT_PROBE`) is checked BEFORE the real registration (D-12, Pitfall 9) | ✓ VERIFIED | railyin-agent.ts:90-107 clone/abortRun; index.ts:259-270 probe gate first, `new RailyinAgent(db, orchestrator)` only when probe disabled; agent tests 2/3 pass |
| 9   | Phase 1 probe tests stay green — probe path still registers ScriptedAgent + base InMemoryAgentRunner, byte-identical | ✓ VERIFIED | e2e copilotkit.test.ts 8/8 pass (39.4s run); index.ts:292 runner is `undefined` in probe mode |
| 10  | Every run's wire events — including the runner-patched RUN_STARTED.input — append verbatim to JSONL via `super.run().pipe(tap(...))` (RUNR-02, anti-pattern avoided) | ✓ VERIFIED | railyin-runner.ts:117-147; runner test 2 (wire-exact incl. input patch) pass; persistence failures caught + warned (stream never breaks) |
| 11  | The store rejects non-numeric threadIds (`^\d+$`) and containment-checks the resolved path BEFORE any filesystem use (V5/V8, T-02-07) | ✓ VERIFIED | jsonl-store.ts:38-47 assertThreadId; tests 3 pass (`../evil`, `a/../../x`, absolute); e2e f (non-numeric → RUN_ERROR, no side effect) |
| 12  | The agent resolves the workspace key per conversation: task-linked → board's workspace_key, else chat_sessions.workspace_key, else default — all three branches unit-tested (RUNR-03) | ✓ VERIFIED | resolveWorkspaceKey railyin-agent.ts:56-71 mirrors conversations.ts:64-76; agent tests 7-9 pass |
| 13  | A run on an unknown conversation id emits RUN_ERROR THREAD_NOT_FOUND before any executor work (RUNR-03/06 boundary, T-02-15) | ✓ VERIFIED | agent tests 5 + 11 pass (executeChatTurn never called); e2e e pass |
| 14  | rxjs is an explicit direct dependency pinned to ^7.8.2 and the pins test asserts it (HOST-03 continuation) | ✓ VERIFIED | package.json `"rxjs": "^7.8.2"`; pins.test.ts 4/4 pass |
| 15  | Full backend suite, full e2e suite (incl. Phase 1 probe), and `bun run typecheck` green at phase close | ✓ VERIFIED | Re-run at verification: 50/50 copilotkit unit, 6/6 seam, 16/16 e2e (railyin + pins), 8/8 probe regression, typecheck 0 errors; summaries record full-suite 2315 pass / 65 pass |
| 16  | 02-COVERAGE.md records the no-external-API decision (`{"detected":false,"signals":[]}`) and 02-VALIDATION.md is complete (`nyquist_compliant: true`) | ✓ VERIFIED | Both files exist; flags present |
| 17  | CR-01: tool-call id resolution uses a per-call seq map (`toolSeqByCall`, mirror of stream-processor's childCallKey) — subagent/child interleaving can no longer shift ids (fix present in 069109e3) | ✓ VERIFIED | event-bridge.ts:37, 76-104, 196-205, 220-228; 3 new tests (interleaved subagent `sa-1::1`/`sa-1::c0::2`, parallel children reverse order, nested subagents) pass |
| 18  | WR-01: `finish()` closes open TEXT_MESSAGE/REASONING blocks before the synthesized tool results and the terminal (fix in c9dae4ef) | ✓ VERIFIED | railyin-agent.ts:215-216 closers via `translateEngineEvent({type:"done"})`; tests 4a/4b pass |
| 19  | WR-02: completion guard is event-driven (`anyEventSeen` + terminal-causing-event microtask); Pi pre-flight fail-fast (`executionId === -1`) completes with RUN_FINISHED (fixes in c05ad826 + 93be0eca) | ✓ VERIFIED | railyin-agent.ts:123, 249-258, 275-278; tests 4c/4d/4e pass; e2e test 9 still passes (slow runs not cut) |
| 20  | WR-03: same-origin gate on the AG-UI mount — cross-origin browser POST → 403 JSON before the runtime handler (fix in 6becf0e9) | ✓ VERIFIED | index.ts:351-360, 397-402; e2e tests g (403) + h (same-origin 200 + RUN_FINISHED) pass |
| 21  | WR-04: cold-path connect() handles malformed threadIds gracefully — completes empty via base runner, never a 500 (fix in 80da2647) | ✓ VERIFIED | railyin-runner.ts:176-186 try/catch fall-through; unit test 3b2 (`../../etc/passwd`, `not-a-number`, `1/2`) pass |
| 22  | IN-02: `activeRun` instance field cleared at every terminal path — late abortRun() is a no-op (fix in 640df223) | ✓ VERIFIED | railyin-agent.ts:133, 200, 225; test 3 updated to assert corrected contract, passes |
| 23  | IN-03: workspaceKey resolved BEFORE the first RUN_STARTED — the null path routes through emitRunError (exactly one RUN_STARTED, no double-emission) (fix in 640df223) | ✓ VERIFIED | railyin-agent.ts:177-181 before :185; no test regression |
| 24  | IN-04: `tool_result`/`subagent_start`/`subagent_stop` close open text/reasoning blocks atomically with END events (fix in 069109e3) | ✓ VERIFIED | event-bridge.ts:184-195, 208-219, 238-247; all existing bridge tests unchanged and green |

**Score:** 24/24 truths verified (0 present, behavior-unverified)

All behavior-dependent truths (seam ordering, terminal outcomes, lock semantics, replay shapes, abort paths, wire event sequences) are backed by passing behavioral tests — single-named-test evidence from the suites re-run during this verification.

### Required Artifacts

| Artifact | Expected    | Status | Details |
| -------- | ----------- | ------ | ------- |
| `src/bun/copilotkit/event-bridge.ts` | Pure EngineEvent → BaseEvent translation, one path | ✓ VERIFIED | 325 lines; no I/O imports; full mapping + D-09 synthesis + CR-01/IN-04 fixes |
| `src/bun/copilotkit/event-bridge.test.ts` | Mapping families, EventSchemas validation | ✓ VERIFIED | 19 tests, all pass |
| `src/bun/copilotkit/railyin-agent.ts` | AbstractAgent subclass: RUN_STARTED-first, clone/abortRun, terminal contract, resolver, advisory lock | ✓ VERIFIED | 293 lines; all WR/IN fixes present |
| `src/bun/copilotkit/railyin-agent.test.ts` | Lifecycle, clone, abort, terminal guard, resolver branches, lock | ✓ VERIFIED | 11 tests, all pass |
| `src/bun/copilotkit/jsonl-store.ts` | Append/read/exists/endRun, sanitization + containment | ✓ VERIFIED | THREAD_ID_RE + resolved-path containment before every fs call |
| `src/bun/copilotkit/jsonl-store.test.ts` | Round-trip, tolerant read, traversal rejection | ✓ VERIFIED | 5 tests, all pass |
| `src/bun/copilotkit/railyin-runner.ts` | InMemoryAgentRunner subclass: pipe-tap persist, 3-branch connect | ✓ VERIFIED | WR-04 try/catch; completeOpenToolCalls; truncate-then-finalize order |
| `src/bun/copilotkit/railyin-runner.test.ts` | Lock throw, wire-exact persistence, 5 replay shapes, hot path | ✓ VERIFIED | 9 tests, all pass |
| `src/bun/engine/{coordinator,orchestrator}.ts`, `execution/chat-executor.ts`, `stream/stream-processor.ts` | Additive `opts` threading | ✓ VERIFIED | ChatTurnOpts 9th param; onEngineEvent at loop top; onRunEnd at 6 points; `markClaudeExecution` intact (deliberate deviation, IMPR-03) |
| `src/bun/test/execution-seam.test.ts` | Real-chain seam contract | ✓ VERIFIED | 6/6 pass |
| `src/bun/testing/mock-engine.ts` | Scripted scenarios via markers | ✓ VERIFIED | All 4 markers (`__SCRIPT_TOOLS__`, `__SCRIPT_DANGLING_TOOL__`, `__SCRIPT_SLOW__` w/ 2s pause, `__SCRIPT_ERROR__`) |
| `src/bun/index.ts` | D-12 registration + probe gate + WR-03 same-origin | ✓ VERIFIED | Probe gate first; runner only non-probe; 403 gate before copilotHandler |
| `e2e/api/copilotkit/railyin.test.ts` | Run path + durability + WR-03 tests | ✓ VERIFIED | 12 tests, all pass |
| `e2e/api/fixtures/server.ts` | `dataDir` option | ✓ VERIFIED | RAILYN_DATA_DIR seam + shutdown-skip contract |
| `e2e/api/copilotkit/pins.test.ts` | rxjs ^7.8.2 assertion | ✓ VERIFIED | 4/4 pass |
| `02-COVERAGE.md` / `02-VALIDATION.md` | Phase-gate records | ✓ VERIFIED | Present, complete, flags set |

### Key Link Verification

| From | To  | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| stream-processor.ts:210 | event-bridge (agent onEngineEvent) | `opts?.onEngineEvent?.(event)` at top of for-await loop, BEFORE the legacy switch | ✓ WIRED | Raw ordering preserved; absent opts → byte-identical |
| stream-processor.ts 6 terminal points | agent `onRunEnd` | `opts?.onRunEnd?.(...)` after DB status updates | ✓ WIRED | :203 aborted / :450 done / :468 error / :506 decision / :558 aborted / :574 error |
| agent.run() | orchestrator.cancel | abortRun → `this.orchestrator.cancel(run.executionId)` | ✓ WIRED | Active-run pointer; IN-02 clears at terminals |
| agent.run() | executeChatTurn | `resolveWorkspaceKey` + advisory lock BEFORE the call | ✓ WIRED | Null → THREAD_NOT_FOUND; busy → THREAD_BUSY; never calls executor on reject |
| railyin-runner.run() | JsonlStore | `super.run().pipe(tap(next → append, complete → endRun))` | ✓ WIRED | Log = exactly what client received (incl. patched input) |
| railyin-runner.connect() | JsonlStore | 3-branch: hot probe `getThreadEvents().length > 0` → super; cold `store.exists` → replay; never-run → super | ✓ WIRED | WR-04 try/catch fall-through |
| index.ts | CopilotRuntime | `agents: copilotAgents` + `runner: railyinRunner` (non-probe only) | ✓ WIRED | `new JsonlStore(getDataDir())` at :291, runner at :292 |
| index.ts mount | copilotHandler | WR-03 `isSameOriginRequest` 403 gate BEFORE `copilotHandler(req)` | ✓ WIRED | e2e g/h prove both directions |
| agent → engine selection | EngineRegistry | chat-executor `resolveEngineForModel(workspaceKey, effectiveModel)` | ✓ WIRED | No engine hardcoding in bridge/agent — all five engines route through the same boundary (D-10) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| railyin-agent.run | content (user turn) | `extractUserText(input.messages)` — real RunAgentInput from wire | ✓ real | e2e a asserts RUN_STARTED.input carries the user text |
| event-bridge | toolCallId | `resolveToolCallId` from real engine events (mock-engine scripted + CR-01 per-call seq) | ✓ real | namespaced ids, no hardcoded values |
| railyin-runner persistence | appended events | `super.run()` observable (real runtime events) | ✓ real | e2e 7 reads file from disk, first/last line asserted |
| cold replay | replayed events | `store.read()` → real JSONL file written by prior server process | ✓ real | e2e 10: server A run → shutdown → server B replays from SAME dataDir |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Seam order/byte-identity/4 terminal outcomes | `bun test src/bun/test/execution-seam.test.ts` | 6 pass / 0 fail | ✓ PASS |
| Bridge + agent + store + runner units (incl. CR-01/WR-01/02/04 tests) | `bun test src/bun/copilotkit` | 50 pass / 0 fail | ✓ PASS |
| Real-server run path + durability + WR-03 + rxjs pin | `bun test e2e/api/copilotkit/railyin.test.ts e2e/api/copilotkit/pins.test.ts` | 16 pass / 0 fail | ✓ PASS |
| Phase 1 probe regression (probe gate byte-identical) | `bun test e2e/api/copilotkit/copilotkit.test.ts` | 8 pass / 0 fail | ✓ PASS |
| Typecheck with new params/modules | `bun run typecheck` | 0 errors | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| — | — | — | N/A — no `scripts/*/tests/probe-*.sh` exist in this project; the phase "probe" is the `RAILYN_COPILOTKIT_PROBE` e2e mode, whose byte-identity is verified by the copilotkit.test.ts regression above (8/8) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| BRDG-01 | 02-01 | Exactly one translation path, no double-broadcast | ✓ SATISFIED | seam tests + bridge tests + onEngineEvent at loop top before legacy switch |
| BRDG-02 | 02-01 | Thinking → REASONING_* | ✓ SATISFIED | bridge reasoning family tests; e2e b REASONING frames |
| BRDG-03 | 02-01 | Complete TOOL_CALL lifecycle | ✓ SATISFIED | bridge tool family tests + e2e b START/ARGS/END/RESULT, messageId on RESULT |
| RUNR-01 | 02-01 | One AG-UI boundary for all five engines, per-workspace selection intact | ✓ SATISFIED | RailyinAgent registered; engine resolved via EngineRegistry (chat-executor.ts:95); e2e a-f on real server |
| RUNR-02 | 02-02 | Per-thread JSONL persistence via custom runner | ✓ SATISFIED | runner pipe-tap + e2e 7 file assertions |
| RUNR-03 | 02-02/02-03 | Thread mapping + workspace resolution | ✓ SATISFIED | e2e a/7 threadId mapping; agent tests 7-9 resolver branches |
| RUNR-04 | 02-02/02-03 | Run locking (same-thread + cross-path) | ✓ SATISFIED | runner throw test + e2e 9 (200 empty) + agent test 10 (THREAD_BUSY) |
| RUNR-05 | 02-02 | Replay from JSONL event log, not snapshots | ✓ SATISFIED | runner replay-shape tests 3a-3e + e2e 10 restart replay |
| RUNR-06 | 02-02 | Empty snapshot for unknown threads | ✓ SATISFIED | e2e 8 + runner test 3a |
| RUNR-07 | 02-02 | Synthesized TOOL_CALL_RESULT on replay | ✓ SATISFIED | completeOpenToolCalls + runner test 4 + e2e 10 (TOOL_CALL_RESULT present) |

All 10 phase requirement IDs accounted for — none orphaned (every ID from REQUIREMENTS.md's Phase 2 row appears in a plan's `requirements` field and has implementation evidence).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | none | — | No TBD/FIXME/XXX markers, no placeholder stubs, no hardcoded-empty renders in any phase file |

### Human Verification Required

1. **CR-01 tool-seq id scheme review** — confirm the namespaced per-call id resolution (event-bridge.ts `toolSeqByCall`) is correct for real engine event patterns. Fixer-flagged: `fixed: requires human verification`. New unit tests cover the three interleaving shapes; human confirmation of the id scheme requested.
2. **WR-02 completion-guard trigger set review** — confirm the guard (done/error/ask_user/shell_approval microtask + `executionId === -1` completion) never cuts a legitimate slow run and covers all wedge paths. Fixer-flagged: `fixed: requires human verification`. Covered by tests 4c/4d/4e + e2e 9; human review of the trigger set requested.
3. **MVP-mode user-story format discrepancy** — ROADMAP marks Phase 2 `mode: mvp` but the goal is a capability statement, not a user story (`user-story.validate` → `false`). The 5 success criteria are concrete and were all verified; decide whether to accept the deviation or convert the goal via `/gsd mvp-phase`.

### Gaps Summary

No gaps found. All 24 must-haves verified with behavioral test evidence; all 10 requirement IDs satisfied; all 8 code-review findings (CR-01, WR-01..04, IN-02..04) confirmed present in code and covered by passing tests; the 7 fix commits (069109e3..93be0eca) are all in git history. Two fixer-flagged items (CR-01, WR-02) plus the MVP-mode discrepancy require human decision — hence `human_needed`, not `passed`.

Deliberate deviations confirmed as documented: `markClaudeExecution` NOT deleted (D-02 parenthetical deviation — IMPR-03 rollback, Phase 7 cleanup); D-09 synthesis is RESULT-only on the live path (wire-valid correction); truncate-before-finalize replay ordering; IN-01 deferred in 02-REVIEW-FIX.md with rationale (Info-level, benign for phase shapes).

---

_Verified: 2026-08-09T12:30:00Z_
_Verifier: the agent (gsd-verifier)_

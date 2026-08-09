---
phase: 02-ag-ui-bridge-railyinagentrunner
fixed_at: 2026-08-09T00:00:00Z
review_path: .planning/phases/02-ag-ui-bridge-railyinagentrunner/02-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-08-09T00:00:00Z
**Source review:** `.planning/phases/02-ag-ui-bridge-railyinagentrunner/02-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope (Critical + Warning + trivial Info): 8
- Fixed: 8
- Skipped: 0
- Deferred (non-trivial Info rework, documented below): 1 (IN-01)

**Verification note:** All suites ran inside the isolated review-fix worktree
(`/tmp/sv-02-reviewfix-9OSqgK`, branch `gsd-reviewfix/02-33833`), with
`node_modules` symlinked to the main checkout (the worktree has no deps by
design). `bun run typecheck` also ran there.

## Fixed Issues

### CR-01: Shared `toolSeq` counter breaks tool-call id resolution when subagent and child tool events interleave

**Files modified:** `src/bun/copilotkit/event-bridge.ts`, `src/bun/copilotkit/event-bridge.test.ts`
**Commit:** `069109e3`
**Applied fix:** Replaced the single shared-counter reads with a per-call seq map
(`state.toolSeqByCall`) keyed by `${parentCallId}\u0000${callId}` — the exact
mirror of stream-processor's `childCallKey`. `tool_start`/`subagent_start`
store the seq at START time; `tool_result`/`subagent_stop` consume the stored
seq at RESULT time (deleting the entry so a later reuse of the same raw callId
gets a fresh id), falling back to `++toolSeq` only when no entry exists.
Subagents are keyed with an empty parent prefix (`\u0000${callId}`), so child
tool events interleaved between `subagent_start` and `subagent_stop` can no
longer shift the subagent's id. New tests: subagent with an interleaved child
tool call (the review's exact trace: `sa-1::1` / `sa-1::c0::2` / `sa-1::1`),
two parallel children with results in reverse start order, and nested
subagents. All pre-existing id-format tests unchanged and green.
Status: `fixed: requires human verification` (algorithm change — covered by
new unit tests, but the id scheme deserves a human confirmation pass).

### WR-01: `finish()` emits the terminal without closing open text/reasoning blocks — invalid stream on abort mid-token

**Files modified:** `src/bun/copilotkit/railyin-agent.ts`, `src/bun/copilotkit/railyin-agent.test.ts`
**Commit:** `c9dae4ef`
**Applied fix:** `finish()` now closes any open TEXT_MESSAGE / REASONING blocks
first (`translateEngineEvent({ type: "done" }, state)` closers — the same
mechanism `guardedComplete` already used) and emits those END events before
the synthesized tool results and the terminal. The abort path
(stream-processor's flush + `onRunEnd("aborted")` with no closing `done`
event) now produces a verifyEvents-clean `... TEXT_MESSAGE_END, RUN_FINISHED`
stream. New tests 4a (abort mid-token+reasoning closes both blocks before
RUN_FINISHED) and 4b (abort with an open tool call: END + synthesized
TOOL_CALL_RESULT before the terminal).

### WR-02: Completion guard is dead code for real engines — pause/misconfig paths wedge the thread permanently

**Files modified:** `src/bun/copilotkit/railyin-agent.ts`, `src/bun/copilotkit/railyin-agent.test.ts`
**Commits:** `c05ad826`, `93be0eca` (typecheck fix for the new test assertions)
**Applied fix:** Two changes. (1) The guard is now event-driven instead of
dispatch-tick-scoped: `eventsDuringDispatch` is replaced by `anyEventSeen`,
and every terminal-causing engine event (`done`, `error`, `ask_user`,
`shell_approval`) schedules a microtask that fires `guardedComplete()` if
`terminalEmitted` is still false — i.e. stream-processor's synchronous
`onRunEnd` did not follow. This covers the review's wedge cases: the Pi
engine's `fatal: false` error-then-return, and ask_user/shell_approval
pause paths whose generator returns instead of parking (matching the existing
sync contract of test 4). `done`/fatal-error/decision still get their
synchronous `onRunEnd` first, making the microtask a no-op. (2) The Pi
pre-flight fail-fast (`executionId === -1`, no events, no `onRunEnd`) now
completes the stream with RUN_FINISHED via `guardedComplete()` instead of
hanging the SSE forever. New tests: 4c (async dispatch, non-fatal error ends
the stream → RUN_FINISHED, no wedge), 4d (async ask_user pause-return →
RUN_FINISHED), 4e (`executionId === -1` → RUN_FINISHED). e2e test 9
(`__SCRIPT_SLOW__` 2s pause + concurrent run) still passes — the guard never
fires while events are flowing, so legitimately slow runs are not cut.
Deliberately NOT added: a silence-based settle timeout — any fixed grace
period would either cut real runs (LLM think time / long tool execution) or
be useless for wedging; the review's named wedge scenarios are all covered by
terminal-causing-event detection.
Status: `fixed: requires human verification` (state-machine behavior change;
covered by unit + e2e tests, but the guard trigger set deserves human review).

### WR-03: Unauthenticated, origin-unchecked loopback AG-UI mount is a DNS-rebinding/CSRF execution vector

**Files modified:** `src/bun/index.ts`, `e2e/api/copilotkit/railyin.test.ts`
**Commit:** `6becf0e9`
**Applied fix:** Added `isSameOriginRequest(req, url)` in front of the
`/api/copilotkit/*` mount: when the `Origin` header is present (browsers send
it on every POST, same- AND cross-origin), it must parse and its `host` must
match the request `Host` header — otherwise a 403 JSON rejection is returned
before the runtime handler runs. Origin-less requests (curl, native clients,
Node fetch, same-origin EventSource GETs) pass — the lightweight check the
review asked for on a local single-user app; unparseable origins (`null`)
are rejected. New e2e tests: g (cross-origin `Origin: https://evil.example.com`
→ 403, no SSE), h (same-origin `Origin: http://127.0.0.1:PORT` → 200 +
RUN_FINISHED).

### WR-04: Cold-path `connect()` 500s on malformed threadIds instead of erroring gracefully

**Files modified:** `src/bun/copilotkit/railyin-runner.ts`, `src/bun/copilotkit/railyin-runner.test.ts`
**Commit:** `80da2647`
**Applied fix:** The cold-path `store.exists`/`store.read` block is wrapped in
a try/catch; any throw (the store's `assertThreadId` on non-numeric/traversal
ids) falls through to `super.connect(request)` — the base runner's
empty-completion contract for unknown threads, mirroring the run path's
graceful rejection. New unit test 3b2: `connect` with `"../../etc/passwd"`,
`"not-a-number"`, `"1/2"` completes empty instead of throwing.

### IN-02: `activeRun` instance field is never cleared after completion

**Files modified:** `src/bun/copilotkit/railyin-agent.ts`, `src/bun/copilotkit/railyin-agent.test.ts`
**Commit:** `640df223`
**Applied fix:** `activeRun` is cleared (`this.activeRun = null`) at every
terminal path — `emitRunError`, `guardedComplete`, and `finish`. A late
`abortRun()` is now a no-op instead of cancelling a stale executionId. Test 3
was updated to assert the corrected contract: an active run still routes
`abortRun()` → `cancel(executionId)`; after completion it does not.

### IN-03: Defensive `workspaceKey == null` path double-emits `RUN_STARTED`

**Files modified:** `src/bun/copilotkit/railyin-agent.ts`
**Commit:** `640df223`
**Applied fix:** `resolveWorkspaceKey` now runs BEFORE the first
`RUN_STARTED` emission (right after the advisory-lock check); the null path
routes through `emitRunError`, which emits exactly one `RUN_STARTED` + one
`RUN_ERROR` — the double-emission wire-contract violation is gone. Currently
unreachable in practice (the conversation-existence check runs earlier), but
the latent violation is closed.

### IN-04: `tool_result`/subagent events close text/reasoning blocks without emitting END events

**Files modified:** `src/bun/copilotkit/event-bridge.ts`
**Commit:** `069109e3` (bundled with CR-01 — same code region, the rewritten
`tool_result`/`subagent_start`/`subagent_stop` cases)
**Applied fix:** `tool_result`, `subagent_start`, and `subagent_stop` now emit
`TEXT_MESSAGE_END` / `REASONING_MESSAGE_END` atomically with the close — the
same shape as the `tool_start` branch. No unterminated message block can reach
the wire when an engine emits a result without a translated start or tokens
interleave around subagent boundaries. All existing event-bridge tests
unchanged and green (no open blocks in their sequences, so no new END events).

## Skipped Issues

None.

## Deferred (out of scope this pass)

### IN-01: `completeOpenToolCalls` keys by raw toolCallId across run boundaries

**File:** `src/bun/copilotkit/railyin-runner.ts:46-101`
**Reason:** Non-trivial rework, not a trivial Info fix: it requires (a)
run-scoping the open-call map (key on the RUN_STARTED runId or reset at each
run boundary) and (b) inserting synthesized results before the terminal of
the run that OWNS the dangling call, not the last terminal in the log. The
latter changes the replay pass's structural loop, which the existing five
replay-shape tests exercise end-to-end. The current behavior is benign for
the phase's real shapes (each wire log run is self-contained; the bridge's
live path already synthesizes dangling results per run). Deferred with this
rationale recorded for a future hardening pass.

---

_Fixed: 2026-08-09T00:00:00Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_

---
phase: 07-cleanup-feature-trim
plan: 02
subsystem: engine
tags: [engine-emitters, shell-approval, ask-user, opencode, claude, copilot, cursor, pi, event-bridge, tsc]

requires:
  - phase: 07-cleanup-feature-trim
    provides: 07-01's EngineEvent union trim + zero-write consume() — this plan's tsc error list
provides:
  - opencode engine A3 shell posture (deterministic auto-approve/deny, no invisible hang)
  - All five engine adapters emit zero trimmed EngineEvent members (ask_user, shell_approval, status, usage, compaction_start/done, new_message)
  - BashPermissionGate/FileStateCache modules gone; writtenFiles gone from tool_result
  - onRawModelMessage plumbing removed; engine ctors no longer take onNewMessage
  - event-bridge drop-list reduced to task_updated + decision_request
  - Engine layer tsc-clean; wave gate green (build, tripwire, e2e/api, src/bun 2261)
affects: [07-cleanup-feature-trim verification, 07-03 store strips, 07-04 RPC type removals]

actuals:
  tokens: 71171    # chars/4 over the realized plan diff (9e7e87e7..HEAD, 284684 chars)
  tasks: 4
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Deterministic engine-side permission handling: resolve the decision via callback at permission.asked time — never yield-and-wait (no UI can answer)"
    - "Engine-level resume() is a no-op (`input: never`): decision interrupts resume via new-turn delivery (engineContent), never engine.resume()"

key-files:
  created: []
  modified:
    - src/bun/engine/opencode/{engine,adapter,event-translator,types}.ts
    - src/bun/engine/copilot/{engine,events}.ts
    - src/bun/engine/cursor/{engine,translate-events,inprocess-adapter,events}.ts
    - src/bun/engine/claude/engine.ts
    - src/bun/engine/pi/{engine,event-translator,execution-controller,pi-engine-factory,tools/delegate}.ts
    - src/bun/copilotkit/event-bridge.ts
    - src/bun/db/repositories/shell-approval-repository.ts
    - src/bun/copilotkit/railyin-agent.ts
    - src/bun/test/{copilot,cursor,opencode}-rpc-scenarios.test.ts, copilot-events, opencode-events, approved-commands.test.ts (deleted), stream-tree-scenarios.test.ts (deleted), pi-event-translator, pi-harness, write-tools-integration, review, handlers, engine-registry, multi-engine-execution, workspace-key-propagation, list-commands, claude-rpc-scenarios, pi suites

key-decisions:
  - "A3 (blocking checkpoint, option-a): opencode shell permissions auto-approve via the existing shellState.shellAutoApprove path; when not configured, deny deterministically — never wait (decision_request is the only HITL channel)"
  - "opencode MCP suspend path (decision_request tool) emits a decision_request engine event instead of ask_user — keeps the only HITL channel working for opencode"
  - "Resume machinery (pendingResumes/waitForResume/mapResumeInputToPrompt) deleted from all engines; resume() no-ops with input: never"
  - "write-tools integration tests drop details.writtenFiles assertions (tools return details: null) — file operations + text counts remain covered"
  - "stream-tree-scenarios.test.ts deleted: tests the removed StreamEvent persistence protocol via the removed getDbStreamEvents runtime API"

patterns-established:
  - "Post-07-01 test contract: completion asserted via DB lifecycle polling (executions.status), never the removed stream-events feed (recorder.waitForStreamDone can never fire)"

requirements-completed: [TRIM-shell_approval, TRIM-ask_user, TRIM-status/status_chunk, TRIM-usage display, TRIM-compaction_summary, TRIM-file_diff]

coverage:
  - id: D1
    description: "opencode engine shell posture per A3 — permission requests answered deterministically (auto-approve when shellAutoApprove, deny otherwise), waitForResume and the invisible-hang state removed"
    verification:
      - kind: unit
        ref: "src/bun/test/opencode-rpc-scenarios.test.ts#OpenCode backend RPC scenarios (suite passes with A3 engine)"
        status: pass
    human_judgment: true
    rationale: "Security-relevant behavior change — shell commands execute without an interactive gate. The A3 blocking checkpoint approved the posture; a live-SDK permission-reply test is not feasible in the unit suite."
  - id: D2
    description: "No engine adapter emits a trimmed EngineEvent member — claude/opencode/copilot/cursor/pi emitters, shell-approval-repository dead machinery, and event-bridge drop-list all excised"
    verification:
      - kind: other
        ref: "bun run typecheck (exit 0) + grep gates: BashPermissionGate|FileStateCache|writtenFiles|onRawModelMessage|onNewMessage|waitForResume all zero in src/bun non-test"
        status: pass
      - kind: unit
        ref: "src/bun/copilotkit/event-bridge.test.ts#ignored families"
        status: pass
    human_judgment: false
  - id: D3
    description: "Engine-side trims verified by the engine suites — copilot/cursor/opencode rpc-scenarios, copilot-events, opencode-events, cursor adapter/translate-events/inprocess-adapter, pi suites"
    verification:
      - kind: unit
        ref: "bun test src/bun (2261 pass / 2 skip / 0 fail, full suite)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Wave-1 gate green — build, tripwire Playwright specs, e2e/api, src/bun, typecheck"
    verification:
      - kind: other
        ref: "bun run build ✓; bunx playwright test e2e/ui/{chat-copilotkit,board,board-ws-updates}.spec.ts 56 pass; bun test e2e/api --timeout 30000 84 pass; bun run typecheck exit 0"
        status: pass
    human_judgment: false

duration: 43min
completed: 2026-08-09
status: complete
---

# Phase 7 Plan 2: Engine-side trim completion — A3 shell posture, trimmed-emitter excision, tsc-clean wave

**The engine layer now compiles clean against the trimmed EngineEvent union: opencode answers shell permissions deterministically per A3 (auto-approve via shellState.shellAutoApprove, deny otherwise — never an invisible hang), all five adapters emit zero trimmed members, onRawModelMessage/onNewMessage plumbing is gone, and the wave gate is green (typecheck clean, build ok, tripwire 56, e2e/api 84, src/bun 2261).**

## Performance

- **Duration:** 43 min (whole plan; Task 1 by the prior executor 19:42Z, Tasks 3-4 in this continuation 20:10Z–20:25Z)
- **Started:** 2026-08-09T19:42:53Z (Task 1 commit)
- **Completed:** 2026-08-09T20:25:19Z (Task 4 commit)
- **Tasks:** 4
- **Files modified:** 75 across the plan (55 in Tasks 3-4)

## Accomplishments

- **A3 opencode shell posture (option-a):** `waitForResume`/`pendingResumes`/`shell_approval` emission removed; permission requests are answered at `permission.asked` time through a new `onPermissionAsked` callback that reads `shellState.shellAutoApprove` — approve_all when configured, deterministic deny otherwise. The invisible pre-trim hang is impossible.
- **opencode MCP suspend path preserved:** the decision_request tool's long-poll now surfaces as a `decision_request` engine event (the only HITL channel) instead of the trimmed `ask_user` — the interrupt registry path works for opencode.
- **All trimmed emitters excised:** copilot (status feed, writtenFiles, usage, ask_user, compaction), cursor (status, usage, writtenFiles extraction → detailedResult diff text), opencode (step-finish usage, session.status, shell_approval), pi (compaction, usage), event-bridge drop-list reduced to `task_updated` + `decision_request` (registry path untouched).
- **Dead machinery deleted:** `parseShellBinaries`/`getUnapprovedShellBinaries`/`appendApprovedCommands` (+ `approved_commands` field) from shell-approval-repository; `waitForResume`/`mapResumeInputToPrompt`/`pendingResumes` from claude/copilot/pi engines; `onRawModelMessage` call sites from opencode/copilot/cursor/pi (incl. the unused delegate-tool option); `onNewMessage` ctor args from all five engine classes + `createPiEngine`.
- **rpc-scenarios suites fixed to the 07-01 zero-write contract:** `recorder.waitForStreamDone` (dead stream-events feed) replaced with `waitForExecutionStatus` DB polling; conversation_messages assertions dropped/asserted-empty; ask_user/shell_approval scenarios deleted; decision_request scenarios assert the waiting_user lifecycle.
- **Wave gate green:** `bun run typecheck` exit 0; `bun run build` ok; tripwire `chat-copilotkit + board + board-ws-updates` 56 pass; `bun test e2e/api --timeout 30000` 84 pass / 0 fail; `bun test src/bun --timeout 20000` **2261 pass / 2 skip / 0 fail** (baseline 2396 — pipeline-test deletions legitimately lower it).

## Task Commits

Each task was committed atomically:

1. **Task 1: Claude trim — gate + cache modules deleted, emitters and file-diff feed excised, writtenFiles field removed** - `2db18159` (feat)
2. **Task 2: A3 decision checkpoint** - no commit (resolved: option-a auto-approve via shellState.shellAutoApprove)
3. **Task 3: opencode shell-posture implementation (per A3) + copilot/cursor emitter trims + event-bridge drop-list** - `5fca8c3d` (feat)
4. **Task 4: onRawModelMessage plumbing removal + engine onNewMessage ctor-arg removal + tsc-clean wave** - `8d6d94ad` (feat)

**Plan metadata:** pending (docs commit after SUMMARY)

## Files Created/Modified

- `src/bun/engine/opencode/engine.ts` - A3 permission callback, waitForResume/pendingResumes/resume-machinery removed, onRawModelMessage/onNewMessage removed
- `src/bun/engine/opencode/adapter.ts` - permission.asked replied deterministically via `onPermissionAsked`; MCP suspend → decision_request event; respondAskUser removed
- `src/bun/engine/opencode/event-translator.ts` - step-finish (usage), permission.asked (shell_approval), session.status emitters removed
- `src/bun/engine/opencode/types.ts` - `onPermissionAsked` run param; respondAskUser dropped from the adapter interface
- `src/bun/engine/copilot/{engine,events}.ts` - status feed, writtenFiles, usage, ask_user, compaction emitters removed; pause/resume loop collapsed to single-pass; resume() no-ops
- `src/bun/engine/cursor/{engine,translate-events,inprocess-adapter,events}.ts` - status/usage emitters removed; writtenFiles extraction replaced by detailedResult diff text
- `src/bun/engine/claude/engine.ts` - dead resume machinery + onNewMessage/EngineResumeInput removed
- `src/bun/engine/pi/{engine,event-translator,execution-controller,pi-engine-factory,tools/delegate}.ts` - compaction/usage emitters, onRawModelMessage, pendingResumes, onNewMessage removed
- `src/bun/copilotkit/event-bridge.ts` - drop-list reduced to task_updated + decision_request
- `src/bun/copilotkit/railyin-agent.ts` - WR-02 guard drops ask_user/shell_approval comparisons
- `src/bun/db/repositories/shell-approval-repository.ts` - dead per-command approval machinery removed (shellAutoApprove state only)
- Tests: `approved-commands.test.ts` + `stream-tree-scenarios.test.ts` deleted; rpc-scenarios/pi/harness/write-tools/review/handlers/engine-registry/multi-engine/workspace-key/list-commands/claude-rpc scenarios reworked to the 07-01 zero-write + trimmed-union contract

## Decisions Made

- **A3 (blocking checkpoint, option-a):** opencode shell permissions auto-approve via the existing `shellState.shellAutoApprove` path; when not configured, deny deterministically. Rationale: matches the trim decision (decision_request is the only HITL channel), no invisible hangs, `tasks.setShellAutoApprove` RPCs (kept) retain per-run control, matches the other four engines' posture, local single-user app running trusted engines.
- **opencode decision_request MCP path:** the suspend long-poll emits `decision_request` (kept union member) — preserves the interrupt registry flow; `respondAskUser` and the ask_user side-channel die.
- **Resume() is a no-op** (`input: never`) across all engines — decision interrupts resume via new-turn delivery (engineContent), never `engine.resume()`.
- **Tool results keep `details: null`** — the file tools' `writtenFiles` details field was already excised in Task 1; integration tests assert disk state + text counts instead.
- **stream-tree-scenarios.test.ts deleted** (see deviations).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] rpc-scenarios suites broken by 07-01's zero-write contract**
- **Found during:** Task 3 verification (plan acceptance requires these suites to pass)
- **Issue:** 18 tests across copilot/cursor/opencode rpc-scenarios timed out or failed at baseline: `recorder.waitForStreamDone` polls the stream-events feed that 07-01 removed (can never fire), and conversation_messages assertions (decision_request_prompt rows, assistant/tool tails, raw slash chips) reference writes that 07-01 deleted.
- **Fix:** replaced every dead-feed wait with `runtime.waitForExecutionStatus(...)` DB polling; dropped/asserted-empty the conversation_messages assertions; kept each test's real intent (fresh-execution ids, resolved prompt delivery, in-flight detection via the engine's per-event lease touch).
- **Files modified:** copilot-rpc-scenarios.test.ts, cursor/rpc-scenarios.test.ts, opencode-rpc-scenarios.test.ts, cursor/engine.test.ts
- **Verification:** all three suites pass (130+37 tests)
- **Committed in:** 5fca8c3d

**2. [Rule 1 - Bug] pi test files corrupted by an over-broad ctor-arg regex**
- **Found during:** Task 4 (after the first automated ctor-shift pass)
- **Issue:** the `new PiEngine(...)` arg-removal regex dropped the `onTaskUpdated` slot instead of `onNewMessage` in 5 pi test files, leaving `undefined` in the wrong position.
- **Fix:** restored the `() => {}` in the onTaskUpdated slot (targeted repair pass).
- **Files modified:** pi-engine.test.ts, pi/{background-compaction,compaction-resume,loop-detection-engine,no-output-regression}.test.ts
- **Verification:** full `bun test src/bun` green
- **Committed in:** 8d6d94ad

**3. [Rule 3 - Blocking] stream-tree-scenarios.test.ts references the removed stream-events runtime API**
- **Found during:** Task 4 tsc-clean wave
- **Issue:** `runtime.getDbStreamEvents` no longer exists on BackendRpcRuntime (the stream-events feed died in 07-01); the 6 tests assert StreamEvent persistence rows that can never be written. The file's subject (stream-tree protocol) is scheduled for deletion in 07-03/07-04 per RESEARCH Group C, but Task 4's acceptance demands `bun run typecheck` exit 0.
- **Fix:** deleted the file (documented in the commit; stream-tree.ts itself remains until its wave).
- **Files modified:** stream-tree-scenarios.test.ts (deleted)
- **Verification:** typecheck clean
- **Committed in:** 8d6d94ad

**4. [Rule 1 - Bug] pi compaction/usage tests and write-tools tests asserted trimmed surfaces**
- **Found during:** Task 4 full-suite run
- **Issue:** `pi-event-translator.test.ts` ET-C1/C2 asserted compaction_start/compaction_done emissions (removed in Task 3); `write-tools-integration.test.ts` WI-WF-1/2, PF-1/2, DIF-1, RNF-1 asserted `result.details.writtenFiles` (tools return `details: null` since Task 1); `pi-harness.test.ts` ABORT-4 asserted pendingResumes behavior removed in Task 4; `cursor/engine.test.ts` agentId test used the dead waitForStreamDone.
- **Fix:** reworked to assert `[]` / disk state + text counts / session abort / DB polling respectively.
- **Files modified:** pi-event-translator.test.ts, write-tools-integration.test.ts, pi-harness.test.ts, cursor/engine.test.ts
- **Verification:** full suite green
- **Committed in:** 8d6d94ad

---

**Total deviations:** 4 auto-fixed (2 blocking, 2 bug)
**Impact on plan:** All fixes were 07-01 fallout surfaced by this plan's own acceptance gates — required for the wave gate to be green, no scope creep.

## Issues Encountered

- **Baseline red surface quantified:** the rpc-scenarios suites had 18 pre-existing failures from 07-01 (dead stream feed + zero-write contract) — verified identical at commit 2db18159 via a temp worktree before fixing (no behavior regressions from the trims themselves).
- **A debug session pinpointed why `waitForAnyToken` can never fire in these suites:** the CallbackRecorder's tokenEvents are not wired to consume()'s onToken in `createBackendRpcRuntime` — the engine's per-event lease touch is the reliable in-flight signal.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Engine layer is tsc-clean and gate-green: 07-03 (store/protocol strips) and 07-04 (RPC type removals) can land on a fully trimmed engine stack.
- Remaining plan-wave work: 07-03 frontend store strips + session-status wiring, 07-04 RPC surface removals (conversations.getStreamEvents handler test already excised here), 07-05 import flag.
- Watch item: `bun test src/bun` baseline is now **2261** (was 2396) — subsequent waves should record against this new count.

---
*Phase: 07-cleanup-feature-trim*
*Completed: 2026-08-09*

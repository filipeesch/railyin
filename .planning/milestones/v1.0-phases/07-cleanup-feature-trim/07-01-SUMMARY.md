---
phase: 07-cleanup-feature-trim
plan: 01
subsystem: engine
tags: [zero-write, frozen-tables, rpc-contract, execution-engine, consume]

# Dependency graph
requires:
  - phase: 06-e2e-migration-verification
    provides: smoke test harness + execution-status polling patterns
provides:
  - consume() + executors write zero rows to conversation_messages / stream_events / model_raw_messages
  - task-side sendMessage family returns { executionId } only; chatSessions.* keep { messageId, executionId }
  - session sidebar running → idle via the chatSession.updated push (onSessionStatusChange end-to-end)
  - markClaudeExecution gone; onEngineEvent remains the single AG-UI translation path
affects: [07-02, 07-03, 07-04, 07-05]

# Actuals (#2632) — pairs with the plan's estimate (72000 tokens).
actuals:
  tokens: 54100    # chars/4 over the realized diff (33 files, ~216k chars)
  tasks: 4
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zero-write execution path: runs update the DB lifecycle triad (tasks.execution_state / chat_sessions.status / executions.status) but never INSERT into frozen tables"
    - "RPC response contract: executor return shapes → handler return shapes → RailynAPI types → store consumers, all { executionId } for the task-side sendMessage family"
    - "Frozen-table proofs in tests: row-count-before vs row-count-after assertions replace content assertions"

key-files:
  created: []
  modified:
    - src/bun/engine/stream/stream-processor.ts (Task 1: consume() zero-write rewrite)
    - src/bun/engine/types.ts (Task 1: EngineEvent trim, EngineResumeInput/OnStreamEvent/OnNewMessage deleted)
    - src/bun/engine/execution/chat-executor.ts (Task 4: appendMessage excised, { executionId } contract)
    - src/bun/engine/execution/human-turn-executor.ts (Task 4: ask_user resume channel removed, new-execution continuation)
    - src/bun/engine/execution/retry-executor.ts (Task 4: { executionId } contract)
    - src/bun/engine/execution/code-review-executor.ts (Task 4: appendMessage excised, { executionId } contract)
    - src/bun/engine/execution/transition-executor.ts (Task 4: transition_event writes die)
    - src/bun/engine/coordinator.ts + orchestrator.ts (Task 4: ExecutionCoordinator signatures → { executionId })
    - src/shared/rpc-types.ts (Task 4: tasks.sendMessage/submitDecisions/retry → { executionId })
    - src/mainview/stores/task.ts + task.test.ts (Task 4: store rework, T-SC-1..6)
    - src/bun/handlers/tasks.ts, chat-sessions.ts, engine.ts (Task 4: relays, dead RPC entries removed)
    - src/bun/server/notifications.ts (Task 4: onError no-op per A2)
    - src/bun/conversation/context.ts (Task 4: compaction_summary write excised)
    - src/bun/engine/pi/compaction-coordinator.ts + engine.ts (Task 4: compaction_summary no-op)
    - e2e/api/smoke.test.ts (Task 4: execution-status polling + frozen-table proofs)

key-decisions:
  - "A2 (checkpoint decision): DROP the 'Execution failed' toast — notifications.onError becomes a no-op; RUN_ERROR + board execution_state='failed' cover failure UX (option-a)"
  - "D-05 Option B (broad): ALL conversation_messages writes stop — messages.ts deleted wholesale; appendMessage excised from every executor + handler; tasks.create seed + worktree progress messages die with them"
  - "ask_user engine resume channel dies with EngineResumeInput: a waiting_user task receiving a new human turn always continues as a NEW execution (IN-03 status-filtered finalization preserved)"
  - "chatSessions.sendMessage/submitDecisions keep { messageId, executionId } type shape; handler returns messageId: 0 sentinel (no row persists; chat.ts ignores it)"

patterns-established:
  - "Zero-write execution path: runs update the DB lifecycle triad but never INSERT into frozen tables"
  - "Frozen-table proofs: row-count-before vs row-count-after in smoke + unit tests"

requirements-completed: [TRIM-shell_approval, TRIM-ask_user, TRIM-status/status_chunk, TRIM-usage display, TRIM-compaction_summary, TRIM-file_diff]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "consume() + executors write zero rows to conversation_messages / stream_events / model_raw_messages during runs (INSERT grep gate clean outside tests/migrations)"
    requirement: TRIM-shell_approval
    verification:
      - kind: unit
        ref: "src/bun/test/stream-processor.test.ts#SP-3/SP-4 (zero conversation_messages on cancel)"
        status: pass
      - kind: unit
        ref: "src/bun/test/chat-executor.test.ts#CE-11 (zero rows on normal run)"
        status: pass
      - kind: integration
        ref: "e2e/api/smoke.test.ts#frozen-table proofs (row counts unchanged after runs)"
        status: pass
    human_judgment: false
  - id: D2
    description: "task-side sendMessage family (tasks.sendMessage, tasks.submitDecisions, tasks.retry, code-review submit) returns { executionId } with no message/task object; chatSessions.* keep { messageId, executionId }"
    verification:
      - kind: unit
        ref: "src/mainview/stores/task.test.ts#T-SC-1..T-SC-6"
        status: pass
      - kind: integration
        ref: "e2e/api/smoke.test.ts#sent.executionId assertions"
        status: pass
    human_judgment: false
  - id: D3
    description: "session sidebar flips running → idle via the chatSession.updated push on run completion (onSessionStatusChange wired end-to-end)"
    verification:
      - kind: unit
        ref: "src/bun/test/execution-seam.test.ts#4/5 (onSessionStatusChange fires on done, not task-bound runs)"
        status: pass
      - kind: integration
        ref: "e2e/api/smoke.test.ts#chatSessions lifecycle (session status idle after run)"
        status: pass
    human_judgment: false
  - id: D4
    description: "markClaudeExecution gone; onEngineEvent remains the single AG-UI translation path (BRDG-01 ordering intact)"
    verification:
      - kind: unit
        ref: "src/bun/test/execution-seam.test.ts#1 (onEngineEvent fires for every raw event in exact order)"
        status: pass
    human_judgment: false

# Metrics
duration: 95min
completed: 2026-08-09
status: complete
---

# Phase 07 Plan 1: Zero-write execution engine — executor excision, { executionId } RPC contract, frozen-table smoke proofs Summary

**The execution write paths are fully excised: runs update the DB lifecycle triad (tasks.execution_state / chat_sessions.status / executions.status) but write zero rows to the frozen conversation_messages / stream_events / model_raw_messages tables, the task-side sendMessage family returns `{ executionId }` with no message/task object, the session drawer flips running → idle via the chatSession.updated push, and the smoke suite proves the frozen-table guarantee with row-count assertions.**

## Performance

- **Duration:** 95 min (2 continuation sessions; Tasks 1-2 committed 2026-08-09 by the pre-checkpoint executor)
- **Started:** 2026-08-09T17:00:00Z (plan start)
- **Completed:** 2026-08-09T19:03:36Z
- **Tasks:** 4 (Task 3 was the A2 decision checkpoint)
- **Files modified:** 33 (Task 4 commit) + 19 (Tasks 1-2)

## Accomplishments

- **consume() zero-write state machine** (Task 1, `1f91a192`): EngineEvent union trimmed (ask_user/shell_approval/status/usage/new_message/compaction_* gone), EngineResumeInput/OnStreamEvent/OnNewMessage deleted, ConvMessageBuffer/rawBuffer/onStreamEvent/markClaudeExecution stripped, DB triad + onEngineEvent tap + finally block intact, `onSessionStatusChange` fired on every terminal path.
- **Writer-module deletions** (Task 2, `7090194d`): raw-message-buffer.ts, conv-message-buffer.ts, server/stream-processor.ts, stream-event-enricher.ts, db/stream-events.ts, write-buffer.ts (WaitFn relocated to retention-job.ts) + their tests deleted; orchestrator/index/notifications wiring trimmed; session-status push bound.
- **Executor write excision + RPC contract** (Task 4, `cbb629eb`): conversation/messages.ts deleted (appendMessage + ensureTaskConversation; the latter relocated to db/task-queries.ts); all five executors stop writing conversation_messages and return `{ executionId }`; the ask_user engine-resume channel died with EngineResumeInput — a waiting_user task now continues as a NEW execution with IN-03 status-filtered finalization; tasks.compact / chatSessions.compact / executions.respondShellApproval handler entries removed (orchestrator methods died in Task 2); A2 outcome executed (notifications.onError → no-op).
- **Smoke suite rework**: the ~8 conversation_messages-based assertions replaced with `{ executionId }` shape assertions, execution/session-status polling, and frozen-table proofs (getMessages row count unchanged after each run).

## Task Commits

Each task was committed atomically:

1. **Task 1: EngineEvent trim + consume() rewrite + session-status callback** - `1f91a192` (feat)
2. **Task 2: Writer-module deletions + orchestrator/index/notifications wiring** - `7090194d` (feat)
3. **Task 3: A2 decision checkpoint** - no commit (resolved: option-a DROP)
4. **Task 4: Executor write excision + RPC contract + store rework + smoke rework + A2 outcome** - `cbb629eb` (feat)

**Plan metadata:** pending (docs commit after SUMMARY)

## Files Created/Modified

Task 4 (`cbb629eb`, 33 files):
- `src/bun/conversation/messages.ts` - DELETED (appendMessage + ensureTaskConversation)
- `src/bun/db/task-queries.ts` - ensureTaskConversation relocated here
- `src/bun/engine/execution/{chat,human-turn,retry,code-review,transition}-executor.ts` - appendMessage excised; `{ executionId }` returns; ask_user resume removed (human-turn)
- `src/bun/engine/coordinator.ts`, `src/bun/engine/orchestrator.ts` - ExecutionCoordinator → `{ executionId }` signatures
- `src/shared/rpc-types.ts` - tasks.sendMessage/submitDecisions/retry → `{ executionId }`
- `src/mainview/stores/task.ts`, `task.test.ts` - store rework; T-SC-1..4 reworked, T-SC-5/6 kept
- `src/bun/handlers/tasks.ts` - relays + appendMessage excision + tasks.compact removed
- `src/bun/handlers/chat-sessions.ts` - `{ messageId: 0, executionId }` sentinel; chatSessions.compact removed
- `src/bun/handlers/engine.ts` - executions.respondShellApproval removed
- `src/bun/server/notifications.ts` - onError no-op (A2 DROP)
- `src/bun/conversation/context.ts` - compactConversation write excised (returns summary string)
- `src/bun/engine/pi/compaction-coordinator.ts`, `src/bun/engine/pi/engine.ts` - compaction_summary no-op
- `e2e/api/smoke.test.ts` - frozen-table proofs + status polling
- Test reworks: chat-executor, human-turn-executor, retry-executor, transition-executor, code-review-executor, executor-test-helpers, execution-seam, orchestrator, handlers, cross-engine-context, pi-engine, pi/background-compaction, server/notifications

Tasks 1-2 (`1f91a192`, `7090194d`): see commits (stream-processor.ts rewrite, types.ts trim, 6 writer modules deleted, orchestrator/index/notifications wiring).

## Decisions Made

- **A2 (checkpoint, user-selected option-a):** DROP the "Execution failed" toast — `notifications.onError` becomes a no-op with a comment. Chat failures surface via the AG-UI RUN_ERROR event; task failures via the board `execution_state='failed'` badge. The stream.error push type dies with the protocol trim (07-03).
- **D-05 Option B (broad):** ALL conversation_messages writes stop — appendMessage whole-module deletion (not a carve-out), including the tasks.create task-description seed and worktree-progress system messages. Task context still flows via `ExecutionParams.taskContext`; worktree failures surface via execution_state='failed' + task.updated push.
- **ask_user resume channel death:** with EngineResumeInput deleted, the human-turn-executor's waiting_user resume attempt (which couldn't compile against `resume(input: never)`) was replaced by always-finalizing the old row (IN-03 status-filtered) and starting a NEW execution — matching the Task-1-reworked seam tests 3/4 exactly.
- **chatSessions contract stability:** chatSessions.sendMessage/submitDecisions keep their `{ messageId, executionId }` RPC types; the handler returns `messageId: 0` (sentinel — no row persists; chat.ts:180-211 ignores it).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] messages.ts importers exceeded the plan's grep expectation**
- **Found during:** Task 4
- **Issue:** The plan expected messages.ts importers to be exactly the 5 executors + compaction-coordinator, but pi/engine.ts (compaction_summary write), handlers/tasks.ts (6 system/transition_event writes), and conversation/context.ts (compactConversation) also imported it — deletion broke them at compile time.
- **Fix:** Excised the compaction_summary writes in pi/engine.ts compact() + context.ts compactConversation (compaction behavior stays live; only the persisted summary row goes away); removed all 6 appendMessage writes in handlers/tasks.ts (create seed, deferred transition_event, worktree progress/failure messages). `ensureTaskConversation` relocated to db/task-queries.ts.
- **Files modified:** src/bun/engine/pi/engine.ts, src/bun/handlers/tasks.ts, src/bun/conversation/context.ts, src/bun/db/task-queries.ts
- **Verification:** typecheck clean for all touched files; INSERT grep gate returns zero
- **Committed in:** cbb629eb

**2. [Rule 3 - Blocking] StubStreamProcessor ctor reset the global DB singleton, breaking 6 transition tests**
- **Found during:** Task 4 verification
- **Issue:** The reworked test stubs passed `initDb()` to the StreamProcessor base ctor; initDb() calls resetDbSingleton(), which clobbered the global DB mid-test and broke column-config/model lookups in 6 transition-executor tests (they were unrun at baseline — the file couldn't even load due to the deleted write-buffer import).
- **Fix:** Pass `null as never` for the db arg (the pre-phase stub convention); reworked the transition-event metadata assertions to frozen-table proofs (zero transition_event rows).
- **Files modified:** src/bun/test/transition-executor.test.ts, executor-test-helpers.ts, chat-executor.test.ts, retry-executor.test.ts
- **Verification:** all 72 executor tests pass (18 transition tests green)
- **Committed in:** cbb629eb

**3. [Rule 3 - Blocking] Tests asserting the old persistence contract broke under zero-write**
- **Found during:** Task 4 verification
- **Issue:** execution-seam.test.ts (user message persisted), orchestrator.test.ts (returns message, transition_event rows), handlers.test.ts (create seed, transition_event, worktree-failure message), cross-engine-context.test.ts (appendMessage import), pi tests (compaction_summary persistence) all asserted the pre-Task-4 behavior.
- **Fix:** Reworked to frozen-table proofs / `{ executionId }` contract assertions; replaced appendMessage seeding with raw SQL INSERTs in tests (tests may write — the grep gate excludes them).
- **Files modified:** execution-seam, orchestrator, handlers, cross-engine-context, pi-engine, pi/background-compaction, server/notifications tests
- **Verification:** all suites green; e2e/api went from 6 fails (baseline) to 0
- **Committed in:** cbb629eb

**4. [Rule 3 - Blocking] Pre-existing code-review-executor test ctor bug**
- **Found during:** Task 4
- **Issue:** code-review-executor.test.ts passed `() => {}` in the wsRepo ctor slot (test-only bug, failing at baseline).
- **Fix:** Corrected ctor args (wsRepo, boardTools, promptAssemblyService).
- **Files modified:** src/bun/test/code-review-executor.test.ts
- **Committed in:** cbb629eb

---

**Total deviations:** 4 auto-fixed (all Rule 3 blocking; 2 of them were latent test breakage from Tasks 1-2 that my rework surfaced and fixed)
**Impact on plan:** All auto-fixes were required for compile/test correctness under the plan's own zero-write mandate. No scope creep; net typecheck errors dropped 180 → 142 and e2e/api fails dropped 6 → 0.

## Issues Encountered

- **Task-2 wave tolerance paid down early:** the transition-executor and code-review-executor test files could not even load at baseline (deleted write-buffer import; misplaced wsRepo arg). Task 4's rework (planned file set) fixed both — 5 pre-existing failures eliminated.
- **Pre-existing red surface left untouched (out of scope):** engine-emitter stragglers (claude/opencode/copilot/cursor/pi emitters, event-bridge, rpc-scenarios suites), stores (07-03), handlers.test.ts getStreamEvents (07-04) — all owned by later plans in the wave. handlers.test.ts still has its pre-existing getStreamEvents failure (07-04's RPC removal).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 07-02 can land its engine-emitter rework on a green executor layer (typecheck stragglers there are enumerated and tolerated by the wave gate).
- 07-03 strips the remaining store/protocol surfaces (compactTask, onTaskStreamEvent, stream.error wiring) — notifications.onError is already a no-op, so App.vue's stream.error toast wiring has no producer.
- 07-04 removes the dead RPC type entries (tasks.compact, chatSessions.compact, executions.respondShellApproval, conversations.getStreamEvents) — their handlers are already gone.
- 07-05 gates the legacy import path against the frozen tables.

## Self-Check: PASSED

- SUMMARY.md exists at `.planning/phases/07-cleanup-feature-trim/07-01-SUMMARY.md`
- Task commits verified in git log: `1f91a192`, `7090194d`, `cbb629eb`
- INSERT grep gate: zero matches in src/bun outside tests/migrations (exit 1)
- `bun test e2e/api/smoke.test.ts` — 26 pass, 0 fail
- `bun test src/mainview/stores/task.test.ts` — 28 pass, 0 fail
- Executor suites (chat/human-turn/retry/transition/code-review) — 72 pass, 0 fail
- Typecheck: 142 errors (down from 180 at baseline), all confined to the wave-tolerated 07-02/07-03/07-04 red surface

## Note on orchestrator-owned state files

`.planning/STATE.md` was swept into commit `7090194d` (Task 2) by the pre-checkpoint executor's `git add -u` — an orchestrator-owned file committed early. Per the continuation instructions it was NOT reverted; the orchestrator owns its reconciliation. ROADMAP.md / REQUIREMENTS.md were not modified by this executor.

---
*Phase: 07-cleanup-feature-trim*
*Completed: 2026-08-09*

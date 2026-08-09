---
phase: 04-jsonl-persistence-legacy-import
plan: 02
subsystem: api
tags: [jsonl, legacy-import, importer, bun, sqlite, ag-ui, e2e, rpc]

# Dependency graph
requires:
  - phase: 04-jsonl-persistence-legacy-import
    provides: JsonlStore (append/tolerant read/exists/list — log IS the index), threads.list RPC, restart-replay e2e fixture pattern (plan 04-01)
  - phase: 02-ag-ui-bridge-railyinagentrunner
    provides: RailyinAgentRunner cold-replay pipeline (the consumer contract imported logs must satisfy), event-bridge event shapes (toolResult messageId convention, dangling-tool synthesis)
provides:
  - legacyImport.run RailynAPI RPC — on-demand, idempotent conversion of frozen conversation_messages rows into per-thread AG-UI JSONL logs (threadId = conversations.id)
  - import.ts: buildThreadLog (pure message→event mapper: one synthetic run per user message, defensive tool-call parsing, per-run namespaced toolCallIds, dangling-tool synthesis, trimmed-type skip, naive-UTC timestamps) + runLegacyImport (frozen-table SELECTs, exists()-marker skip, per-conversation try/catch, ImportSummary)
  - JsonlStore.importLog — atomic whole-file write (tmp+rename) whose existence IS the D-07 idempotency marker
  - Unit suite (10 tests): mapping matrix, namespacing, dangling synthesis, defensive parsing, timestamps, idempotency+atomicity, lifecycle scan, frozen counts
  - e2e (2 tests): real-wire import with frozen counts + idempotent re-run + threads.list integration, and restart replay of an imported thread on a fresh server
affects: [05-ui-swap (import button consumes legacyImport.run), verify-work UAT for IMPR-01/IMPR-02]

# Actuals (#2632) — pairs with the plan's `estimate` (34000 tokens) to calibrate future estimates.
actuals:
  tokens: 12147        # chars/4 over realized diff (48,586 chars, git diff 1b4b6959~1..2fd9e1e9)
  tasks: 2             # tasks completed
  commits: 3           # commits made

# Tech tracking
tech-stack:
  added: []           # no new dependencies — bun built-ins (bun:sqlite, node:fs) + pinned deps only
  patterns:
    - "Atomic whole-file import write: writeFileSync(tmp) + renameSync inside JsonlStore.importLog — file existence is the D-07 idempotency marker, .tmp residue never matches list()/exists()"
    - "One synthetic run per user message (Pattern 3): RUN_STARTED {input.messages} first, RUN_FINISHED {result: null} last — mirrors the runner's per-turn shape so the proven cold-replay pipeline accepts the log"
    - "Defensive legacy parsing: JSON.parse tool-call/tool-result content in try/catch, skip + count malformed rows, never throw out of the per-conversation loop (T-04-06)"
    - "Per-run toolCallId namespacing (`${runId}-${callId}`) so reused legacy call ids cannot collide across runs (Pitfall 4); dangling calls get synthesized empty TOOL_CALL_RESULT before the terminal (Pitfall 6)"

key-files:
  created:
    - src/bun/copilotkit/import.ts
    - src/bun/copilotkit/import.test.ts
    - src/bun/handlers/legacy-import.ts
    - e2e/api/copilotkit/legacy-import.test.ts
  modified:
    - src/bun/copilotkit/jsonl-store.ts
    - src/shared/rpc-types.ts
    - src/bun/index.ts

key-decisions:
  - "buildThreadLog returns { events, malformed } (not BaseEvent[]) — the plan specified both signatures; the counted variant wins because Test 4 asserts the malformed count and runLegacyImport skips empty results"
  - "Orphan tool_result rows (tool_use_id never STARTed in the current run, e.g. crossing a user boundary) are skipped defensively rather than emitted — an unconditional RESULT would violate AG-UI lifecycle (TOOL_CALL_RESULT without TOOL_CALL_START, Pitfall 6/T-04-10)"
  - "Non-user rows before the first user message (no open run) are skipped; system rows are buffered and attached to the FIRST run's input — runs only ever open at user messages (Pattern 3)"
  - "Task 2 RED collapsed into the tracer GREEN: the Task-1 tracer shipped the implementation; the unit layer pins it (pass-on-first-run, committed as test — 04-01 precedent)"

patterns-established:
  - "Imported logs are replay-safe by construction: lifecycle-scan unit test + restart-replay e2e pin block closure, single terminal per run, and cold-replay acceptance"
  - "Import is pure file generation — never touches the runner/agent/engine; the DB read uses the frozen-table SELECT pattern with parameterized queries (T-04-08)"
  - "Idempotency test doubles as the atomicity proof: a leftover .jsonl.tmp artifact is ignored by list()/exists() and never breaks the marker"

requirements-completed: [IMPR-01, IMPR-02]

coverage:
  - id: D1
    description: "legacyImport.run RPC converts seeded legacy conversation_messages rows into a valid per-thread JSONL log over the real wire (RUN_STARTED-with-input first, RUN_FINISHED last, normalized timestamps) and returns {total, imported, skipped, failed, errors}"
    requirement: IMPR-01
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/legacy-import.test.ts#1: seeded legacy rows import over the wire — JSONL shape, frozen counts, idempotent re-run, threads.list, no .tmp residue"
        status: pass
      - kind: unit
        ref: "src/bun/copilotkit/import.test.ts#1: full type matrix — user/assistant/reasoning/tool_call/tool_result map to the exact event sequences"
        status: pass
    human_judgment: false
  - id: D2
    description: "Import is idempotent — a second run imports 0 and skips all; a simulated crash artifact (*.jsonl.tmp) is ignored by list()/exists() and never breaks the existence marker (atomic tmp+rename write)"
    requirement: IMPR-01
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/legacy-import.test.ts#1: idempotent re-run → {imported: 0, skipped: 1}, no .tmp residue"
        status: pass
      - kind: unit
        ref: "src/bun/copilotkit/import.test.ts#9: second run imports 0 and skips all; a simulated crash artifact (.tmp) is ignored and never breaks the marker"
        status: pass
    human_judgment: false
  - id: D3
    description: "Legacy tables stay frozen and readable — the import path issues only parameterized SELECTs, never writes: conversation_messages/conversations row counts identical before/after"
    requirement: IMPR-02
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/legacy-import.test.ts#1: frozen tables — COUNT identical after the import"
        status: pass
      - kind: unit
        ref: "src/bun/copilotkit/import.test.ts#10: the import path never writes to the legacy tables — row counts identical (IMPR-02, D-08)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full message→event mapping matrix — all MessageType branches (user/assistant/system/reasoning/tool_call/tool_result), per-run toolCallId namespacing (Pitfall 4), dangling-tool synthesis (Pitfall 6), malformed-JSON skip+count (T-04-06), 7 trimmed types skipped, naive-UTC timestamp normalization (Pitfall 1), and lifecycle validity of every built log (T-04-10)"
    requirement: IMPR-01
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/import.test.ts#1-8 (type matrix, system attach, trimmed skip, namespacing, dangling synthesis, malformed parsing, timestamps, lifecycle scan)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Imported threads cold-replay — a fresh server over the same durable dataDir replays the imported JSONL on connect (RUN_STARTED first, RUN_FINISHED last) and lists the thread from the rebuilt index"
    requirement: IMPR-01
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/legacy-import.test.ts#2: restart replay — a fresh server over the same durable dataDir cold-replays the imported thread (criterion 5)"
        status: pass
    human_judgment: false

# Metrics
duration: 10min
completed: 2026-08-09
status: complete
---

# Phase 4 Plan 2: Legacy Import — message→JSONL conversion Summary

**legacyImport.run RPC converting frozen conversation_messages rows into replay-safe per-thread AG-UI JSONL logs — atomic tmp+rename writes whose existence is the idempotency marker, SELECT-only w.r.t. legacy tables, with a 10-test unit matrix and a real-wire restart-replay proof**

## Performance

- **Duration:** 10 min
- **Started:** 2026-08-09T08:28:00Z
- **Completed:** 2026-08-09T08:38:25Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `buildThreadLog(threadId, rows)` — pure message→event mapper: one synthetic run per user message (runId `import-{threadId}-{n}`, RUN_STARTED-with-input first / RUN_FINISHED {result: null} last), system rows attached to the FIRST run's input, assistant → TEXT block, reasoning → REASONING block, tool_call/tool_result → namespaced tool trio + result (`messageId = ${toolCallId}-result`, event-bridge convention), empty-assistant skip, 7 feature-trimmed types skipped, malformed tool JSON skipped + counted, dangling tool calls synthesized empty before the terminal, naive-UTC timestamps normalized onto every event (Pitfall 1)
- `runLegacyImport(db, store)` — frozen-table parameterized SELECTs only (IMPR-02/D-08), `store.exists()` marker skip (D-07), per-conversation try/catch so one failure never aborts the loop (T-04-06), returns `{total, imported, skipped, failed, errors}`
- `JsonlStore.importLog(threadId, events)` — atomic `writeFileSync(tmp)` + `renameSync` inside assertThreadId (T-04-05); the final file's existence IS the trustworthy idempotency marker (Pitfall 5)
- `ImportSummary` + `"legacyImport.run"` in the RailynAPI map; thin `legacyImportHandlers(db, store)` factory registered in the composition root — no router change
- Unit suite (10 tests): full type matrix, system attach, empty/trimmed skip, per-run namespacing, dangling synthesis, malformed skip+count, timestamp pin, lifecycle scan, idempotency + .tmp-artifact atomicity, frozen row counts
- e2e (2 tests): seeded-DB import over the real wire (JSONL shape, Pitfall-1 timestamp, frozen counts, idempotent re-run, threads.list integration, no .tmp residue) + restart replay — fresh server over the same durable dataDir cold-replays the imported thread and lists it (criterion 5)

## Task Commits

Each task was committed atomically:

1. **Task 1: Import slice end-to-end (tracer, TDD)** — `1b4b6959` (test: RED e2e, fails with 404 "Unknown method") + `78ed8394` (feat: import module + importLog + contract + handler + registration)
2. **Task 2: Mapping matrix + atomicity/idempotency + restart replay (auto, TDD)** — `2fd9e1e9` (test: unit suite + e2e restart replay)

**Plan metadata:** `(docs commit follows with SUMMARY.md)`

_Note: Task 2's RED collapsed — the Task-1 tracer already shipped the implementation; the unit layer pins it (pass-on-first-run, committed as `test`, same as 04-01 Task 2). The plan-level RED→GREEN sequence holds via Task 1's failing-then-passing e2e._

## Files Created/Modified

- `src/bun/copilotkit/import.ts` (NEW) - buildThreadLog (pure mapping) + runLegacyImport (orchestration) + ImportSummary-flow; defensive parsing, namespacing, dangling synthesis, timestamp normalization
- `src/bun/copilotkit/import.test.ts` (NEW) - 10 tests: mapping matrix, namespacing, dangling, malformed, trimmed, timestamps, lifecycle scan, idempotency/atomicity, frozen counts
- `src/bun/handlers/legacy-import.ts` (NEW) - legacyImportHandlers(db, store) thin delegation factory
- `e2e/api/copilotkit/legacy-import.test.ts` (NEW) - real-wire import + restart replay (durable dataDir + durableDb fixture contract)
- `src/bun/copilotkit/jsonl-store.ts` - Added `importLog(threadId, events)`: atomic tmp+rename whole-file write, the D-07 marker; header doc updated for Phase 4 import scope
- `src/shared/rpc-types.ts` - `ImportSummary` interface (total/imported/skipped/failed/errors) + `legacyImport.run` RailynAPI entry
- `src/bun/index.ts` - Imported `legacyImportHandlers`, registered `...legacyImportHandlers(db, jsonlStore)` after threadHandlers

## Decisions Made

- **buildThreadLog returns `{ events, malformed }`** — the plan's action section specified both a `BaseEvent[]` signature and a counted variant; the counted variant wins because it is the only one that can satisfy "Test 4 asserts the count" and the `events.length === 0` skip in runLegacyImport.
- **Orphan tool_result rows are skipped defensively** — a tool_result whose namespaced id was never STARTed in the current run (e.g. a result crossing a user boundary into the next run) is dropped rather than emitted: an unconditional RESULT would produce `TOOL_CALL_RESULT` without `TOOL_CALL_START`, which the pinned client's verifyEvents rejects (Pitfall 6, T-04-10). Normal legacy data (id-ordered call→result within one turn) is unaffected.
- **Non-user rows before the first user message are skipped** — runs only open at user messages (Pattern 3); only system rows are buffered for the first run's input.
- **Task 2 RED collapse** — documented above; unit tests written after the tracer delivered the implementation pass on first run (04-01 precedent, not a gate violation).

## Deviations from Plan

None - plan executed exactly as written (the two plan-specified buildThreadLog signatures were reconciled per the explicit counted contract; the orphan-result skip is the plan-mandated defensive lifecycle posture applied to an edge the plan didn't enumerate).

## Issues Encountered

- **TypeScript cast friction in the unit suite:** `events.filter(...) as X` casts failed because the zod-inferred BaseEvent union members don't structurally overlap hand-written cast targets (passthrough objectOutputType). Fixed with `as unknown as X` bridges — test-only, no production change.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `legacyImport.run` is live end-to-end and consumed by Phase 5's import button (the Vue side was deliberately deferred — the RPC returns an ImportSummary ready for rendering)
- Imported threads are indistinguishable from runner-produced threads for threads.list and cold replay — the Phase 5 thread-list UI and chat hydration will work for imported history
- Plan 04-03 (crash-tolerant write hardening, if planned) can proceed independently — store changes are additive; all existing store tests unchanged and green

---
*Phase: 04-jsonl-persistence-legacy-import*
*Completed: 2026-08-09*

## Self-Check: PASSED

All key files exist on disk and all task commits are present in git history.

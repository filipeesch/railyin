---
phase: 04-jsonl-persistence-legacy-import
plan: 01
subsystem: api
tags: [jsonl, threads, rpc, rpc-types, bun, sqlite, e2e]

# Dependency graph
requires:
  - phase: 02-ag-ui-bridge-railyinagentrunner
    provides: JsonlStore (append/tolerant read/exists), RailyinAgentRunner JSONL persistence, thread = conversation.id
  - phase: 01-copilotruntime-hosting-thread-apis-spike
    provides: proof that the runtime GET /threads is in-memory-only (Pitfall 3)
provides:
  - threads.list RailynAPI RPC — JSONL-backed thread index (card + session) with DB-enriched name/kind/timestamps
  - JsonlStore.list() — THREAD_ID_RE-filtered readdir scan, mtime-desc sort, decoy-tolerant, missing dir → []
  - e2e restart proof: fresh server over durable dataDir lists threads from disk
affects: [05-ui-swap (thread-list UI consumes threads.list), verify-work UAT for CHAT-08]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
actuals:
  tokens: 5474        # chars/4 over realized diff (21,897 chars, git diff 23fe5202..HEAD)
  tasks: 2            # tasks completed
  commits: 3          # commits made

# Tech tracking
tech-stack:
  added: []           # no new dependencies — bun built-ins + pinned deps only
  patterns:
    - "File-scan index: list() derives the thread index from readdir + regex filter; the log IS the index (no index file, no watcher)"
    - "Handler factory: threadHandlers(db, store) returning { 'threads.list': ... } — mirrors conversationHandlers/chatSessionHandlers"
    - "DB enrichment via parameterized LEFT JOIN (tasks/chat_sessions) keyed on conversations.id — never conversations.created_at (no such column)"
    - "TDD tracer-then-expand: failing e2e committed first (RED), slice implementation second (GREEN), unit layer pins the slice"

key-files:
  created:
    - src/bun/handlers/threads.ts
    - src/bun/test/threads-handlers.test.ts
    - e2e/api/copilotkit/threads.test.ts
  modified:
    - src/bun/copilotkit/jsonl-store.ts
    - src/shared/rpc-types.ts
    - src/bun/index.ts
    - src/bun/copilotkit/jsonl-store.test.ts

key-decisions:
  - "createdAt/updatedAt return raw SQLite datetime strings when the DB row exists, ISO file-derived strings for orphans (plan-specified precedence: task_created/session_created/session_activity → birthtime/mtime)"
  - "list() wraps per-entry statSync in skip-don't-crash (T-04-04 mitigation) — a single unreadable file cannot 500 the listing"
  - "Task 2 RED collapsed into the tracer GREEN: the tracer (Task 1) already shipped list(); the unit layer pins it (pass-on-first-run, committed as test)"

patterns-established:
  - "threads.list consumes store.list() (disk) as the authoritative index — the runtime's in-memory GET /threads is never the data source (Pitfall 3)"
  - "Orphan JSONL files (no DB row) still list with kind 'session', name null, file-derived timestamps"

requirements-completed: [CHAT-08]

coverage:
  - id: D1
    description: "threads.list RPC returns every JSONL thread (card + session) with kind/name/createdAt/updatedAt; empty store → []"
    requirement: CHAT-08
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/threads.test.ts#session thread: chatSessions.create + run → listed kind 'session' with the chat title"
        status: pass
      - kind: e2e
        ref: "e2e/api/copilotkit/threads.test.ts#card thread: boards.list → tasks.create + run → listed kind 'card' with the task title"
        status: pass
      - kind: unit
        ref: "src/bun/test/threads-handlers.test.ts#7: empty store → []"
        status: pass
    human_judgment: false
  - id: D2
    description: "Index rebuilds from the log — list() scans data/threads/ (THREAD_ID_RE-filtered, mtime-desc), skips .tmp/.meta.json/non-numeric decoys, missing dir → []"
    requirement: CHAT-08
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/jsonl-store.test.ts#list() — index rebuild from the log (D-04/D-05) > 1: scans valid .jsonl files, skips decoys, sorts by mtime desc with correct metadata"
        status: pass
      - kind: unit
        ref: "src/bun/copilotkit/jsonl-store.test.ts#list() — index rebuild from the log (D-04/D-05) > 2: missing threads dir → []"
        status: pass
      - kind: unit
        ref: "src/bun/copilotkit/jsonl-store.test.ts#list() — index rebuild from the log (D-04/D-05) > 3: corrupt/non-conforming dir entries are skipped, never thrown"
        status: pass
    human_judgment: false
  - id: D3
    description: "A fresh server over the same durable dataDir lists the same threads from disk (index from disk, not the runtime's in-memory thread store)"
    requirement: CHAT-08
    verification:
      - kind: e2e
        ref: "e2e/api/copilotkit/threads.test.ts#restart proof: a fresh server over the same durable dataDir lists the same thread from disk (Pitfall 3)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Crash tolerance: a partial trailing JSON line does not hide the thread from the index and does not break the read"
    requirement: CHAT-08
    verification:
      - kind: unit
        ref: "src/bun/copilotkit/jsonl-store.test.ts#list() — index rebuild from the log (D-04/D-05) > 4: crash tolerance — a partial trailing line does not hide the thread from the index, read() still skips it"
        status: pass
    human_judgment: false
  - id: D5
    description: "Name/kind/timestamp derivation from the DB join — card (tasks.title), session (chat_sessions.title), orphan files (name null, mtime-derived timestamps)"
    requirement: CHAT-08
    verification:
      - kind: unit
        ref: "src/bun/test/threads-handlers.test.ts#5: card and session threads get kind/name/timestamps from the DB join"
        status: pass
      - kind: unit
        ref: "src/bun/test/threads-handlers.test.ts#6: orphan JSONL file with no DB row → kind 'session', name null, file-derived timestamps"
        status: pass
    human_judgment: false

# Metrics
duration: 32min
completed: 2026-08-09
status: complete
---

# Phase 4 Plan 1: threads.list — JSONL thread-index RPC Summary

**threads.list RailynAPI RPC: disk-backed thread index (log IS the index) over card + session threads, with DB-enriched names/timestamps and a real-wire restart proof that a fresh server lists from disk**

## Performance

- **Duration:** 32 min
- **Started:** 2026-08-09T09:18:00Z
- **Completed:** 2026-08-09T09:50:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `JsonlStore.list()` — THREAD_ID_RE-filtered `readdirSync` scan (regex before any path use, V8 gate), mtime-desc sort, missing dir → `[]`, decoys (`.jsonl.tmp` / `.meta.json` / non-numeric) skipped, per-entry `statSync` failure tolerated (T-04-04)
- `ThreadSummary` contract + `"threads.list": { params: Record<string, never>, response: ThreadSummary[] }` in the RailynAPI map (D-02 shared-contract discipline)
- `threadHandlers(db, store)` — one parameterized LEFT JOIN over `tasks`/`chat_sessions` keyed on `conversations.id` derives kind (`task_id != null ? "card" : "session"`), name (`tasks.title` / `chat_sessions.title`), createdAt/updatedAt (DB columns → file birthtime/mtime fallback); no `conversations.created_at` anywhere (Pitfall 2)
- Registered `...threadHandlers(db, jsonlStore)` in the `allHandlers` composition root — no router change (existing `/api/*` dispatch covers it)
- e2e proof of the authoritative-index property (Pitfall 3): session + card threads listed with correct kind/name after real runs, and a fresh server over the same durable dataDir re-lists the thread from disk
- Unit layer: 4 new `list()` cases (scan/filter/sort/missing-dir/decoys/partial-line crash tolerance) + 3 handler cases (enrichment/orphan/empty)

## Task Commits

Each task was committed atomically:

1. **Task 1: threads.list end-to-end slice (tracer, TDD)** — `22e2dca2` (test: RED e2e, fails with 404 "Unknown method") + `f61bca2c` (feat: store scan + contract + handler + registration)
2. **Task 2: Unit layer (auto, TDD)** — `31b28b6c` (test: list() scan cases + handler enrichment tests)

**Plan metadata:** `(docs commit follows with SUMMARY.md)`

_Note: Task 2's TDD RED/GREEN collapsed — the tracer (Task 1) already shipped `list()`; the unit tests pin the shipped slice and passed on first run (committed as `test`). The plan-level RED→GREEN sequence holds via Task 1's failing-then-passing e2e._

## Files Created/Modified

- `src/bun/copilotkit/jsonl-store.ts` - Added `list()`: readdir scan filtered by THREAD_ID_RE before path use, sorted mtime desc, `{threadId, mtimeMs, birthtimeMs, size}[]`, missing dir → [], skip-don't-crash on decoys and per-entry stat failures; header doc updated for Phase 4 scope
- `src/shared/rpc-types.ts` - `ThreadSummary` interface (threadId, name, kind "card"|"session", createdAt, updatedAt) + `threads.list` RailynAPI entry
- `src/bun/handlers/threads.ts` (NEW) - `threadHandlers(db, store)` factory; store scan + parameterized LEFT JOIN enrichment
- `src/bun/index.ts` - Imported `threadHandlers`, registered `...threadHandlers(db, jsonlStore)` in allHandlers
- `src/bun/copilotkit/jsonl-store.test.ts` - New `describe("list()")` block: 4 tests (scan/sort/missing-dir/decoys/crash tolerance)
- `src/bun/test/threads-handlers.test.ts` (NEW) - 3 handler tests (DB enrichment, orphan, empty store)
- `e2e/api/copilotkit/threads.test.ts` (NEW) - 3 real-wire tests (session, card, restart-from-disk)

## Decisions Made

- **Timestamp precedence (plan-specified):** `createdAt = task_created ?? session_created ?? birthtime/mtime ISO`; `updatedAt = session_activity ?? mtime ISO`. DB timestamps surface as raw SQLite `datetime('now')` strings ("YYYY-MM-DD HH:MM:SS"), file-derived ones as ISO — Phase 5 UI may normalize, but the plan's contract was followed verbatim.
- **Per-entry stat tolerance:** `list()` wraps `statSync` in try/catch (T-04-04 mitigate disposition) so a single unreadable/broken entry cannot 500 the whole listing — plan asked for regex filtering, threat register asked for per-entry tolerance; both implemented.
- **Task 2 RED collapse:** unit tests written after the tracer delivered the implementation pass on first run — committed as `test` without a separate GREEN (documented; not a gate violation since the plan-level RED/GREEN sequence was satisfied by Task 1's failing e2e → passing implementation).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **ENOENT in direct-write tests:** new unit tests wrote thread files via `writeFileSync(threadLogPath(...))` but the `threads/` subdir doesn't exist in a fresh temp dir (only `store.append()` auto-creates it). Fixed by adding `mkdirSync(join(tmp.dir, "threads"), { recursive: true })` in the tests that write files directly. Pure test-fixture fix, no production change.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `threads.list` is live end-to-end and consumed by Phase 5's thread-list UI (the Vue side was deliberately deferred; the RPC returns every thread with name/kind/timestamps ready for rendering)
- Phase 4 Plan 2 (crash-tolerant write hardening) and Plan 3 (legacy import) proceed independently — `list()` and the store changes are backward-compatible, all existing store tests unchanged and green
- Restart-replay e2e pattern (durable dataDir + durableDb) established for the import plan's replay verification

---
*Phase: 04-jsonl-persistence-legacy-import*
*Completed: 2026-08-09*

## Self-Check: PASSED

All key files exist on disk and all task commits are present in git history.

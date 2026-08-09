---
phase: 04-jsonl-persistence-legacy-import
verified: 2026-08-09T10:20:00Z
status: passed
score: 14/14 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
human_verification: []
---

# Phase 4: JSONL Persistence & Legacy Import Verification Report

**Phase Goal:** The JSONL store is crash-tolerant and its thread index is user-accessible; legacy chat history converts on demand, idempotently, over frozen tables
**Verified:** 2026-08-09
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | `threads.list` returns EVERY JSONL thread — card conversations (kind 'card', name from tasks.title) and standalone sessions (kind 'session', name from chat_sessions.title) — with createdAt/updatedAt; an empty threads dir returns [] (CHAT-08, D-01/D-03) | ✓ VERIFIED | `src/bun/handlers/threads.ts` (LEFT JOIN enrichment, kind via task_id) + `src/bun/test/threads-handlers.test.ts` 3/3 pass (incl. empty store → []) + `e2e/api/copilotkit/threads.test.ts` 3/3 pass (session + card listing with titles) |
| 2   | The index rebuilds from the log: `JsonlStore.list()` scans data/threads/ (THREAD_ID_RE-filtered BEFORE path use, sorted mtime desc), no separate index file; .tmp / .meta.json / non-numeric decoys skipped never thrown; missing dir → [] (D-04/D-05) | ✓ VERIFIED | `src/bun/copilotkit/jsonl-store.ts:148-164` (readdirSync + THREAD_ID_RE + per-entry statSync try/catch) + `jsonl-store.test.ts` 12/12 pass incl. 4 list() cases (scan/sort, missing-dir, corrupt entries, crash tolerance) |
| 3   | `threads.list` is a RailynAPI RPC method (shared contract + handler + registration), not a raw route (D-02) | ✓ VERIFIED | `src/shared/rpc-types.ts:111-121` `ThreadSummary` interface + `"threads.list"` entry (line 1109); `src/bun/index.ts:342` `...threadHandlers(db, jsonlStore)` in allHandlers |
| 4   | On the real wire, a session via chatSessions.create + a card via boards.list/tasks.create both appear in threads.list with correct kind/name after a fresh server restart (index from disk, not memory — Pitfall 3) | ✓ VERIFIED | `e2e/api/copilotkit/threads.test.ts` 3/3 pass — "restart proof: a fresh server over the same durable dataDir lists the same thread from disk (4574ms test, real 2-server fixture)" |
| 5   | No threads.list query touches conversations.created_at (Pitfall 2); timestamps from tasks.created_at / chat_sessions.created_at / last_activity_at with file birthtime/mtime fallback; orphan JSONL files (no DB row) still list with kind 'session', name null | ✓ VERIFIED | grep: only a doc-comment mentions `conversations.created_at`, no query; `threads.ts` uses toIso() (WR-01) + `f.birthtimeMs > 0 ? f.birthtimeMs : f.mtimeMs` (WR-03); orphan case in threads-handlers.test.ts pass |
| 6   | `legacyImport.run` converts old conversation_messages rows into per-thread JSONL logs (threadId = conversations.id): each user message starts a synthetic run — RUN_STARTED {input.messages…} FIRST, RUN_FINISHED {result: null} LAST (IMPR-01, D-06) | ✓ VERIFIED | `src/bun/copilotkit/import.ts` buildThreadLog (Pattern 3, runId `import-{threadId}-{n}`); `e2e/api/copilotkit/legacy-import.test.ts` test 1 passes (first line RUN_STARTED with user input, last line RUN_FINISHED); import.test.ts 12/12 pass |
| 7   | Import is idempotent: the atomic whole-file write is the only marker — a thread whose .jsonl exists is skipped (imported: 0, skipped: N on re-run) and no *.jsonl.tmp residue survives (D-07, Pitfall 5) | ✓ VERIFIED | `jsonl-store.ts` importLog (writeFileSync tmp + linkSync publish, unlink tmp) + exists() marker; e2e test 1 asserts re-run {imported:0, skipped:1} + empty .tmp filter; import.test.ts test 9 (crash-artifact atomicity) pass |
| 8   | Legacy tables stay frozen and readable: import only SELECTs from conversation_messages/conversations, never writes, never alters schema, never drops — row counts before/after identical (IMPR-02, D-08) | ✓ VERIFIED | import.ts queries are parameterized SELECTs only; e2e test 1 asserts countMessages(dbPath) identical before/after; import.test.ts test 10 pass |
| 9   | Message→event mapping is faithful: assistant → TEXT_MESSAGE_START/CONTENT/END, reasoning → REASONING_*, tool_call/tool_result JSON parsed defensively (skip + count malformed, never crash), per-run namespaced toolCallIds `${runId}-${callId}` (Pitfall 4), dangling tool calls get synthesized empty TOOL_CALL_RESULT before the terminal (Pitfall 6), trimmed types skipped, system messages attached per WR-04 placement, timestamps normalized from naive-UTC SQLite strings (Pitfall 1) | ✓ VERIFIED | `import.ts` (parseToolCall/parseToolResult defensive, namespacing at line 244, closeRun synthesis, normalizeTimestamp); import.test.ts 12/12 pass incl. type matrix, namespacing (Pitfall 4), dangling synthesis (Pitfall 6), malformed skip+count, trimmed skip, timestamp pin, lifecycle scan (test 8) |
| 10  | Imported threads list through threads.list (kind 'session', name null when no chat_sessions row) and cold-replay on a fresh server over the same dataDir (index rebuild from log — criterion 5) | ✓ VERIFIED | e2e test 1 (threads.list includes imported thread, kind 'session', name null) + e2e test 2 (fresh server B cold-replays: first frame RUN_STARTED, last RUN_FINISHED) pass |
| 11  | Interrupted/corrupted JSONL writes never lose a thread: partial trailing line still lists through threads.list AND replays complete lines on connect; leftover *.jsonl.tmp is invisible to list()/exists() and re-import stays safe (criterion 5, D-04/D-05) | ✓ VERIFIED | e2e "crash tolerance (criterion 5)" tests A/B/C all pass (5/5 in legacy-import.test.ts): A partial-tail list+replay across restart, B .tmp decoy invisible + final-file marker honest, C re-import after crash artifact stays skipped |
| 12  | Full-phase regression proves both capabilities coexist on the real stack: threads.list + legacyImport.run + runner persistence all green in one suite run | ✓ VERIFIED | `bun test src/bun --timeout 20000` → **2394 pass / 2 skip / 0 fail** (matches REVIEW-FIX.md main-checkout numbers); phase e2e suites 8/8 pass; `bun run typecheck` → 0 errors |
| 13  | 04-COVERAGE.md records the API-coverage decision (detector output verbatim + adjudication, no external API integration) | ✓ VERIFIED | `.planning/phases/04-jsonl-persistence-legacy-import/04-COVERAGE.md` exists: verbatim `{"detected":true,"signals":[…]}` with 3-signal adjudication table, ≤200-char declaration line, no-external-API decision |
| 14  | 04-VALIDATION.md is signed off: per-task verification map green, Wave 0 checklist complete, nyquist_compliant: true | ✓ VERIFIED | `04-VALIDATION.md` frontmatter `nyquist_compliant: true`, `wave_0_complete: true`, per-task map (6 tasks) with passing commands, Q1-Q4 resolutions, sign-off approved |

**Score:** 14/14 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected    | Status | Details |
| -------- | ----------- | ------ | ------- |
| `src/shared/rpc-types.ts` | ThreadSummary + ImportSummary interfaces + "threads.list"/"legacyImport.run" RailynAPI entries | ✓ VERIFIED | Interfaces at lines 111/127; entries at lines 1109/1116; duplicate RPC-schema header removed (IN-02) |
| `src/bun/copilotkit/jsonl-store.ts` | list() scan + importLog atomic no-clobber write + ThreadLogExistsError | ✓ VERIFIED | list() lines 148-164; importLog linkSync+unlink lines 113-137; empty-events guard (IN-03) |
| `src/bun/handlers/threads.ts` | threadHandlers(db, store) factory | ✓ VERIFIED | Full handler; toIso() normalization (WR-01), birthtime-0 fallback (WR-03) |
| `src/bun/handlers/legacy-import.ts` | legacyImportHandlers(db, store) with "legacyImport.run" | ✓ VERIFIED | Exists; thin delegation to runLegacyImport |
| `src/bun/index.ts` | Both handler factories registered | ✓ VERIFIED | Lines 342-343: threadHandlers + legacyImportHandlers |
| `src/bun/copilotkit/import.ts` | buildThreadLog + runLegacyImport + ImportSummary flow | ✓ VERIFIED | Full module; WR-04 system-row placement; IN-01 no-op filter removed; ThreadLogExistsError → skipped |
| `src/bun/copilotkit/jsonl-store.test.ts` | list() unit cases + importLog atomicity | ✓ VERIFIED | 12/12 pass |
| `src/bun/copilotkit/import.test.ts` | mapping matrix (12 tests incl. WR-04 tests 9-10) | ✓ VERIFIED | 12/12 pass |
| `src/bun/test/threads-handlers.test.ts` | enrichment/orphan/empty cases | ✓ VERIFIED | 3/3 pass |
| `e2e/api/copilotkit/threads.test.ts` | session + card + restart-proof listing | ✓ VERIFIED | 3/3 pass |
| `e2e/api/copilotkit/legacy-import.test.ts` | import wire + restart replay + crash tolerance A/B/C | ✓ VERIFIED | 5/5 pass; Test C self-contained (WR-05) |
| `04-COVERAGE.md` / `04-VALIDATION.md` | decision record + sign-off | ✓ VERIFIED | Both present and complete |

### Key Link Verification

| From | To  | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `JsonlStore.list()` | filesystem scan | THREAD_ID_RE filter before any path use | ✓ WIRED | jsonl-store.ts:152-155 — regex gate precedes statSync; no raw filename interpolation |
| `threads.ts` handler | DB join | tasks/chat_sessions LEFT JOIN keyed on conversations.id; kind = task_id != null | ✓ WIRED | threads.ts:51-58, parameterized, no conversations.created_at |
| `threads.list` | disk index | store.list() (not runner.listThreads() memory) | ✓ WIRED | e2e restart proof (fresh server over durable dataDir) passes |
| `runLegacyImport` | idempotency marker | store.exists(threadId) + atomic importLog | ✓ WIRED | import.ts:295/307; ThreadLogExistsError → skipped (not failed) |
| `buildThreadLog` | replay-valid log | block closure + TOOL_CALL_RESULT messageId `${toolCallId}-result` + RUN_FINISHED | ✓ WIRED | import.ts closeRun + toolResultEvent; lifecycle scan unit test passes |
| toolCallId namespacing | per-run uniqueness | `${runId}-${callId}` | ✓ WIRED | import.ts:244; unit test (Pitfall 4) passes |
| Handlers | composition root | allHandlers registration | ✓ WIRED | index.ts:342-343 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| threads.ts | files + row metadata | store.list() readdir/stat + parameterized DB join | Yes — e2e creates real session/card runs and lists them; restart re-lists from disk | ✓ FLOWING |
| import.ts | ConversationMessageRow[] | `SELECT * FROM conversation_messages WHERE conversation_id = ?` | Yes — e2e seeds real rows, asserts JSONL on disk (RUN_STARTED first/RUN_FINISHED last) | ✓ FLOWING |
| legacy-import.test.ts crash A | corrupted log | appendFileSync partial tail on real thread file | Yes — real replay asserts complete lines, partial tail skipped | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Store list() + importLog (12 tests incl. decoys, crash tolerance, atomicity) | `bun test src/bun/copilotkit/jsonl-store.test.ts --timeout 20000` | 12 pass / 0 fail | ✓ PASS |
| Import mapping matrix (namespacing, dangling, malformed, lifecycle, WR-04 placement) | `bun test src/bun/copilotkit/import.test.ts --timeout 20000` | 12 pass / 0 fail | ✓ PASS |
| threads.list handler (enrichment/orphan/empty) | `bun test src/bun/test/threads-handlers.test.ts --timeout 20000` | 3 pass / 0 fail | ✓ PASS |
| threads.list real wire (session/card/restart) | `bun test e2e/api/copilotkit/threads.test.ts --timeout 30000` | 3 pass / 0 fail | ✓ PASS |
| Import wire + replay + crash tolerance A/B/C | `bun test e2e/api/copilotkit/legacy-import.test.ts --timeout 30000` | 5 pass / 0 fail | ✓ PASS |
| Full backend regression | `bun test src/bun --timeout 20000` | 2394 pass / 2 skip / 0 fail | ✓ PASS |
| Typecheck | `bun run typecheck` | 0 errors | ✓ PASS |

### Probe Execution

Step 7c: SKIPPED — no probes declared in PLANs or found under `scripts/*/tests/probe-*.sh` for this phase; verification contract is the standard bun test + typecheck surface (all run above).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| CHAT-08 | 04-01, 04-03 | User can list and navigate thread conversations via Railyin's own thread-index endpoint | ✓ SATISFIED | threads.list RPC live end-to-end (unit 3/3 + e2e 3/3 incl. restart-from-disk); crash-tolerance listing e2e A/B |
| IMPR-01 | 04-02, 04-03 | User can trigger a legacy import that converts old conversation_messages/stream_events rows into JSONL threads | ✓ SATISFIED | legacyImport.run RPC over real wire; mapping matrix 12/12; restart replay e2e |
| IMPR-02 | 04-02, 04-03 | Old chat tables are frozen, not dropped; import is on-demand and idempotent | ✓ SATISFIED | SELECT-only import (unit test 10 + e2e frozen counts); idempotent re-run (e2e test 1 + unit test 9 + crash tests B/C) |

**Orphaned requirements:** none — all three phase requirement IDs (CHAT-08, IMPR-01, IMPR-02) are claimed by plan frontmatter and satisfied with evidence.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None found — no TBD/FIXME/XXX/PLACEHOLDER markers in any phase-modified source file | — | — |

### Review-Fix Verification (5 warnings + 3 infos, commits 23d19f76..9d29d302)

| Finding | Fix Commit | Fix Present in Code | Verified By |
| ------- | ---------- | ------------------- | ----------- |
| WR-01 mixed timestamp formats | 23d19f76 | ✓ `toIso()` in threads.ts:36-41 (ISO-8601 for DB + file sources; unit test updated) | code read + handler tests 3/3 pass |
| WR-02 TOCTOU exists/rename clobber | 6667fc03 | ✓ `importLog` publishes via `linkSync` (EEXIST → `ThreadLogExistsError`); `runLegacyImport` counts it as skipped (import.ts:310-315); .tmp unlinked on refuse (jsonl-store.ts:130) | code read + import/atomicity tests pass |
| WR-03 birthtime-0 fallback | 98f72fe0 | ✓ `f.birthtimeMs > 0 ? f.birthtimeMs : f.mtimeMs` (threads.ts:67) | code read |
| WR-04 system-row drop/misattribution | 9d3c05c6 | ✓ RUN_STARTED deferred to closeRun(final); trailing system rows folded into last run's input; mid-run rows → next run (import.ts:145-175, 274) | code read + import.test.ts tests 9-10 pass |
| WR-05 order-coupled e2e | 804fa09a | ✓ Test C self-contained (own dataDir + seed + artifact); Test A owns its dir end-to-end (legacy-import.test.ts:280-307) | code read + all 5 e2e tests pass independently |
| IN-01 no-op `m.id >= 0` | e95b2e77 | ✓ removed (import.ts:286-288) | code read |
| IN-02 duplicate header | ad460570 | ✓ single `// ─── RPC schema ───` at rpc-types.ts:654 | grep |
| IN-03 empty importLog marker | 9d29d302 | ✓ `if (events.length === 0) return;` (jsonl-store.ts:115) | code read + store tests 12/12 pass |

All 8 commits verified in git history (23d19f76..9d29d302 = exactly 8 fix commits); working tree clean.

### Human Verification Required

None. All truths carry behavioral evidence from passing unit + real-wire e2e suites (no external services, no UI in this phase — the Vue thread-list/import-button UI is explicitly deferred to Phase 5 per plan objective notes and 04-CONTEXT.md).

### Gaps Summary

No gaps found. Phase goal is achieved on all five ROADMAP success criteria:

1. ✓ Thread index user-accessible — `threads.list` RPC lists every JSONL thread (card + session) with name/kind/timestamps, proven over the real wire including a fresh-server restart (index from disk)
2. ✓ Legacy import on demand — `legacyImport.run` converts frozen conversation_messages rows into valid AG-UI JSONL threads
3. ✓ Idempotent — atomic no-clobber write is the D-07 marker; re-runs import 0 / skip N; crash artifacts cannot fool the marker
4. ✓ Frozen tables — SELECT-only import; row counts identical before/after (unit + e2e pinned)
5. ✓ Crash tolerance — partial trailing lines still list and replay across a restart; .tmp residues invisible; re-import safe (e2e A/B/C)

---

_Verified: 2026-08-09_
_Verifier: the agent (gsd-verifier)_

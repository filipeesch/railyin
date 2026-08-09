# Phase 4: JSONL Persistence & Legacy Import - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase hardens the JSONL store to crash tolerance, exposes the thread index to the user through Railyin's own thread-index endpoint, and delivers the on-demand, idempotent legacy import that converts old `conversation_messages`/`stream_events` rows into JSONL threads over frozen tables. Deliberately NOT in scope: any Vue UI for thread listing or the import button (Phase 5 consumes the endpoint + import RPC), thread rename/archive/delete (v2 nicety), realtime thread sync (anti-feature).

</domain>

<decisions>
## Implementation Decisions

### Thread-Index Endpoint (CHAT-08)
- **D-01:** Build Railyin's own thread-index endpoint — `GET /api/threads` — listing JSONL files (threadId, name if available, createdAt/updatedAt from file metadata). Phase 1 evidence: the runtime's local `GET /threads` fallback exists via `runner.listThreads()` but returns only in-memory state and offers no rename/metadata; Railyin owns the files, so the own endpoint is authoritative and ~30 lines against the JSONL dir (research STACK.md:58). — **Reversibility:** reversible — additive RPC endpoint.
- **D-02:** The endpoint is a RailynAPI RPC method (follows the shared-contract discipline: `src/shared/rpc-types.ts` + handler + frontend consumer later), NOT a raw route outside the contract. Phase 5's thread-list UI consumes it.
- **D-03:** Thread identity/metadata: threadId = conversation.id for cards, sessions = threads without taskId (locked Phase 2, RUNR-03). Metadata (name/createdAt/updatedAt) derives from the JSONL file + optional sidecar `{threadId}.meta.json` (research ARCHITECTURE.md:123) — keep minimal; rename/archive/delete are v2.

### Crash-Tolerant Store (success criterion 5)
- **D-04:** The store tolerates interrupted/corrupted writes: trailing partial lines are skipped on read (tolerant reader — Phase 2 already has this), and the thread index rebuilds from the log (scan files → derive entries). No thread is lost on interrupted writes.
- **D-05:** Write path hardening: append is atomic-ish per line (single `appendFileSync`/buffered flush); an interrupted write leaves at most one partial trailing line which the tolerant reader skips. A durable index (separate index file) is NOT needed — the log IS the index (research ARCHITECTURE.md:123 "index rebuilds from the log").

### Legacy Import (IMPR-01, IMPR-02)
- **D-06:** On-demand import triggered via an RPC method (`legacyImport.run` or similar) — the "import button" from PROJECT.md; conversion reads old `conversation_messages`/`stream_events` rows and writes JSONL threads (threadId = conversation.id mapping).
- **D-07:** Idempotent (success criterion 3): running import again produces no duplicate threads/messages. Mechanism: skip conversations already imported (marker — e.g., a `threads/{id}.jsonl` existence check or a per-conversation "imported" marker in a small table/flag); re-import only missing ones.
- **D-08:** Old tables remain frozen and readable throughout (IMPR-02) — import only READS old tables, never writes; no schema changes; no drops (Phase 7 retires the import behind a flag once complete).

### the agent's Discretion
- Exact RPC method names/shapes (`threads.list`, `legacyImport.run` etc.) — planner follows the RailynAPI naming conventions.
- Whether the runtime's own `GET /threads` (threadEndpoints.list) is also exposed for client compat, or only Railyin's endpoint — planner decides based on Phase 5 needs.
- Import batch size / progress reporting (single-shot vs paged) — planner picks within local-app simplicity.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (produced this project)
- `.planning/research/STACK.md` lines 58, 71 — own thread-index endpoint rationale; useThreads Intelligence-only constraint.
- `.planning/research/FEATURES.md` lines 21, 44, 84, 120, 180 — thread listing scope, own-endpoint fallback, v2 niceties (rename/archive/delete).
- `.planning/research/ARCHITECTURE.md` line 123 — JSONL design: per-line events, index rebuild from log, optional `{threadId}.meta.json`.
- `.planning/research/PITFALLS.md` lines 18-26 — connect/empty-thread canonical sequence; tolerant-read discipline.
- `.planning/research/SUMMARY.md` — Phase 4 = "JSONL Persistence & Legacy Import" (file-store/import standard patterns).

### Project documents
- `.planning/PROJECT.md` — JSONL storage constraint, thread = conversation, legacy-import button, frozen tables (lines 28, 30, 57, 109-155 Phase 1 evidence: threadEndpoints.list/inspect true, GET /threads response shape).
- `.planning/REQUIREMENTS.md` — CHAT-08, IMPR-01, IMPR-02 (this phase).
- `.planning/ROADMAP.md` §Phase 4 — 5 success criteria.

### Codebase (integration points)
- `src/bun/copilotkit/jsonl-store.ts` — Phase 2 store; hardening target (D-04/D-05).
- `src/bun/copilotkit/railyin-runner.ts` — Phase 2 runner; index source.
- `src/shared/rpc-types.ts` — RailynAPI contract for the new methods (D-02).
- `src/bun/handlers/` — handler pattern for the new RPC methods.
- `src/bun/db/migrations/` — legacy table schemas (`conversation_messages`, `stream_events`, `chat_sessions`) read sources for import.
- `.planning/phases/02-ag-ui-bridge-railyinagentrunner/02-02-SUMMARY.md` — what the Phase 2 store does today (tolerant reader exists).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/bun/copilotkit/jsonl-store.ts` — Phase 2 store with tolerant reader (partial-line skip); extend for index rebuild + metadata.
- `src/bun/copilotkit/railyin-runner.ts` — per-thread file ownership; `listThreads()`-adjacent info.
- `src/bun/handlers/*.ts` — established RPC handler pattern (typed against RailynAPI).
- `src/bun/db/repositories/*` — repository pattern for reading legacy tables.

### Established Patterns
- Shared-contract discipline: RailynAPI method change → handler + frontend consumer updated together.
- Repository pattern for DB reads; raw SQL via bun:sqlite.
- Config-driven behavior; local-first single process.

### Integration Points
- `src/shared/rpc-types.ts` — new methods (`threads.list`, `legacyImport.run`).
- `src/bun/handlers/threads.ts` + `legacy-import.ts` (new) — handler modules.
- `src/bun/index.ts` — handler registration.
- `data/threads/` — JSONL dir (getDataDir-based).

</code_context>

<specifics>
## Specific Ideas

- Success criterion 1: "User can list and open every thread through Railyin's own thread-index endpoint" — the endpoint returns card conversations AND standalone sessions.
- Success criterion 3: idempotent import — the marker mechanism is the key design point (D-07).
- Success criterion 5: interrupted/corrupted writes never lose a thread — the tolerant reader + log-as-index (D-04/D-05) is the proof.
- Phase 1 evidence: `threadEndpoints.list`/`inspect` true, `mutations` false on the runtime — Railyin's endpoint covers listing; mutations are v2.

</specifics>

<deferred>
## Deferred Ideas

- Vue thread-list UI + import button rendering — Phase 5.
- Thread rename/archive/delete via own endpoint — v2 (CHAT-13), trigger: >20 threads.
- Realtime thread sync (useThreads premium) — anti-feature, never.
- Import retirement behind a flag — Phase 7.

</deferred>

---

*Phase: 4-JSONL Persistence & Legacy Import*
*Context gathered: 2026-08-09*

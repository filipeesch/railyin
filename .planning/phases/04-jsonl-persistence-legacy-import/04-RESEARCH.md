# Phase 4: JSONL Persistence & Legacy Import - Research

**Researched:** 2026-08-09
**Domain:** Append-only JSONL file persistence, crash tolerance, file-derived thread indexing, SQLite→JSONL legacy migration
**Confidence:** HIGH

## Summary

Phase 4 hardens the Phase 2 `JsonlStore` (crash tolerance + index rebuild from the log), exposes a thread-index RPC endpoint (`threads.list`) that lists every JSONL thread with DB-derived names, and delivers an on-demand, idempotent legacy import (`legacyImport.run`) that converts frozen `conversation_messages` rows into valid AG-UI JSONL logs. All three capabilities are verified against the installed, version-pinned packages (`@copilotkit/runtime@1.66.4`, `@ag-ui/core@0.0.57`) and the current in-repo implementation — **no new third-party packages are needed; everything is bun built-ins + existing pinned deps.**

The single most important design fact verified this session: **the runtime's own `GET /threads` is already live** (RailyinAgentRunner inherits `ɵsupportsLocalThreadEndpoints = true` from `InMemoryAgentRunner`, so `/info` advertises `threadEndpoints.list/inspect: true`), **but `listThreads()` reads only the process-global in-memory store** — after a restart it returns an empty list even when JSONL files exist. This is precisely D-01's rationale: Railyin's own `threads.list` RPC scanning the JSONL directory is the authoritative index. The tolerant reader already exists in Phase 2 (`jsonl-store.ts` skips + warns malformed/partial lines); Phase 4 adds the directory scan (`list()`), the endpoint handler, and the import module with an atomic tmp+rename write whose existence *is* the idempotency marker.

**Primary recommendation:** (1) Add `JsonlStore.list()` — `readdirSync` scan of `data/threads/` filtered by `THREAD_ID_RE`, returning `{threadId, mtimeMs, size}` (skip, never throw, on non-conforming files). (2) New RPC `threads.list` in `src/bun/handlers/threads.ts` registered in `index.ts` `allHandlers` — returns `ThreadSummary[]` derived from the file scan + DB join (name via `tasks.title`/`chat_sessions.title`, timestamps via event `timestamp` field → file mtime fallback; note: `conversations` has NO `created_at` column). (3) New pure module `src/bun/copilotkit/import.ts`: `buildThreadLog(conversationId, rows)` (message→BaseEvent mapping, one synthetic run per user message — mirrors the runner's per-turn run shape) + `runLegacyImport(db, store)` (query conversations with messages, skip when `store.exists()`, build events, atomic `writeFileSync(tmp)` + `renameSync`). No schema changes, no writes to legacy tables, no new deps.

## Project Constraints (from AGENTS.md)

- **Commands:** `bun install`, `bun run dev`, `bun run prod`, `bun run build` (frontend → `dist/`); types via `bun run typecheck` (tsc --noEmit).
- **Path aliases** (`vitest.config.ts`): `@` → `src/mainview/`, `@shared` → `src/shared/`, `@bun` → `src/bun/` — new imports must use them where relevant.
- **Testing:** `bun test src/bun --timeout 20000` (all backend), `bun test src/bun/test/orchestrator.test.ts`-style single-file runs, `bun test e2e/api --timeout 30000` (API smoke), `bun run test:e2e` (Playwright, builds first, runs against `dist/` via `vite preview`, `/api/*` mocked via `page.route()` — **no Bun server for UI tests**), `bun run test:mutation` (Stryker, separate).
- **Shared-contract discipline:** `src/shared/rpc-types.ts` is the source of truth — update types, backend handlers (`src/bun/handlers/*`), and frontend consumers together. New RPC methods MUST follow the `RailynAPI` map + handler pattern.
- **Config-driven:** workflow behavior lives in YAML; hardcoding workflow logic is wrong. (Not directly exercised this phase.)
- **Gotcha:** default DB state is in-memory when `--real-db` is NOT passed to `dev`; `bun run prod` uses the SQLite DB by default. Tests set `RAILYN_DB=:memory:` (see `src/bun/test/helpers.ts:11`).
- **Pi per-model config / reasoning config (breaking):** engine-level preset keys moved under models — irrelevant to this phase (no config changes).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Build Railyin's own thread-index endpoint — `GET /api/threads` — listing JSONL files (threadId, name if available, createdAt/updatedAt from file metadata). Phase 1 evidence: the runtime's local `GET /threads` fallback exists via `runner.listThreads()` but returns only in-memory state and offers no rename/metadata; Railyin owns the files, so the own endpoint is authoritative and ~30 lines against the JSONL dir (research STACK.md:58). — **Reversibility:** reversible — additive RPC endpoint.
- **D-02:** The endpoint is a RailynAPI RPC method (follows the shared-contract discipline: `src/shared/rpc-types.ts` + handler + frontend consumer later), NOT a raw route outside the contract. Phase 5's thread-list UI consumes it.
- **D-03:** Thread identity/metadata: threadId = conversation.id for cards, sessions = threads without taskId (locked Phase 2, RUNR-03). Metadata (name/createdAt/updatedAt) derives from the JSONL file + optional sidecar `{threadId}.meta.json` (research ARCHITECTURE.md:123) — keep minimal; rename/archive/delete are v2.
- **D-04:** The store tolerates interrupted/corrupted writes: trailing partial lines are skipped on read (tolerant reader — Phase 2 already has this), and the thread index rebuilds from the log (scan files → derive entries). No thread is lost on interrupted writes.
- **D-05:** Write path hardening: append is atomic-ish per line (single `appendFileSync`/buffered flush); an interrupted write leaves at most one partial trailing line which the tolerant reader skips. A durable index (separate index file) is NOT needed — the log IS the index (research ARCHITECTURE.md:123 "index rebuilds from the log").
- **D-06:** On-demand import triggered via an RPC method (`legacyImport.run` or similar) — the "import button" from PROJECT.md; conversion reads old `conversation_messages`/`stream_events` rows and writes JSONL threads (threadId = conversation.id mapping).
- **D-07:** Idempotent (success criterion 3): running import again produces no duplicate threads/messages. Mechanism: skip conversations already imported (marker — e.g., a `threads/{id}.jsonl` existence check or a per-conversation "imported" marker in a small table/flag); re-import only missing ones.
- **D-08:** Old tables remain frozen and readable throughout (IMPR-02) — import only READS old tables, never writes; no schema changes; no drops (Phase 7 retires the import behind a flag once complete).

### the agent's Discretion

- Exact RPC method names/shapes (`threads.list`, `legacyImport.run` etc.) — planner follows the RailynAPI naming conventions.
- Whether the runtime's own `GET /threads` (threadEndpoints.list) is also exposed for client compat, or only Railyin's endpoint — planner decides based on Phase 5 needs.
- Import batch size / progress reporting (single-shot vs paged) — planner picks within local-app simplicity.

### Deferred Ideas (OUT OF SCOPE)

- Vue thread-list UI + import button rendering — Phase 5.
- Thread rename/archive/delete via own endpoint — v2 (CHAT-13), trigger: >20 threads.
- Realtime thread sync (useThreads premium) — anti-feature, never.
- Import retirement behind a flag — Phase 7.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHAT-08 | User can list and navigate thread conversations via Railyin's own thread-index endpoint (self-hosted; `useThreads` not usable) | `threads.list` RPC contract below; runtime `GET /threads` proven in-memory-only (empty after restart) — own endpoint scans the JSONL dir; name/kind via DB join; timestamps via event `timestamp`/file mtime |
| IMPR-01 | User can trigger a legacy import button that converts old `conversation_messages`/`stream_events` rows into JSONL threads | `legacyImport.run` RPC + `src/bun/copilotkit/import.ts`; exact legacy schemas quoted from migrations; message→AG-UI event mapping verified against event-bridge shapes; atomic tmp+rename write |
| IMPR-02 | Old chat tables are frozen, not dropped; import is on-demand and idempotent | Import SELECTs only (verified: all writes flow through `bun:sqlite` inserts elsewhere; import code must never write to legacy tables); idempotency = atomic whole-file write whose existence is the marker (D-07) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Thread-index listing | API / Backend | File system (fallback timestamps) | RPC handler scans `data/threads/` + joins DB for names; file mtime/birthtime only as timestamp fallback |
| JSONL crash tolerance | API / Backend | — | Pure file module (`JsonlStore`): tolerant reader + atomic-ish append + `list()` scan; no other tier involved |
| Legacy data conversion | API / Backend | — | `import.ts` reads frozen SQLite tables via `bun:sqlite`, writes JSONL files; single-process, server-side |
| Metadata (name/kind) | API / Backend | — | `tasks.title` / `chat_sessions.title` joins keyed on `conversations.id`; live DB, no sidecar needed for v1 |
| Thread-list UI / import button | Browser / Client | — | Phase 5 consumes the two RPC methods; explicitly OUT of Phase 4 scope |

## Standard Stack

### Core

No new libraries. The phase runs entirely on bun built-ins (`bun:sqlite`, `node:fs`) and already-pinned deps:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:sqlite` (Database) | bundled (bun 1.4.0) | Read legacy tables for import; DB joins for thread names | Existing repo-wide pattern (`getDb()`, parameterized queries) |
| `node:fs` (`readdirSync`, `statSync`, `writeFileSync`, `renameSync`) | node 20 | Thread dir scan, mtime/birthtime, atomic import writes | Existing `jsonl-store.ts` already uses `appendFileSync`/`existsSync`/`mkdirSync`/`readFileSync` |
| `@ag-ui/core` | 0.0.57 (pinned) | `EventType` enum + event shapes for synthesized BaseEvents | The wire protocol; import must emit its events |
| `@copilotkit/runtime` | 1.66.4 (pinned) | `compactEvents`, `finalizeRunEvents` — replay contracts the imported log must satisfy | Already the runtime; `compactEvents` consumes the log shape import produces |
| `src/shared/rpc-types.ts` `RailynAPI` | — | Contract for `threads.list` + `legacyImport.run` | Mandated by D-02 shared-contract discipline |

**Installation:**
```bash
# No new packages. Nothing to install.
```

**Version verification (ecosystem-appropriate commands):**
```bash
bun --version        # 1.4.0 — verified this session
node --version       # v20.20.1 — verified this session
```
`@ag-ui/core@0.0.57` and `@copilotkit/runtime@1.66.4` verified by reading the installed packages in `node_modules/` this session (authoritative for pinned versions). No new installs → no version-staleness risk.

## Package Legitimacy Audit

> No external packages are installed by this phase — the Package Legitimacy Gate is N/A. All work uses bun built-ins and already-pinned dependencies (`@ag-ui/core@0.0.57`, `@ag-ui/client@0.0.57`, `@copilotkit/runtime@1.66.4`, `bun:sqlite`, `node:fs`). No `npm install`/`bun add` step belongs in this phase's plan.

**Packages removed due to [SLOP] verdict:** none (no new packages)
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                       ┌────────────────────────────────────────────────┐
                       │              Bun.serve (single process)        │
                       │                                                │
  POST /api/threads.list ──► allHandlers["threads.list"] ──► threads.ts │
  (RPC router, index.ts:414)    │                     ▲                 │
                       │        │                     │ ThreadSummary[]  │
                       │        ▼                     │                  │
                       │   JsonlStore.list()          │                  │
                       │   (readdirSync threads dir,  │                  │
                       │    THREAD_ID_RE filter)      │                  │
                       │        │                     │                  │
                       │        ▼                     │                  │
                       │   DB join: conversations ────┘   name/kind      │
                       │   LEFT JOIN tasks (title),         timestamps    │
                       │   chat_sessions (title)                          │
                       │                                                │
  POST /api/legacyImport.run ──► allHandlers["legacyImport.run"]         │
  (RPC router)                 ──► import.ts:                            │
                                   1. SELECT conversations w/ messages   │
                                   2. store.exists(threadId)? → skip     │
                                   3. buildThreadLog(rows) → BaseEvent[] │
                                   4. writeFileSync(.tmp) + renameSync   │
                                       ── atomic; existence = marker ──► │
                       │                    │                            │
                       │                    ▼                            │
                       │          data/threads/{id}.jsonl ◄── JsonlStore  │
                       │          (log IS the index; tolerant read)      │
                       └────────────────────────────────────────────────┘
```

**Entry points:** two POST RPC methods routed by the existing `/api/*` router (`index.ts:414-437`). **Processing:** scan → enrich → (import) convert → atomic write. **Decision points:** `store.exists()` skip (idempotency); non-`/^\d+$/` files skipped in `list()`; malformed tool-call JSON skipped, counted, never crashes. **External deps:** none (SQLite is local file-backed; `data/threads/` local).

### Recommended Project Structure (additions only)

```
src/
├── bun/
│   ├── copilotkit/
│   │   ├── jsonl-store.ts      # MODIFY: add list(); keep append/read/exists/endRun semantics
│   │   ├── import.ts           # NEW: buildThreadLog() (pure) + runLegacyImport(db, store)
│   │   ├── import.test.ts      # NEW: mapping, run grouping, idempotency, atomicity
│   ├── handlers/
│   │   ├── threads.ts          # NEW: threadHandlers(db, store) → { "threads.list": ... }
│   │   └── legacy-import.ts    # NEW: legacyImportHandlers(db, store) → { "legacyImport.run": ... }
│   ├── index.ts                # MODIFY: register both handler sets in allHandlers (lines 317-343)
├── shared/
│   └── rpc-types.ts            # MODIFY: ThreadSummary interface + two RailynAPI entries
└── e2e/
    └── api/
        └── copilotkit/legacy-import.test.ts  # NEW (optional): seeded-DB import + restart replay
```

### Pattern 1: File-scan index — the log IS the index (D-04/D-05)

**What:** `JsonlStore.list()` derives the thread index by scanning `data/threads/` — no separate index file, no watcher, no state. `readdirSync` + regex filter + `statSync` mtime/size.
**When to use:** any request that needs the thread set; cheap at local-app scale (tens of files).
**Example (contract — store side):**

```typescript
// Source: derived from jsonl-store.ts:23-28 (THREAD_ID_RE, threadLogPath) — new method
/** Index rebuild from the log (D-04): scan the threads dir; non-conforming
 *  files (e.g. `{id}.jsonl.tmp`, `{id}.meta.json`) are SKIPPED, never thrown. */
list(): Array<{ threadId: string; mtimeMs: number; size: number }> {
  const dir = join(this.dataDir, "threads");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl") && THREAD_ID_RE.test(name.slice(0, -6)))
    .map((name) => {
      const threadId = name.slice(0, -6);
      const st = statSync(join(dir, name));
      return { threadId, mtimeMs: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}
```

### Pattern 2: Atomic whole-file import write — existence is the marker (D-07)

**What:** the import never appends to a live log; it builds the complete event array in memory (source is SQLite, not a stream), writes `{threadId}.jsonl.tmp`, then `renameSync` — an atomic POSIX operation. A crashed import leaves only a `.tmp` (never matched by `list()`'s `.jsonl` filter, never treated as imported); the final file's existence is the idempotency marker.
**When to use:** any one-shot file generation where "file exists = done" must be trustworthy under crashes.

```typescript
// Source: standard Node fs pattern (writeFileSync + renameSync); validates against
// jsonl-store.ts threadId rules — route through the store's assertThreadId.
const tmpPath = threadLogPath(dataDir, threadId) + ".tmp";
writeFileSync(tmpPath, lines.join("\n") + "\n", "utf-8");
renameSync(tmpPath, threadLogPath(dataDir, threadId)); // atomic on POSIX
```

### Pattern 3: One synthetic run per user message (import log shape)

**What:** the runner persists one run per user turn (`RUN_STARTED {input.messages}` → assistant/tool events → `RUN_FINISHED`). The import reproduces exactly this shape so the cold-replay path (`railyin-runner.ts:149-190`: truncate-at-RUN_ERROR → `finalizeRunEvents` → `completeOpenToolCalls` → `compactEvents`) and the pinned client's `verifyEvents` both accept the log. Each user message starts a new run; system messages attach to the FIRST run's input; trailing assistant content joins the last run.
**When to use:** whenever converting turn-based history into AG-UI logs (multi-run replay is proven — 02-02 runner tests D3).

```typescript
// Source: synthesized from verified event-bridge.ts shapes (lines 64-72, 120-155)
// and @ag-ui/core BaseEvent/RunAgentInput schemas — contract for import.ts.
{ type: EventType.RUN_STARTED, threadId, runId, input: {
    threadId, runId, state: null,
    messages: [{ id: "legacy-12", role: "user", content: "fix the build" }],
  }}
{ type: EventType.TEXT_MESSAGE_START, messageId: "import-7-1-text-1", role: "assistant" }
{ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "import-7-1-text-1", delta: "Looking…" }
{ type: EventType.TEXT_MESSAGE_END, messageId: "import-7-1-text-1" }
{ type: EventType.TOOL_CALL_START, toolCallId: "import-7-1-call_42", toolCallName: "shell" }
{ type: EventType.TOOL_CALL_ARGS, toolCallId: "import-7-1-call_42", delta: "{\"cmd\":\"ls\"}" }
{ type: EventType.TOOL_CALL_END, toolCallId: "import-7-1-call_42" }
{ type: EventType.TOOL_CALL_RESULT, toolCallId: "import-7-1-call_42",
  messageId: "import-7-1-call_42-result", content: "…", role: "tool" }
{ type: EventType.RUN_FINISHED, threadId, runId, result: null }
```

### Anti-Patterns to Avoid

- **Separate index file:** D-05 locks "the log IS the index". A `threads/index.json` would drift from the files, need locking, and duplicate the crash-tolerance problem.
- **Import by append per message:** a crashed mid-append import would leave a *partial* file that `exists()` then treats as imported — silent data loss. Always tmp+rename.
- **Importing into a thread the new stack already ran:** the file exists (new-format events) — appending legacy runs would corrupt the log order. Existence check skips it (same check as idempotency).
- **Driving import through the runner/agent:** import is pure file generation, never a `run()` — no engine, no lock, no wire traffic.
- **Raw tool-call JSON parsing without defense:** legacy `tool_call` content is JSON (`{id, function:{name, arguments}}`); malformed rows must be skipped + counted, never crash the import (mirror WR-05/`translateResumeToSubmission` defensive parsing, event-bridge.ts:402-422).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Thread listing / index | A persistent index file, watcher, or DB table of threads | `readdirSync` scan per request (Pattern 1) | Local app, tens of files; the log IS the index (D-05); no drift, no locking |
| Atomic import write | Custom locking, partial-append with existence marker | `writeFileSync(tmp)` + `renameSync` (atomic on POSIX) | Interrupted append + existence-check marker = exactly the data-loss criterion 5 forbids |
| Legacy row reads | Hand-rolled connection/ORM | `bun:sqlite` parameterized queries (repo pattern) | Existing pattern everywhere; parameterized = no injection |
| Tool-call metadata parsing | Custom schema validators | `JSON.parse` + defensive shape checks (bridge precedent) | Old engines wrote varied shapes; skip-don't-crash |
| Timestamp parsing | Hand-rolled date math | `Date.parse(created_at.replace(" ", "T") + "Z")` | SQLite `datetime('now')` is naive UTC; naive parse shifts by the local offset |
| Event replay safety | Verifying the log by hand | Rely on the proven cold-replay pipeline (`railyin-runner.ts:149-190`) | Multi-run replay + dangling-tool synthesis + compaction are already tested (02-02) |

**Key insight:** every piece of "infrastructure" this phase needs already exists in-repo or in the pinned packages. The phase is ~3 additive modules + 2 handler registrations; any temptation to build index files, watchers, or validation frameworks is scope creep.

## Common Pitfalls

### Pitfall 1: SQLite `datetime('now')` timestamps are naive UTC
**What goes wrong:** `Date.parse("2026-08-09 08:00:00")` (no `Z`) parses as LOCAL time — imported event timestamps and derived `createdAt`/`updatedAt` shift by the machine's UTC offset.
**Why it happens:** SQLite `datetime()` emits `"YYYY-MM-DD HH:MM:SS"` in UTC with no timezone marker; JS `Date.parse` assumes local.
**How to avoid:** normalize before parsing: `Date.parse(created_at.replace(" ", "T") + "Z")`. Unit-test the conversion with a fixed string. (`created_at` columns verified: `001_initial.ts:90`, `018_stream_events.ts:18`, `026_chat_sessions.ts:97`.)
**Warning signs:** imported thread timestamps off by hours in the Phase 5 UI.

### Pitfall 2: `conversations` has no `created_at` column
**What goes wrong:** `threads.list` tries `SELECT created_at FROM conversations` → SQL error.
**Why it happens:** the table's full column set is `id, task_id, parent_conversation_id, forked_at_message_id, model, sampling_preset_override, model_params, decisions_injected_after_compaction_id` (verified `row-types.ts:14-21` + migrations 026/035/042/047/051) — no timestamp anywhere.
**How to avoid:** createdAt = first event `timestamp` (import writes them) → else `chat_sessions.created_at` / `tasks.created_at` (via `conversation_id`) → else file birthtime → else mtime. updatedAt = last event `timestamp` → else file mtime (accurate for append-only logs).
**Warning signs:** planner writes a `conversations.created_at` query; typecheck passes but runtime SQL fails.

### Pitfall 3: Runtime `GET /threads` is live but always empty after restart
**What goes wrong:** Phase 5 wires the client to `/api/copilotkit/threads` and sees zero threads despite JSONL files on disk.
**Why it happens:** `InMemoryAgentRunner`'s constructor sets `ɵsupportsLocalThreadEndpoints = true` (verified `node_modules/@copilotkit/runtime/dist/v2/runtime/runner/in-memory.mjs:285`) so the runtime advertises `threadEndpoints.list/inspect: true`; but the local handler calls `runner.listThreads()` which iterates the process-global in-memory store only (verified `threads.mjs:63-71`, `in-memory.mjs:237-254`) — a fresh process has an empty store.
**How to avoid:** `threads.list` RPC is the authoritative index (D-01). Document for Phase 5: never consume the runtime endpoint for the list. (Discretion item — planner can note the runtime endpoint exists for client compat, but it must not be the data source.)
**Warning signs:** e2e asserting the runtime `/threads` after restart.

### Pitfall 4: Reused tool call ids across legacy runs
**What goes wrong:** legacy engines reuse call ids sequentially (`call_0`, …) across executions; `TOOL_CALL_RESULT.messageId = ${toolCallId}-result` (bridge convention, event-bridge.ts:64-72) then collides across runs in one thread → client reconciliation dedupes messages wrongly on replay.
**Why it happens:** the new-stack bridge namespaces child ids (`${parentCallId}::${callId}::${seq}`); imported raw ids are global per conversation.
**How to avoid:** namespace every imported toolCallId per run: `${runId}-${callId}` (runId = `import-${conversationId}-${n}`). Keep `toolCallName` from `function.name`.
**Warning signs:** replay shows duplicated/missing tool cards.

### Pitfall 5: Existence-marker idempotency broken by partial appends
**What goes wrong:** an import that appends per event creates the final file early; a crash mid-way leaves a truncated-but-present file that `exists()` treats as imported (criterion 5 violated).
**Why it happens:** existence checks cannot distinguish "fully written" from "started".
**How to avoid:** tmp+rename (Pattern 2). `list()` must also ignore `*.jsonl.tmp` (Pattern 1's filter already does).
**Warning signs:** import tests that kill mid-write and re-run.

### Pitfall 6: Import tripping the client's lifecycle validation
**What goes wrong:** a run without `RUN_STARTED`, content events without `TEXT_MESSAGE_END`, `TOOL_CALL_RESULT` without a matching `TOOL_CALL_START`, or a `RUN_FINISHED` while a text block is open → `verifyEvents` rejects on connect (Pitfall 2 in PITFALLS.md; AG-UI ordering rules confirmed via Context7).
**Why it happens:** hand-synthesized logs forget the lifecycle rules the runner enforces implicitly.
**How to avoid:** every run: `RUN_STARTED` first, terminal last; close every opened message/tool block before the terminal; synthesize empty `TOOL_CALL_RESULT` for dangling calls at import time (mirrors `synthesizeMissingToolResults`, event-bridge.ts:304-312). Assert log validity in unit tests with the same shapes the runner tests assert.
**Warning signs:** imported thread fails to hydrate on cold connect; `Cannot send event type` errors.

## Code Examples

Verified patterns from this codebase / installed packages:

### Thread listing scan + DB-enriched metadata (`threads.list`)

```typescript
// Contract for src/bun/handlers/threads.ts — new file, follows conversationHandlers pattern
// (src/bun/handlers/conversations.ts:13-109). ThreadSummary added to rpc-types.ts.
export function threadHandlers(db: Database, store: JsonlStore) {
  return {
    "threads.list": async (): Promise<ThreadSummary[]> => {
      const files = store.list(); // Pattern 1 scan — verified THREAD_ID_RE + containment
      if (files.length === 0) return [];
      // kind + name via DB join: conversation → task (card) XOR chat_session (session)
      const rows = db.query<
        { id: number; task_id: number | null; task_title: string | null; session_title: string | null;
          task_created: string | null; session_created: string | null; session_activity: string | null },
        []
      >(
        `SELECT c.id, c.task_id, t.title AS task_title, cs.title AS session_title,
                t.created_at AS task_created, cs.created_at AS session_created,
                cs.last_activity_at AS session_activity
         FROM conversations c
         LEFT JOIN tasks t        ON t.conversation_id = c.id
         LEFT JOIN chat_sessions cs ON cs.conversation_id = c.id`
      ).all();
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      return files.map((f) => {
        const row = byId.get(f.threadId);
        const kind = row && row.task_id != null ? "card" : "session";
        const name = kind === "card" ? row?.task_title : (row?.session_title ?? null);
        return {
          threadId: f.threadId,
          name: name ?? null,
          kind,
          createdAt: /* first event timestamp → task_created/session_created → birthtime */ "",
          updatedAt: /* last event timestamp → session_activity → file mtime ISO */ new Date(f.mtimeMs).toISOString(),
        };
      });
    },
  };
}
```

### Message → AG-UI event mapping (import core)

```typescript
// Source: shapes verified from event-bridge.ts (TEXT/REASONING/TOOL/RUN event forms,
// toolResult messageId convention) and stream-processor legacy writes (types + content JSON).
// Row types: ConversationMessageRow (row-types.ts:88-97). Type values: MessageType union
// (rpc-types.ts:95-108). Mapping per row.type — ORDER BY id ASC, one run per user message:
//
//   "user"       → new run: RUN_STARTED {input.messages: [{id: `legacy-${id}`, role: "user", content}]}
//   "system"     → first run's input.messages [{id, role: "system", content}]  (e.g. task-description seed)
//   "assistant"  → TEXT_MESSAGE_START (role "assistant") + CONTENT(delta=content) + END — skip empty content
//   "reasoning"  → REASONING_MESSAGE_START + CONTENT + END
//   "tool_call"  → parse content JSON {id, function:{name, arguments}} →
//                  TOOL_CALL_START {toolCallId: `${runId}-${id}`, toolCallName: name}
//                  + TOOL_CALL_ARGS {delta: arguments} + TOOL_CALL_END
//   "tool_result"→ parse content JSON {tool_use_id, content} →
//                  TOOL_CALL_RESULT {toolCallId: `${runId}-${tool_use_id}`, messageId: `${runId}-${tool_use_id}-result`, content}
//   "transition_event" | "compaction_summary" | "status" | "file_diff" | "code_review"
//   | "ask_user_prompt" | "decision_request_prompt" → SKIP (feature trim, REQUIREMENTS.md Out of Scope)
// Dangling tool_call (no tool_result before next user): synthesize empty TOOL_CALL_RESULT at
// run end (mirrors synthesizeMissingToolResults, event-bridge.ts:304-312).
// Close every open TEXT/REASONING block before the run's RUN_FINISHED {threadId, runId, result: null}.
// Optional: attach `timestamp: Date.parse(created_at.replace(" ", "T") + "Z")` to every event
// (BaseEventSchema.timestamp is optional — verified @ag-ui/core d.ts:4192) → log-derived dates.
```

### Idempotent orchestrator (import runner)

```typescript
// Contract for runLegacyImport(db, store) in src/bun/copilotkit/import.ts — pure module
// (ARCHITECTURE.md:138 proposed import.ts). Returns a summary for the RPC response.
export async function runLegacyImport(db: Database, store: JsonlStore): Promise<ImportSummary> {
  // 1. Conversations that HAVE messages (empty conversations → nothing to import).
  const convs = db.query<{ id: number }, []>(
    `SELECT DISTINCT c.id FROM conversations c
     JOIN conversation_messages m ON m.conversation_id = c.id
     WHERE m.id >= 0 ORDER BY c.id ASC` // frozen-table reads only (IMPR-02, D-08)
  ).all();
  const summary = { total: convs.length, imported: 0, skipped: 0, failed: 0, errors: [] as string[] };
  for (const conv of convs) {
    const threadId = String(conv.id);
    if (store.exists(threadId)) { summary.skipped++; continue; }   // D-07 marker (atomic write)
    const rows = db.query<ConversationMessageRow, [number]>(
      "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC"
    ).all(conv.id);
    const events = buildThreadLog(threadId, rows);                 // Pattern 3 + mapping above
    if (events.length === 0) { summary.skipped++; continue; }
    try {
      writeFileSync(threadLogPath(storeDataDir(store), threadId) + ".tmp",
                    events.map((e) => JSON.stringify(e)).join("\n") + "\n");
      renameSync(/* tmp → final */);                               // atomic — Pattern 2
      summary.imported++;
    } catch (err) { summary.failed++; summary.errors.push(`${threadId}: ${err instanceof Error ? err.message : err}`); }
  }
  return summary;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dual SQLite chat tables (`conversation_messages` + `stream_events`) with a custom streaming protocol | Per-thread JSONL AG-UI event logs (`data/threads/{id}.jsonl`), log IS the index | Phase 2 (store/runner); Phase 4 completes (list + import) | Thread = one human-readable file; index rebuilds from the log (D-05) |
| Custom `/ws` chat push + manual thread persistence | AG-UI SSE via `@copilotkit/runtime` + JSONL cold replay | Phase 1-2 | Replay = replay the log; no snapshots (RUNR-05) |
| `useThreads` (Enterprise-only thread list) | Own `threads.list` RPC scanning `data/threads/` | This phase (CHAT-08) | Self-hosted listing with DB-enriched names; mutations deferred to v2 |
| Runtime local `GET /threads` (in-memory listThreads) | Runtime endpoint stays for client compat, but Railyin's RPC is authoritative | Phase 1 discovery → this phase | Restart-safe listing; runtime endpoint returns `[]` on a fresh process (verified) |
| `on_interrupt` custom event | `RUN_FINISHED` interrupt outcome + JSONL-persisted interrupt metadata | Phase 3 | Import need NOT synthesize interrupts — legacy decisions stay in DB (see Assumptions A6) |

**Deprecated/outdated:**
- `threads/events/:threadId` runtime route shape — PROJECT.md:109 documents the researched shape 404s; `GET /threads/:threadId/events` is the live one. Not needed this phase (Phase 5 connect handles history).
- Legacy interrupt mechanics (`on_interrupt`, `forwarded_props.command.resume`) — rejected by the bridge (STACK.md:76); do not emit them in imported logs.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `appendFileSync` single-line writes are effectively atomic for process-level crashes (no fsync; power-loss durability NOT claimed) | Crash tolerance | Kill -9 mid-append leaves a partial trailing line — tolerant reader already skips it; only power-loss could corrupt mid-line (accepted, single-user local app) |
| A2 | `tasks.title` is the right display name for card threads (fallback null when empty) | threads.list | Wrong label in Phase 5 list — cosmetic; fallback `Task #${id}` is the planner's call |
| A3 | `Date.parse(created_at.replace(" ", "T") + "Z")` correctly parses all legacy `datetime('now')` strings | Import timestamps | All legacy rows use the same SQLite default format (verified in three migrations); drift impossible in practice |
| A4 | Imported multi-run logs render correctly in the pinned `@copilotkit/vue@1.66.4` client | Import log shape | The base runner's multi-run replay is e2e-proven (02-02 D3/D5); import emits the same shape — residual risk only in client-side message grouping, proven in Phase 5 |
| A5 | `conversation_messages` contains the complete finalized history; `stream_events` adds only chunk-level/execution detail (persisted subset duplicates messages) | Import data source | If some conversations have events ONLY in `stream_events` (none found — writes verified paired), v1 import would miss content; planner may add a stream_events pass (discretion) |
| A6 | Legacy `decision_records`/`ask_user_prompt`/`transition_event` etc. are safe to drop from import (feature trim + decisions live in JSONL interrupts on the new stack) | Import mapping | Old decisions stay readable in frozen DB; no AG-UI equivalent per REQUIREMENTS.md Out of Scope |
| A7 | Import RPC's lack of an origin gate (same as all RPC methods) is acceptable — import is idempotent and local-only | Security | A cross-origin POST could trigger a re-import (no-op after first run); no data loss, no engine execution — matches existing app posture |

## Open Questions

1. **Run grouping granularity for import**
   - What we know: `conversation_messages` has no `execution_id`; `stream_events` does. New-stack logs group per user turn. Grouping per user-message preserves ordering and matches the runner's shape.
   - What's unclear: whether per-execution grouping (via `stream_events.execution_id`) adds value beyond per-user-message grouping (execution boundaries occasionally split one turn across retries).
   - Recommendation: per-user-message grouping for v1 (single source, exact ordering); document `stream_events` as optional enrichment.

2. **Name source: DB join vs sidecar `{threadId}.meta.json` (D-03)**
   - What we know: D-03 permits an optional sidecar; the endpoint handler already has `db`; names live in `tasks.title`/`chat_sessions.title`.
   - What's unclear: whether file self-containment (sidecar) is wanted for future features (rename) — rename/archive/delete are v2 anyway.
   - Recommendation: DB join only for v1 (no sidecar); sidecar becomes necessary only when mutations land in v2.

3. **Paged vs single-shot import**
   - What we know: local single-user app; tens of conversations; import is fast (SQLite read + file write).
   - What's unclear: nothing material.
   - Recommendation: single-shot `legacyImport.run` returning `{total, imported, skipped, failed, errors}` — progress reporting can be added in Phase 7 if needed (discretion item, CONTEXT.md).

4. **Should `threads.list` exclude archived sessions?**
   - What we know: `chat_sessions.status='archived'` exists; archive UI is v2.
   - Recommendation: return all threads in v1 (files don't know status); Phase 5 filters if desired.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bun runtime | All code + tests | ✓ | 1.4.0 | — |
| node (fs APIs via bun) | File ops | ✓ | v20.20.1 | — |
| `bun:sqlite` | Import reads, name joins | ✓ | bundled | — |
| `@ag-ui/core` / `@ag-ui/client` | EventType, replay | ✓ | 0.0.57 (pinned) | — |
| `@copilotkit/runtime` | compactEvents/finalizeRunEvents | ✓ | 1.66.4 (pinned) | — |
| Data dir `~/.railyn` (or `RAILYN_DATA_DIR`) | `data/threads/` | ✓ (auto-created by `append`) | — | env override |
| SQLite file DB | Legacy tables | ✓ (`bun run prod` default; `--real-db` for dev) | — | `RAILYN_DB=:memory:` for tests |

**Missing dependencies with no fallback:** none. Step 2.6: no external tools/services beyond the project's own runtime — no installs, no network, no servers.

## Validation Architecture

`workflow.nyquist_validation: true` (config.json) — section required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest via `bun test` (bun 1.4.0) |
| Config file | `vitest.config.ts` (aliases `@`/`@shared`/`@bun` per AGENTS.md) |
| Quick run command | `bun test src/bun/copilotkit/import.test.ts -x` (single new file) |
| Full suite command | `bun test src/bun --timeout 20000` (+ `bun run typecheck`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHAT-08 | `threads.list` returns every thread (card + session) with name/kind/timestamps; skips `.tmp`/non-numeric files; empty dir → `[]` | unit | `bun test src/bun/copilotkit/jsonl-store.test.ts -x` (list()) + handler test via `src/bun/test/handlers.test.ts` pattern | ❌ Wave 0 — extend jsonl-store.test.ts + new handler tests |
| CHAT-08 | Name/kind derivation from DB join; timestamp fallbacks | unit | handler test with seeded temp DB (`helpers.ts` makeTempDir + `RAILYN_DB=:memory:`) | ❌ Wave 0 |
| IMPR-01 | Message→event mapping per type (user/assistant/reasoning/tool_call/tool_result/system) incl. empty-content skip, dangling-tool synthesis, run boundaries | unit | `bun test src/bun/copilotkit/import.test.ts -x` | ❌ Wave 0 |
| IMPR-01 | Idempotency: second run imports 0, skips all; atomic write leaves no `.tmp` residue | unit | same file | ❌ Wave 0 |
| IMPR-01/02 | Import RPC end-to-end on a seeded legacy DB; frozen tables unchanged (row counts identical); replay of imported log via cold connect | e2e | `bun test e2e/api/copilotkit/legacy-import.test.ts --timeout 30000` (uses `startServer({ dataDir, dbPath })` fixture — restart replay precedent from 02-02 D5) | ❌ Wave 0 |
| CHAT-08 | `list()` tolerant of corrupt dir entries (skip not throw) | unit | jsonl-store.test.ts addition | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted new test file (`bun test src/bun/copilotkit/<new>.test.ts -x`)
- **Per wave merge:** `bun test src/bun --timeout 20000` + `bun test e2e/api --timeout 30000` + `bun run typecheck`
- **Phase gate:** full backend + API suites green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/bun/copilotkit/import.test.ts` — mapping/grouping/idempotency/atomicity unit tests (new file, created in phase)
- [ ] `src/bun/copilotkit/jsonl-store.test.ts` — add `list()` cases (scan, filter, sort, missing dir, `.tmp` exclusion)
- [ ] Handler tests for `threads.list` + `legacyImport.run` — follow `src/bun/test/handlers.test.ts` conventions (temp DB, `helpers.ts:265 makeTempDir`, `RAILYN_DB=:memory:`)
- [ ] `e2e/api/copilotkit/legacy-import.test.ts` — seeded legacy DB → import → cold replay (optional but recommended; the 02-02 restart-replay fixture pattern exists)
- Framework install: none — vitest/bun test already present.

## Security Domain

`security_enforcement: true` (config.json) — section required. ASVS level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local single-user app; no auth layer (existing posture, unchanged) |
| V3 Session Management | no | No sessions (SSE/RPC without cookies) |
| V4 Access Control | partial | Existing `/api/*` RPC router has no origin gate (only `/api/copilotkit/*` has WR-03) — import RPC is idempotent + read-only w.r.t. legacy data, so a forged POST is a no-op after first run; documented in A7 |
| V5 Input Validation | yes | Params validated at handler level (existing manual pattern, e.g. `conversations.ts:29`); import rows are DB-sourced (trusted) but tool-call JSON parsing is defensive (skip-don't-crash, WR-05 precedent) |
| V6 Cryptography | no | No secrets, no crypto |
| V8 Path Traversal | yes | `JsonlStore.assertThreadId` (THREAD_ID_RE `^\d+$` + resolved-path containment, jsonl-store.ts:38-47) applies to every new method incl. `list()`/import writes; `list()` filters readdir entries through the same regex |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via threadId in import/listing | Tampering | Reuse `assertThreadId` for all store methods; `list()` regex-filters dir entries before use (never string-interpolate a raw filename into a path) |
| Malformed legacy JSON (tool_call/tool_result content) breaking import | DoS (crash) | Defensive `JSON.parse` + shape checks; skip + count, never throw out of the per-conversation loop |
| Cross-origin POST to `legacyImport.run` | Spoofing | Idempotency makes re-runs no-ops; import never touches engines or executes code (lowest-impact RPC in the app); accept existing posture, revisit with app-wide auth (out of scope) |
| SQL injection via RPC params | Tampering | Parameterized queries only (repo pattern); no string-built SQL with user input |

## Sources

### Primary (HIGH confidence — read this session)
- **In-repo source of truth (quoted verbatim in this file):**
  - `src/bun/copilotkit/jsonl-store.ts:23-92` — `THREAD_ID_RE`, `threadLogPath`, `append/read/exists/endRun`, tolerant reader
  - `src/bun/copilotkit/railyin-runner.ts:103-190` — runner overrides, cold replay pipeline, store injection
  - `src/bun/copilotkit/event-bridge.ts:64-72,120-312,318-378` — TEXT/REASONING/TOOL event shapes, `toolResult` messageId convention, terminal events, interrupt outcome
  - `src/bun/copilotkit/interrupt-registry.ts:67-127` — JSONL-tail rebuild precedent (log-as-state reading)
  - `src/bun/db/migrations/001_initial.ts:38-97`, `018_stream_events.ts:6-22`, `026_chat_sessions.ts:24-113`, `035_add_model_to_conversations.ts:6-8`, `040_decision_records.ts:6-43` — legacy schemas
  - `src/bun/db/row-types.ts:14-21,88-97,130-146` — ConversationRow / ConversationMessageRow / ChatSessionRow
  - `src/bun/db/stream-events.ts:3-15` — PersistedStreamEvent + write paths (paired with messages writes)
  - `src/bun/server/stream-processor.ts:14-16,30-59` — persisted stream_events type subset
  - `src/bun/engine/stream/stream-processor.ts:250-349` — tool_call/tool_result content JSON + metadata shapes
  - `src/shared/rpc-types.ts:95-108,433-442,594-627,635+` — MessageType union, ConversationMessage, StreamEventType, RailynAPI map
  - `src/bun/handlers/conversations.ts:13-109`, `src/bun/handlers/chat-sessions.ts:21-73` — handler pattern + session/conv creation
  - `src/bun/index.ts:292-343,414-437` — composition root (`new JsonlStore(getDataDir())`), allHandlers registration, RPC router
  - `src/bun/utils/platform.ts:16-18` — `getDataDir()` = `RAILYN_DATA_DIR` ?? `~/.railyn`
  - `src/bun/conversation/messages.ts:4-19` — `appendMessage` insert shape
  - `src/bun/db/mappers.ts:62-81` — `mapConversationMessage`
  - `e2e/api/copilotkit/railyin.test.ts:247-263,417-422` — persisted log shape (RUN_STARTED-with-input first, RUN_FINISHED last)
  - `.planning/phases/02-ag-ui-bridge-railyinagentrunner/02-02-SUMMARY.md:43-53,116-119` — store API, replay shapes, durability proof
- **Installed packages (authoritative for pinned versions):**
  - `node_modules/@copilotkit/runtime/dist/v2/runtime/runner/in-memory.mjs:237-285` — `listThreads()` in-memory-only; `ɵsupportsLocalThreadEndpoints = true` in constructor
  - `node_modules/@copilotkit/runtime/dist/v2/runtime/handlers/intelligence/threads.mjs:63-71` — local GET /threads → `{threads, nextCursor: null}`
  - `node_modules/@copilotkit/runtime/dist/v2/runtime/handlers/get-runtime-info.mjs:67-82` — threadEndpoints resolution
  - `node_modules/@ag-ui/core/dist/index.d.ts:4142-4182` — EventType enum; `:2305+` RunAgentInputSchema (messages shape); `:4192` BaseEventSchema (`timestamp` optional)

### Secondary (MEDIUM confidence — cross-checked)
- Context7 `/copilotkit/copilotkit` — InMemoryAgentRunner subclass extension pattern; GET /threads durable-list docs
- Context7 `/ag-ui-protocol/ag-ui` — run lifecycle ordering (RUN_STARTED → … → RUN_FINISHED; TEXT/TOOL/REASONING block ordering)
- `.planning/research/STACK.md:52-71` — own-endpoint rationale, `useThreads` non-viability
- `.planning/research/ARCHITECTURE.md:118-124,136-138` — thread persistence contract, index-from-log, `import.ts` placement
- `.planning/research/PITFALLS.md:9-40` — connect-before-run, verifyEvents replay rejection
- `.planning/PROJECT.md:109-155` — Phase 1 verbatim `/info` + `GET /threads` captures (matches node_modules verification)
- `.planning/REQUIREMENTS.md:47-49,116,132-133` — CHAT-08/IMPR-01/IMPR-02 + traceability

### Tertiary (LOW confidence — none used for decisions)
- None — every claim above was verified against in-repo source or installed packages this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages; all tools verified present (bun 1.4.0, node v20.20.1) and pinned deps read from node_modules
- Architecture: HIGH — store API, handler pattern, RPC router, legacy schemas, event shapes all read from source this session; design mirrors proven Phase 2/3 patterns
- Pitfalls: MEDIUM — crash-atomicity and client-rendering behaviors (A1, A4) are reasoned from OS semantics + proven replay tests, not directly re-tested this session

**Research date:** 2026-08-09
**Valid until:** 2026-08-23 (30 days — pinned deps, stable in-repo contracts)

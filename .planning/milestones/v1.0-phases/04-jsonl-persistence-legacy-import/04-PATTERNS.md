# Phase 4: JSONL Persistence & Legacy Import - Pattern Map

**Mapped:** 2026-08-09
**Files analyzed:** 10 (4 new, 6 modified)
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/bun/copilotkit/jsonl-store.ts` (MODIFY) | store (file module) | file-I/O (append + scan) | itself (`src/bun/copilotkit/jsonl-store.ts`) — add `list()` to existing class | exact |
| `src/bun/copilotkit/import.ts` (NEW) | service (pure transform + file write) | transform + file-I/O | `src/bun/copilotkit/event-bridge.ts` (exhaustive type→event dispatch, tool synthesis) + `railyin-runner.ts` (run shapes) | role-match |
| `src/bun/handlers/threads.ts` (NEW) | controller | request-response | `src/bun/handlers/conversations.ts` (handler factory + DB join queries) | exact |
| `src/bun/handlers/legacy-import.ts` (NEW) | controller | request-response | `src/bun/handlers/conversations.ts` (delegates to module fn like `getStreamEventsByConversation`) | exact |
| `src/shared/rpc-types.ts` (MODIFY) | contract | type contract | existing `RailynAPI` entries (`chatSessions.list`, rpc-types.ts:1036-1039) | exact |
| `src/bun/index.ts` (MODIFY) | config (composition root) | request-response | `allHandlers` spread block (index.ts:317-343) + RPC router (414-437) | exact |
| `src/bun/copilotkit/import.test.ts` (NEW) | test (unit) | CRUD | `src/bun/copilotkit/jsonl-store.test.ts` structure + `src/bun/test/helpers.ts` `initDb`/`makeTempDir` | exact |
| `src/bun/copilotkit/jsonl-store.test.ts` (MODIFY) | test (unit) | file-I/O | itself (extend existing `describe("JsonlStore")` block) | exact |
| Handler tests for `threads.list`/`legacyImport.run` (NEW) | test (unit) | request-response | `src/bun/test/handlers.test.ts` (initDb + setupTestConfig + direct handler invocation) | exact |
| `e2e/api/copilotkit/legacy-import.test.ts` (NEW, optional) | test (e2e) | request-response | `e2e/api/copilotkit/railyin.test.ts` + `e2e/api/fixtures/server.ts` `startServer({dataDir, durableDb})` | exact |

## Pattern Assignments

### `src/bun/copilotkit/jsonl-store.ts` (MODIFY — add `list()`; keep tolerant read/append)

**Analog:** itself (the Phase 2 store — hardening target per D-04/D-05). No new imports needed beyond `readdirSync`, `statSync` (same `"fs"` import line already has `appendFileSync, existsSync, mkdirSync, readFileSync`).

**Module conventions** (lines 18-28):
```typescript
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import type { BaseEvent } from "@ag-ui/client";

/** conversations.id is INTEGER AUTOINCREMENT — threadIds are decimal strings. */
const THREAD_ID_RE = /^\d+$/;

/** `join(dataDir, "threads", `${threadId}.jsonl`)` — the per-thread log path. */
export function threadLogPath(dataDir: string, threadId: string): string {
  return join(dataDir, "threads", `${threadId}.jsonl`);
}
```

**Security gate — reuse `assertThreadId` in every new method** (lines 38-47):
```typescript
private assertThreadId(threadId: string): void {
  if (!THREAD_ID_RE.test(threadId)) {
    throw new Error(`Invalid threadId: ${threadId}`);
  }
  const threadsDir = resolve(join(this.dataDir, "threads"));
  const resolved = resolve(threadLogPath(this.dataDir, threadId));
  if (!resolved.startsWith(threadsDir + sep)) {
    throw new Error(`Invalid threadId: ${threadId}`);
  }
}
```

**Tolerant reader — the crash-tolerance precedent to preserve** (lines 63-78): `read()` returns `null` when absent, skips malformed/partial lines with `console.warn` — never throws out of the loop. `list()` must apply the same skip-don't-crash discipline to non-conforming dir entries (research Pattern 1 — filter by `THREAD_ID_RE.test(name.slice(0, -6))` + `.endsWith(".jsonl")`, skip `.tmp`, `statSync` for `mtimeMs`/`size`, sort by `mtimeMs` desc).

**Idempotency hook — `exists()`** (lines 80-83): `return existsSync(threadLogPath(this.dataDir, threadId))` — this IS the D-07 marker for import.

**Doc convention:** the header comment block (lines 1-17) states the phase scope; update it (Phase 4 scope: crash tolerance + index rebuild) to match.

### `src/bun/copilotkit/import.ts` (NEW — `buildThreadLog(threadId, rows)` + `runLegacyImport(db, store)`)

**Analog:** `src/bun/copilotkit/event-bridge.ts` (pure mapping module, `translateEngineEvent` exhaustive dispatch) + `railyin-runner.ts` (run boundary shapes, tool-call synthesis).

**Imports pattern** (mirror event-bridge.ts:1-30 style — @ag-ui types, no fs/DB unless needed):
```typescript
import { EventType } from "@ag-ui/core";
import type { BaseEvent } from "@ag-ui/client";
import type { Database } from "bun:sqlite";
import { writeFileSync, renameSync } from "fs";
import type { ConversationMessageRow } from "../db/row-types.ts";   // row-types.ts:88-97
import { threadLogPath, type JsonlStore } from "./jsonl-store.ts";
```

**Mapping precedent — `translateEngineEvent` switch** (event-bridge.ts:113-291): the exhaustive `switch (event.type)` dispatch with per-type event emission is the direct model for `buildThreadLog`'s `switch (row.type)`. Key shapes to reproduce:

- **Tool result messageId convention** (event-bridge.ts:63-72): `TOOL_CALL_RESULT` MUST carry `messageId: \`${toolCallId}-result\``, `role: "tool"`.
- **Text block lifecycle** (event-bridge.ts:120-131): `TEXT_MESSAGE_START {messageId, role:"assistant"}` → `TEXT_MESSAGE_CONTENT {messageId, delta}` → `TEXT_MESSAGE_END {messageId}` — every opened block closed before the terminal (Pitfall 6).
- **Tool call trio** (event-bridge.ts:172-181): `TOOL_CALL_START {toolCallId, toolCallName}` + `TOOL_CALL_ARGS {toolCallId, delta}` + `TOOL_CALL_END {toolCallId}`.
- **Reasoning block** (event-bridge.ts:143-156): `REASONING_MESSAGE_START {messageId, role:"reasoning"}` + `_CONTENT` + `_END`.
- **Dangling tool synthesis** (event-bridge.ts:304-312 `synthesizeMissingToolResults`; runner-side `completeOpenToolCalls` railyin-runner.ts:46-101): synthesize empty `TOOL_CALL_RESULT` (`content: ""`) for open calls before the terminal — research mandates the same at import run end.

**Run boundary shape** (from railyin-runner.ts cold-replay expectations + e2e railyin.test.ts:247-265): each run = `RUN_STARTED {threadId, runId, input: {threadId, runId, state: null, messages: [{id, role, content}]}}` FIRST, `RUN_FINISHED {threadId, runId, result: null}` LAST. runId = `import-${conversationId}-${n}` (Pitfall 4 namespacing: `${runId}-${callId}` for every imported toolCallId).

**DB read pattern** (from conversations.ts:23-25 / stream-events.ts:39-54):
```typescript
const convs = db.query<{ id: number }, []>(
  `SELECT DISTINCT c.id FROM conversations c
   JOIN conversation_messages m ON m.conversation_id = c.id
   WHERE m.id >= 0 ORDER BY c.id ASC` // frozen-table reads only (D-08)
).all();
```
`ConversationMessageRow` (row-types.ts:88-97) — `type` values are the `MessageType` union (rpc-types.ts:95-108). Query rows `ORDER BY id ASC`.

**Timestamp normalization (Pitfall 1):** `Date.parse(created_at.replace(" ", "T") + "Z")` — SQLite `datetime('now')` is naive UTC.

**Defensive JSON parsing** (from `mapConversationMessage`, mappers.ts:62-70): wrap `JSON.parse` of `content`/`metadata` in try/catch — skip + count malformed tool-call rows, never crash the loop.

**Atomic write — research Pattern 2** (no in-repo precedent; standard `node:fs`):
```typescript
const tmpPath = threadLogPath(dataDir, threadId) + ".tmp";
writeFileSync(tmpPath, lines.join("\n") + "\n", "utf-8");
renameSync(tmpPath, threadLogPath(dataDir, threadId)); // atomic on POSIX
```
Must route threadId through the store's `assertThreadId` rules (THREAD_ID_RE). Return an `ImportSummary` (`{total, imported, skipped, failed, errors}`) per research.

### `src/bun/handlers/threads.ts` (NEW — `threadHandlers(db, store)`)

**Analog:** `src/bun/handlers/conversations.ts` — exact factory shape.

**Factory + registration shape** (conversations.ts:1-14):
```typescript
import type { Database } from "bun:sqlite";
import type { ThreadSummary } from "../../shared/rpc-types.ts";
import type { JsonlStore } from "../copilotkit/jsonl-store.ts";

export function threadHandlers(db: Database, store: JsonlStore) {
  return {
    "threads.list": async (): Promise<ThreadSummary[]> => {
      // ...
    },
  };
}
```

**DB join enrichment pattern** (conversations.ts:60-74 — `LEFT JOIN` chains; chat-sessions.ts:25-41 — `LEFT JOIN conversations` + typed row interface):
```typescript
const rows = db.query<{ id: number; task_id: number | null; task_title: string | null; ... }, []>(
  `SELECT c.id, c.task_id, t.title AS task_title, cs.title AS session_title,
          t.created_at AS task_created, cs.created_at AS session_created,
          cs.last_activity_at AS session_activity
   FROM conversations c
   LEFT JOIN tasks t        ON t.conversation_id = c.id
   LEFT JOIN chat_sessions cs ON cs.conversation_id = c.id`
).all();
```
**Pitfall 2 warning:** `conversations` has NO `created_at` — derive from event `timestamp` → `tasks.created_at`/`chat_sessions.created_at` → file mtime (`new Date(f.mtimeMs).toISOString()`).

**Handler-level validation** (conversations.ts:26-29): `throw new Error(...)` for missing params — the router converts to 500 `{error}` (index.ts:429-436).

### `src/bun/handlers/legacy-import.ts` (NEW — `legacyImportHandlers(db, store)`)

**Analog:** `src/bun/handlers/conversations.ts` — handler delegates to a module function (exactly like `"conversations.getStreamEvents"` → `getStreamEventsByConversation(db, ...)` at conversations.ts:50-55):
```typescript
"legacyImport.run": async (): Promise<ImportSummary> => {
  return runLegacyImport(db, store);
},
```

### `src/shared/rpc-types.ts` (MODIFY — add `ThreadSummary` interface + 2 `RailynAPI` entries)

**Analog:** existing `chatSessions.list` entry (rpc-types.ts:1036-1039) — exact entry format:
```typescript
// Chat sessions (workspace-scoped, not tied to a task)
"chatSessions.list": {
  params: { workspaceKey?: string; includeArchived?: boolean };
  response: ChatSession[];
};
```
New entries follow the same `"method": { params, response }` shape inside the `RailynAPI` map (opened at line 635). The `ThreadSummary` interface belongs with the other response interfaces above the map (MessageType at rpc-types.ts:95-108 is the precedent for the union `kind: "card" | "session"`).

### `src/bun/index.ts` (MODIFY — register both handler sets)

**Analog:** the `allHandlers` object literal (index.ts:317-343). Add two spreads, with the store already in scope at line 292 (`const jsonlStore = new JsonlStore(getDataDir());`):
```typescript
...conversationHandlers(db, orchestrator, modelSettingsRepo),      // line 327
...chatSessionHandlers(db, notifier.notifyChatSessionUpdated.bind(notifier), orchestrator), // line 339
// NEW:
...threadHandlers(db, jsonlStore),
...legacyImportHandlers(db, jsonlStore),
```
The router (index.ts:414-437) needs NO change: `POST /api/threads.list` → `allHandlers["threads.list"]` → try/catch → JSON response. Cast stays `} as Record<string, (params: unknown) => unknown>`.

### Tests

### `src/bun/copilotkit/jsonl-store.test.ts` (MODIFY — `list()` cases)

**Analog:** itself — extend the existing `describe("JsonlStore")` block (jsonl-store.test.ts:37-93). Conventions: `bun:test` (`describe/test/expect/beforeEach/afterEach`), local `makeTempDir()` (lines 16-19, `mkdtempSync(join(tmpdir(), "railyn-test-"))`), fresh `JsonlStore(tmp.dir)` per test (lines 28-35). Write decoy files (`writeFileSync` — already imported line 9) for scan/filter cases: `{id}.jsonl`, `{id}.jsonl.tmp`, `{id}.meta.json`, non-numeric `abc.jsonl`. The traversal-rejection test (lines 63-73) shows the `assertThreadId` assertion style — `list()` must not throw on decoys.

### `src/bun/copilotkit/import.test.ts` (NEW)

**Analog:** `jsonl-store.test.ts` (temp-dir + bun:test structure) + `helpers.ts` `initDb()` for the seeded legacy DB:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { initDb, makeTempDir } from "../test/helpers.ts";   // helpers.ts:10-15, 265-268
import { JsonlStore } from "./jsonl-store.ts";
import { buildThreadLog, runLegacyImport } from "./import.ts";
```
Seed legacy rows with `db.run("INSERT INTO conversation_messages ...")` per the `conversation_messages` schema (helpers.ts:82-91: `id, task_id, conversation_id, type, role, content, metadata, created_at`). Idempotency test = run `runLegacyImport` twice, assert `imported: 0, skipped: N` on the second run + no `.tmp` residue. Use the fixed timestamp string `"2026-08-09 08:00:00"` to pin Pitfall 1's `Date.parse(created_at.replace(" ", "T") + "Z")` conversion.

### Handler tests for `threads.list` / `legacyImport.run` (NEW)

**Analog:** `src/bun/test/handlers.test.ts` conventions (lines 1-66): `vitest` (`describe/it/expect/beforeEach/afterEach`), `db = initDb()` (line 49), `setupTestConfig()` for config (line 59, cleanup in afterEach), then invoke handler factories directly:
```typescript
const handlers = threadHandlers(db, new JsonlStore(tmp.dir));
const threads = await handlers["threads.list"]();
```
Seed with `seedProjectAndTask(db, gitDir)` (helpers.ts:272-293 — card with `tasks.title`) and `seedChatSession(db)` (helpers.ts:409-434 — session with `chat_sessions.title`). For the import handler: seed `conversation_messages` rows, call `legacyImportHandlers(db, store)["legacyImport.run"]()`, assert summary + JSONL file contents on disk (`readFileSync(threadLogPath(...))`).

### `e2e/api/copilotkit/legacy-import.test.ts` (NEW, optional)

**Analog:** `e2e/api/copilotkit/railyin.test.ts` — full structure to copy: `bun:test` + `startServer` fixture (railyin.test.ts:13-31), `postJson`/`parseSseFrames` helpers (lines 34-57), typed RPC via `server.request()` (fixture server.ts:284-299). **Restart-replay fixture** — the exact precedent for "import on server A, verify replay on server B":
```typescript
// e2e/api/fixtures/server.ts:47-57, 170-183 — durable dataDir + durable DB
const dataDir = mkdtempSync(join(tmpdir(), "railyn-e2e-"));
const serverA = await startServer({ dataDir, durableDb: true });
const serverB = await startServer({ dataDir, durableDb: true }); // same dataDir — survives shutdown
```
Durability assertions follow railyin.test.ts:256-264 (`join(server.dataDir, "threads", \`${threadId}.jsonl\`)`, parse lines, first = RUN_STARTED with input, last = RUN_FINISHED). Frozen-table check: count rows in `conversation_messages` before/after import via a raw `db` handle or `server.request("conversations.getMessages")` count.

## Shared Patterns

### Handler factory pattern
**Source:** `src/bun/handlers/conversations.ts:13-14`
**Apply to:** `threads.ts`, `legacy-import.ts` — and their RailynAPI registrations
```typescript
export function conversationHandlers(db: Database, orchestrator: ExecutionCoordinator | null, modelSettingsRepo?: ModelSettingsRepository) {
  return {
    "conversations.getMessages": async (params: {...}): Promise<...> => { ... },
    ...
  };
}
```

### RPC contract + router (no router changes needed)
**Source:** `src/shared/rpc-types.ts:632-639` + `src/bun/index.ts:414-437`
**Apply to:** both new methods
```typescript
// rpc-types.ts — map entry format (see chatSessions.list at 1036-1039)
export type RailynAPI = {
  "method.name": { params: ...; response: ... };
}
```
Router behavior: unknown method → 404 `{error}`; handler throw → 500 `{error: msg}` (index.ts:417-436). Handlers never return error responses themselves — they throw and let the router format.

### Tolerant read / skip-don't-crash
**Source:** `src/bun/copilotkit/jsonl-store.ts:69-76`; `src/bun/db/mappers.ts:62-70` (defensive JSON.parse)
**Apply to:** `list()` scan, `buildThreadLog` (malformed tool-call JSON), per-conversation import loop
```typescript
try {
  events.push(JSON.parse(line) as BaseEvent);
} catch {
  console.warn(`[jsonl-store] Skipping malformed line in ${filePath}`);
}
```

### Path security (V8) — `assertThreadId` + THREAD_ID_RE
**Source:** `src/bun/copilotkit/jsonl-store.ts:23, 38-47`
**Apply to:** every store method incl. new `list()` (regex-filter dir entries), import writes (route through `threadLogPath` + the same regex), `threads.list` handler (threadIds come from the store scan — already validated)

### Run lifecycle shapes (import must satisfy replay)
**Source:** `src/bun/copilotkit/event-bridge.ts:63-72` (toolResult messageId), `:304-312` (dangling-tool synthesis); `src/bun/copilotkit/railyin-runner.ts:46-101, 158-174` (cold replay: truncate at RUN_ERROR → `finalizeRunEvents` → `completeOpenToolCalls` → `compactEvents`)
**Apply to:** `import.ts` event synthesis — RUN_STARTED-with-input first, RUN_FINISHED `result: null` last, every TEXT/REASONING/TOOL block closed, per-run namespaced toolCallIds (`${runId}-${callId}`)

### Store injection at composition root
**Source:** `src/bun/index.ts:292-299` (`new JsonlStore(getDataDir())` → runner + `interruptRegistry.configure({store})`); `src/bun/copilotkit/interrupt-registry.ts:49-51` (configure pattern)
**Apply to:** `index.ts` — pass `jsonlStore` into `threadHandlers(db, jsonlStore)` / `legacyImportHandlers(db, jsonlStore)`

### Test fixtures
**Source:** `src/bun/test/helpers.ts:10-15, 265-268, 272-293, 409-434`; `src/bun/copilotkit/jsonl-store.test.ts:16-35`; `e2e/api/fixtures/server.ts:47-57, 284-299`
**Apply to:** all new tests
```typescript
export function initDb(): Database {           // helpers.ts:10 — RAILYN_DB=:memory: + resetDbSingleton
  process.env.RAILYN_DB = ":memory:";
  resetDbSingleton();
  const db = getDb();
  db.exec("PRAGMA foreign_keys = ON;");
  ...
}
export function makeTempDir(): { dir: string; cleanup: () => void } {  // helpers.ts:265
  const dir = mkdtempSync(join(tmpdir(), "railyn-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All 10 files map to existing in-repo analogs; the only genuinely novel construct is the atomic tmp+rename write (research Pattern 2), which is a 2-line standard `node:fs` idiom — the planner should take it from research, not invent a wrapper |

## Metadata

**Analog search scope:** `src/bun/copilotkit/`, `src/bun/handlers/`, `src/bun/db/` (`repositories/`, `stream-events.ts`, `mappers.ts`, `row-types.ts`), `src/bun/test/` (`helpers.ts`, `handlers.test.ts`), `src/bun/index.ts`, `src/shared/rpc-types.ts`, `e2e/api/` (`copilotkit/railyin.test.ts`, `fixtures/server.ts`)
**Files scanned:** ~30 (10 read in full or targeted sections)
**Pattern extraction date:** 2026-08-09

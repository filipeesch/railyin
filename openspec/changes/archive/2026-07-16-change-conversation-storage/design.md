## Context

The Railyin Bun backend uses a single SQLite database in WAL mode (`~/.railyn/railyn.db`). WAL allows unlimited concurrent readers but only one writer at a time. Three tables account for almost all write volume during active AI sessions:

- `conversation_messages` — durable, business-critical turn history. Read on nearly every AI turn (compaction, context estimation, cross-engine context injection, decision injection), on every chat pagination request, and by the session-memory extractor. This is the one table that's actually fed back to the LLM and rendered as chat history.
- `stream_events` — fine-grained, block-level live-stream deltas (block_id/seq/parent_block_id/subagent_id), 4h retention. Investigation (see below) confirmed its only intended read path — `conversations.getStreamEvents`, used for WS reconnect-replay — has **no live caller anywhere in the current frontend** (`src/mainview`). It is dead weight: written on every stream event, read by nobody except tests/mocks.
- `model_raw_messages` — raw wire-protocol capture, 1-day retention, written for every non-delta engine event. Read only by humans running manual SQL for forensic debugging (see `.claude/rules/investigate.md`). Never read by running application code.

Prior work (`2026-04-29-db-write-performance`) already introduced batching (`ConvMessageBuffer`, `WriteBuffer<T>`) and a `RetentionJob` to reduce write amplification, but the fundamental bottleneck — everything sharing one SQLite writer lock — remains.

There is existing precedent for per-user file storage in this codebase: `getDataDir()` resolves to `~/.railyn` (or `$RAILYN_DATA_DIR`), used today for logs and MCP config. A second, inconsistent convention (`~/.config/railyn/tasks/<id>/session-notes.md`, in `session-memory.ts`) also exists and is corrected as a side effect of this change.

## Goals / Non-Goals

**Goals:**
- Move durable conversation message history out of the shared SQLite file into per-conversation files under `~/.railyn/conversations/`.
- Eliminate `stream_events` entirely (confirmed dead read path) rather than merely relocating it.
- Relocate `model_raw_messages` to a file-based debug log, preserving its sole purpose (manual forensic inspection).
- Preserve exact behavior of every existing read pattern against `conversation_messages` (point lookup, compaction-anchor lookup, range-from-anchor, reverse pagination, full/filtered scan) without introducing O(n) file scans on hot paths.
- Ensure conversation/debug files are deleted when their owning task or archived chat session is deleted.
- Isolate the file-vs-legacy-SQLite branching behind one seam (`ConversationMessageStore`) rather than spreading it across ~10 call sites.

**Non-Goals:**
- Backfilling/migrating existing `conversation_messages` rows into files. Old conversations remain served read-only from SQLite indefinitely.
- Building new reconnect-replay UX. `stream_events` is being removed, not reimplemented on a new medium.
- Changing the live per-token streaming path (`StreamProcessor.onStreamEvent` → WS broadcast). It is already in-memory and zero-latency; this change does not touch it.
- Multi-process / multi-writer support for the new file store. Railyin runs as a single Bun process per data dir, same assumption SQLite WAL already relies on.
- Frontend API/contract changes for `conversations.getMessages`, `chatSessions.getMessages`, or `onNewMessage` — these keep their existing shape; only the backing store changes.

## Decisions

### D1: Per-conversation JSONL file, no SQLite presence for message content

Each conversation's durable message history is stored as an append-only `.jsonl` file at `~/.railyn/conversations/<conversationId>.jsonl` — one JSON object per line, no `conversation_messages`-shaped table involved for new conversations.

**Alternatives considered:**
- *Per-conversation SQLite file* (each conversation gets its own `.sqlite` file): would have preserved all existing SQL query code almost unchanged, but doesn't fully satisfy "move the real conversation to filestore" and still carries SQLite's connection/handle-lifecycle overhead per conversation.
- *Hybrid: SQLite index + JSONL content*: keeps a thin `conversation_messages`-shaped index table in the shared DB (id, conversation_id, type, byte offset) while content lives in JSONL. Rejected — two storage systems to keep in sync on every write/delete, and the shared DB still takes one row per message, only partially solving the write-volume problem.

**Rationale**: purest interpretation of the ask, and combined with the sidecar index (D2) it doesn't sacrifice query performance.

### D2: Sidecar `.meta.json` index per conversation for hot queries

Alongside `<conversationId>.jsonl`, maintain `<conversationId>.meta.json` with `{ lineCount, lastCompactionSummaryId, lastCompactionSummaryByteOffset, byteLength }`, updated atomically (temp file + rename — the same pattern already used by `writeSessionMemory` in `session-memory.ts`) on every append.

This turns the three hottest query patterns into O(1) or bounded operations instead of full-file scans:
- **Compaction anchor** (`SELECT id WHERE type='compaction_summary' ORDER BY id DESC LIMIT 1`) — called on nearly every AI turn by context estimation, cross-engine injection, and decision injection. Sidecar gives this directly.
- **Point lookup by id** — executors fetch the row they just wrote. Sidecar's `byteLength`/known append position gives a direct seek.
- **Reverse pagination without a cursor** (latest page) — seek to `byteLength`, scan backward bounded by page size, not conversation length.

**Alternative considered**: no sidecar, scan the JSONL directly for every query. Rejected — the compaction-anchor query alone would become an O(n) file scan on nearly every turn for long-running tasks/chats, reintroducing the exact "slowliness" this change exists to fix, just relocated from SQLite to the filesystem.

**Resilience**: the sidecar can drift from the JSONL if a process crash occurs between a JSONL append and the sidecar rewrite. The store must detect this (e.g. `byteLength` mismatch) and self-heal by recomputing the sidecar from the JSONL file (bounded, one-time cost, not a hot-path cost).

### D3: Message `id` = 1-based line number, derived not stored

A message's `id` is its line position in the file; append = write one line at current EOF, id = `existing_line_count + 1`. No redundant `id` field is required in the JSON payload (though it may be included for sanity-checking/tooling).

**Alternative considered**: explicit `id` field maintained by an independent sidecar counter, decoupled from physical line position. Rejected — line-number-as-id is simpler, is a pure function of file position (no counter to keep in sync), and matches how AUTOINCREMENT already behaves (dense, monotonic, gapless per conversation). The one gap this leaves — corrupted/partially-written lines — is handled via a tombstone placeholder line (preserving numbering) rather than renumbering, so downstream ids (`call_${message.id}` fallback, pagination cursors, decision `decisions_injected_after_compaction_id`) remain stable.

### D4: In-process write queue per conversation; no OS-level file locking

Concurrent appends to the same conversation's file (e.g. a background compaction-summary write racing a live user message append) are serialized via an in-process async queue (`Map<conversationId, Promise<void>>` chained per conversation). No `flock`/advisory locking is used.

**Alternative considered**: OS-level advisory file locks. Rejected — Bun's cross-platform `flock` support is less mature than Node's, adds real complexity (acquisition/timeout/retry, Windows compatibility per existing `isWindows()` helpers in `platform.ts`), and solves a multi-process scenario that doesn't occur in this app's deployment model (same single-writer assumption SQLite WAL already makes).

### D5: `ConversationMessageStore` interface with file + legacy-SQLite implementations, resolved once

Introduce one interface covering every cataloged access pattern:

```
interface ConversationMessageStore {
  append(msg: NewConversationMessage): Promise<ConversationMessage>;
  getById(id: number): Promise<ConversationMessageRow | null>;
  getLastByType(type: MessageType): Promise<{ id: number } | null>;
  getRange(fromId: number, opts?: { limit?: number; excludeBeforeId?: number }): Promise<ConversationMessageRow[]>;
  getPage(opts: { beforeId?: number; limit: number }): Promise<{ rows: ConversationMessageRow[]; hasMore: boolean }>;
  getAll(filter?: { types?: MessageType[] }): Promise<ConversationMessageRow[]>;
  delete(): Promise<void>; // removes the backing file(s) entirely
}
```

Two implementations:
- `FileConversationMessageStore` — JSONL + sidecar, used for all conversations created after this change ships.
- `LegacySqliteConversationMessageStore` — thin, read-only wrapper around today's existing `conversation_messages` SQL, used for conversations that predate this change.

A small resolver/factory (e.g. `ConversationMessageStoreFactory.forConversation(conversationId)`) is the **only** place that decides which implementation backs a given conversation (e.g. by checking file existence, or a `conversations.storage_version`-style marker). All ~10 call sites (`messages.ts`, `conv-message-buffer.ts`, `context.ts`, `context-estimator.ts`, `cross-engine-context.ts`, `decision-context-injector.ts`, `handlers/conversations.ts`, `handlers/chat-sessions.ts`, `board-tool-executor.ts`, `chat-executor.ts`, `human-turn-executor.ts`, `code-review-executor.ts`, `session-memory.ts`) depend on `ConversationMessageStore` via constructor injection instead of issuing raw SQL against `conversation_messages`. They continue to use the injected `Database` directly for everything else (executions, tasks, chat_sessions, decisions).

**Alternative considered**: inline `if (isLegacy) {...sql...} else {...file...}` branching at each of the ~10 call sites. Rejected — directly violates the "avoid god classes / prefer DI and loose coupling" goal; duplicates branching logic 10 times, and any future storage change (e.g. eventually dropping the legacy path) requires touching all 10 files again instead of one.

### D6: Drop `stream_events` and its entire subsystem; no relocation

Initial plan was to merge `stream_events` and `model_raw_messages` into one file-based debug log. Investigation of the actual read path changed this: `conversations.getStreamEvents` has zero callers in `src/mainview` today (confirmed via full-repo grep — only test/e2e mocks and the backend handler reference it). The frontend's WS-reconnect handling (`useSessionSyncHandler.ts`) only reloads the chat session **list**, not per-conversation stream events. Tracing the live-render pipeline (`stores/conversation.ts`) further confirmed:

- Ephemeral per-token deltas (`text_chunk`/`reasoning_chunk`) are broadcast directly from `StreamProcessor` to the WS, in-memory, and were **never** persisted to `stream_events` in the first place (excluded via `HIGH_FREQ_RAW_EVENT_TYPES`) — this is pure live-typing UX, by original design.
- Durable turn content (tool calls, tool results, final assistant text) is written once via `ConvMessageBuffer`, and that same write is what triggers the `onNewMessage` WS push. `getMessages` (REST reload) and `onNewMessage` (WS push) already share one source of truth today — the message store. `stream_events` was a secondary, best-effort persistence of the same live events, kept only for a replay feature that has no caller.

Given this, `stream_events` is removed outright: the table, its migrations' forward relevance, `WriteBuffer<PersistedStreamEvent>` usage, `appendStreamEventBatch`/`getStreamEventsByConversation`, the `conversations.getStreamEvents` RPC and its shared types, and the `blockId`/`seq`/`parentBlockId`/`subagentId` enrichment logic in `StreamProcessor` that existed only to feed it.

`model_raw_messages` is retained in spirit but moved to a per-execution file-based debug log (e.g. `~/.railyn/debug/<executionId>.jsonl`), since it is still actively used for forensic debugging (it was instrumental in root-causing a real production bug — see `2026-04-15-claude-tool-translation`).

**Trade-off accepted**: if a reconnect-mid-stream replay UX is desired in the future, it does not exist today and must be designed fresh (as a new feature, not a storage relocation) — this change does not attempt to preserve or rebuild it.

### D7: No migration/backfill of existing `conversation_messages`

Pre-existing `conversation_messages` rows stay in SQLite, served read-only via `LegacySqliteConversationMessageStore`. Only conversations created after this change ships get a file.

**Alternatives considered:**
- *Backfill everything in a one-time migration*: avoids permanent dual-mode branching, but requires a filesystem-touching migration step outside the existing `up(db)`-only migration shape, must handle very large histories without OOM, and carries real risk of data loss/corruption if interrupted mid-run.
- *Lazy migrate on first read/write per conversation*: spreads migration cost over time, but adds an in-request migration path with its own partial-failure handling (crash mid-move leaves a conversation split across both stores).

Both were rejected in favor of the simpler "old stays old, new is new" split — the dual-mode cost is fully absorbed by D5's resolver, so it doesn't leak into call sites. `conversation_messages` and its bloat persist for old conversations, but new conversations (the ones actively growing and causing write contention) get the benefit immediately, and old conversations naturally age out via the existing archived-chat-session retention sweep (D8).

### D8: Deletion hooks — no new `chatSessions.delete` RPC

File cleanup is wired into the two deletion paths that already exist:
1. `tasks.delete` (and the AI-invoked task-deletion path in `board-tool-executor.ts`) — deletes the task's conversation file (and any debug log files for its executions) alongside the existing SQL deletes.
2. `RetentionJob.runNow()`'s existing sweep of archived chat sessions older than 7 days — deletes the corresponding conversation file(s) when it hard-deletes the conversation row.

No new `chatSessions.delete` RPC is introduced. Chat sessions today only support soft-archive (`chatSessions.archive`); actual removal happens exclusively via the 7-day retention sweep. That sweep is the one true "delete" moment for a chat session's data today, and it's where the file cleanup hook belongs.

### D9: Fix inconsistent session-memory path as a side-cleanup

`session-memory.ts` currently writes to `~/.config/railyn/tasks/<id>/session-notes.md` — a path that doesn't follow the `~/.railyn` (`getDataDir()`) convention used everywhere else (logs, MCP config, and now conversation/debug files). This is corrected to live under `~/.railyn/` as part of this change, since it's a small, closely-related cleanup opportunity surfaced during the audit of file-storage conventions.

### D10: File deletion lives in a standalone injected `ConversationFileDeleter`, not on the store

`ConversationMessageStore.delete()` in D5 is narrowed to a documentation-only note; actual file cleanup for a deleted task/session is owned by a small, dedicated collaborator:

```
interface ConversationFileDeleter {
  deleteConversationFiles(conversationId: number): Promise<void>;
}
```

This is injected into `tasks.ts`'s handler factory, `BoardToolExecutor`, and `RetentionJob` constructors — mirroring the existing optional `worktreeManager` constructor param already used by both `tasks.delete` and `BoardToolExecutor`. Its single implementation deletes `<conversationId>.jsonl`, `<conversationId>.meta.json`, and any `<conversationId>.debug.<executionId>.jsonl` debug-log files for that conversation; it is a safe no-op for legacy (SQLite-backed) conversations.

**Alternatives considered:**
- *`delete()` method on `ConversationMessageStore` itself*: conflates message CRUD with lifecycle/deletion concerns (violates SRP), and can't cleanly also delete debug-log files, which aren't the message store's concern — would need a second call anyway.
- *Plain exported function, no interface, called directly from all 3 sites*: simplest code, but call sites become hard to unit-test in isolation without hitting the real filesystem or mocking a module import (more brittle than constructor injection) — goes against this task's explicit preference for DI-based mocking over alternative paths.

**Rationale**: single responsibility, trivially mockable (`{ deleteConversationFiles: vi.fn() }`) in unit tests for all 3 call sites, one implementation to test thoroughly against a real temp directory.

### D11: `session-memory.ts` is refactored to inject its message-reading dependency

`_doExtract()` currently calls `getDb()` internally and queries `conversation_messages` directly — the one call site in the original ~10-site catalog that was flagged only for a *path* fix (D9), not for full DI. Left as direct SQL, it would silently stop seeing recent messages for any conversation created after this change ships (since it never reads from the file store), and it has zero existing test coverage today.

This is corrected: `extractSessionMemory`/`_doExtract` now accept a `ConversationMessageStore` (resolved once via the same factory as every other call site) instead of calling `getDb()` internally. This closes both the correctness gap and the testability gap — the module gets its first-ever unit tests, using a fake/in-memory store instead of a real database.

**Alternative considered**: leave `_doExtract` on direct SQL, applying only the `~/.config` → `~/.railyn` path fix (D9) already decided. Rejected — this would be a real, silent regression (not just a missed test), and would leave 1 of 10 call sites inconsistent with the rest of the abstraction.

## Testing Strategy

Per project convention, testing is layered: Bun/vitest unit tests with an in-memory SQLite DB (`initDb()`) and real temp directories for file-store tests, `e2e/api` integration tests against a real (in-memory) backend, and Playwright UI tests against mocked `/api/*` routes. This change's test surface maps as follows:

**Unit tests (new)**
- `ConversationMessageStore` contract suite: a shared set of test cases (append, `getById`, `getLastByType`, `getRange`, `getPage`, `getAll`) run against both `FileConversationMessageStore` (real tmpdir via `RAILYN_DATA_DIR` override) and `LegacySqliteConversationMessageStore` (in-memory DB), asserting identical observable behavior.
- `FileConversationMessageStore`-specific: line-number-as-id derivation, tombstone placeholder on corrupted/partial line, sidecar atomic write (temp+rename), sidecar self-heal on byte-length drift, compaction-anchor lookup via sidecar fields.
- Write-queue concurrency: two `append()` calls fired without awaiting the first, then `Promise.all`'d, against a real tmpdir — assert exactly 2 well-formed lines in issue order (no fake filesystem abstraction; see Open Questions/decisions).
- Resolver/factory: file-vs-legacy branch decision is the single point of medium selection.
- `ConversationFileDeleter` (D10): deletes `.jsonl`/`.meta.json`/debug-log files for a file-backed conversation; no-ops for a legacy conversation.
- `session-memory.ts` (D11): first-ever unit tests for `_doExtract`, using a fake `ConversationMessageStore`.

**Unit tests (updated)**
- `conv-message-buffer.test.ts` — retarget assertions from raw `conversation_messages` SQL to the injected store's `appendBatch()`.
- `retention-job.test.ts` — replace RJ-2 (`stream_events` pruning assertions) with debug-log-file-age pruning; extend RJ-5 (archived-session sweep) with file-deletion assertions via the injected `ConversationFileDeleter`.
- `handlers.test.ts` — `tasks.delete` gains a file-deletion-after-commit assertion (file-backed case) and a no-op assertion (legacy case); the `conversations.getStreamEvents` test (line ~592) is removed along with the RPC.
- `context-estimator.test.ts`, `cross-engine-context.test.ts`, `decision-context-injector.test.ts`, `conversation-context.test.ts` — re-run against a store-backed fixture instead of direct `conversation_messages` SQL seeding, covering both storage media where the underlying query pattern (anchor lookup, range-from-anchor) is exercised.
- `db-migrations.test.ts` — the `M-048c` (`stream_events` cascade) case is removed with the table; migrations dropping `stream_events` and `model_raw_messages` get their own "runs without error on existing data" case.

**Integration tests (`e2e/api`)**
- `conversations.getMessages` pagination parity test seeding one file-backed and one legacy conversation in the same run, asserting identical response shape/ordering from both.
- Removal check: `conversations.getStreamEvents` no longer exists as a handler (compile-time via `rpc-types.ts` removal + a runtime 404/unknown-method assertion if such a generic test exists already).

**Playwright (`e2e/ui`)**
- No new specs required — `conversation-pagination.spec.ts` and `tool-rendering.spec.ts` mock RPC shapes only, which are unchanged. Cleanup only: remove the stale `.returns("conversations.getStreamEvents", [])` default from `e2e/ui/fixtures/index.ts` and correct the outdated comment in `tool-rendering.spec.ts` that misattributes tool-message seeding to that mock.

**Explicitly out of scope for this change** (per instruction not to refactor purely for testability): no new filesystem abstraction/port is introduced solely to enable mocking — the existing `RAILYN_DATA_DIR` override + real-tmpdir convention (already used in `global-engines-config.test.ts` etc.) is reused as-is.

## Risks / Trade-offs

- **[Risk] Sidecar/JSONL drift on crash** → Mitigation: detect via byte-length mismatch on read; self-heal by recomputing the sidecar from the JSONL (bounded one-time cost).
- **[Risk] Corrupted/partial line breaks id numbering** → Mitigation: tombstone placeholder lines preserve line-number-as-id stability instead of renumbering.
- **[Risk] Permanent dual-mode store (file vs. legacy SQLite) adds a small amount of ongoing complexity** → Mitigation: fully contained behind the `ConversationMessageStore` resolver (D5); no call site branches on storage medium directly. Old conversations are a shrinking, non-growing set.
- **[Risk] Removing `stream_events` eliminates a mechanism some future feature might have wanted** → Mitigation: confirmed zero current callers via full-repo search; if reconnect-replay UX is desired later, it's a deliberate new feature decision, not a silent regression, since it doesn't function today either.
- **[Risk] File I/O latency vs. SQLite for message appends** → Mitigation: appends remain batched via the existing `ConvMessageBuffer`-style buffering, now flushing to the file store instead of SQL; the in-process write queue (D4) avoids lock contention without OS-level lock overhead.
- **[Risk] `~/.railyn/conversations/` grows unbounded on disk** → Mitigation: same lifecycle as before — task deletion and chat-session retention sweep both delete files; no change in overall data retention philosophy, just medium.

## Migration Plan

1. Introduce `ConversationMessageStore` interface + both implementations behind the resolver, with the resolver defaulting all *existing* conversations to `LegacySqliteConversationMessageStore` (identified by absence of a conversation file) and all *new* conversations to `FileConversationMessageStore`.
2. Retarget `ConvMessageBuffer` to write through the store abstraction; retarget all ~10 read call sites to the interface.
3. Remove `stream_events`: delete the RPC, the enrichment code, the `WriteBuffer` usage, and add a migration to drop the table.
4. Relocate `model_raw_messages` writes to the new per-execution debug log file; add a migration to drop the table once the file-based path is verified; update `RetentionJob` to clean up debug log files by age instead of `DELETE` statements.
5. Wire deletion hooks (D8) into `tasks.delete`, `board-tool-executor`, and `RetentionJob`'s archived-session sweep, via the injected `ConversationFileDeleter` (D10).
6. Refactor `session-memory.ts` to inject `ConversationMessageStore` instead of calling `getDb()` internally (D11), and fix its path convention (D9).
7. No data migration step for existing `conversation_messages` — it is left in place indefinitely, per D7.

**Rollback**: since old conversations never leave SQLite, rollback of the file-store portion is limited to reverting code (new conversations created during a rollout window would need their files re-imported or accepted as a small data-loss window — flagged as an operational consideration, not solved by this change).

## Open Questions

- Exact debug log file naming/location for `model_raw_messages` replacement (`~/.railyn/debug/<executionId>.jsonl` proposed, not finalized).
- Whether a `conversations.storage_version` column vs. plain file-existence check is the resolver's discriminant (implementation detail, deferred to task breakdown).
- Retention window for the new debug log files (currently 1 day for `model_raw_messages`; assumed unchanged).

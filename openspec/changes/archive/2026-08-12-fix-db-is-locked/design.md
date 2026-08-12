## Context

Two crash signatures were observed in the running app:

```
[railyin] Unhandled rejection: SQLiteError: database is locked
    at run (unknown) ... at transaction (bun:sqlite:416:27)
    at flush (write-buffer.ts:54:10) at _loop (write-buffer.ts:90:14)

[stream-processor] Unhandled error from consume (task=648, execution=7109):
    ... db.run("UPDATE tasks SET execution_state = 'failed' ...")
    SQLiteError: database is locked
```

Field investigation (2026-08-12) established the following facts:

- **Two `bun run prod` servers** (PID 426 on port 3000, PID 57580 on port 3001) held `~/.railyn/railyn.db` open simultaneously (`lsof`). WAL permits exactly one writer across all connections/processes; with both servers streaming, write-lock contention is constant. A third app-launched instance used an isolated temp DB.
- **`model_raw_messages` is write-only**: 648,865 rows in the last 24h (~6 GB of `payload_json`; max payload 4.8 MB), no production reader — only the retention DELETE. The DB file is 6.5 GB (3.2 GB backup).
- **`busy_timeout` works** in bun 1.4.0 (verified: a waiting writer succeeds once the lock frees), but at 5000 ms every contended sync write stalls the whole event loop.
- **`WriteBuffer._loop` has no error handling**: the first SQLITE_BUSY becomes an unhandled rejection and the flush loop dies permanently.
- **`consume()`'s catch block can itself throw**, masking the original error and leaving task state stuck.
- **Startup**: `RetentionJob.start()` → `runNow()` runs a full-scan `DELETE FROM model_raw_messages WHERE created_at < now-1d` synchronously at boot (measured ~446 ms scan even with 0 matches; minutes when old rows exist). No error handling → a boot-time SQLITE_BUSY crashes startup. Both servers run it at boot.
- **`backupDb()`** copies the entire 6.5 GB file whenever a pending migration exists (currently none pending — verified all 58 migration IDs applied — but latent).
- **Boot logs**: two recent boots show ~32.5 s from "Log started" to "server listening"; only ~2–3 s is attributable (shell-env 1.1 s, migration discovery 23 ms, retention scan ~0.45 s, config/engines sub-second). AI SDK module imports total ~9.8 s but occur before the first log line. ~29 s remains unattributed and needs boot phase-timing markers to pinpoint on a real start.
- **`logs` table**: 12.8k rows / 35 MB, dormant since June 15 — but `realLogger` (`src/bun/logger.ts`) still performs `INSERT INTO logs` and is wired into `ai/retry.ts`, `ai/anthropic.ts`, `workflow/session-memory.ts`, `conversation/context.ts` (defaults `noopLogger`). The new engine stack bypasses these paths in practice, but the code is live.
- **`railyin-tree` worktree verified**: `copilotkit/import.ts` touches only `conversations` + `conversation_messages` — dropping `model_raw_messages` is safe for that branch.

## Goals / Non-Goals

**Goals:**
- Eliminate the observed crash signatures: `WriteBuffer` loop must never die; error paths must never mask original errors or crash `consume()`.
- Remove the dominant write-volume source (`model_raw_messages`, ~6 GB/day).
- Make startup fast and crash-proof: no synchronous full-scan DELETE at boot, no 6.5 GB backup copy, error-safe retention.
- Reduce lock contention and lock-hold times: batched retention deletes, WAL tuning, higher `busy_timeout`.
- Keep the multi-process model working (resilience-only, per decision): a second server against the same DB must not produce crashes.
- Preserve all user-visible behavior: WS streaming broadcasts, `Logger` interface, RPC surface.

**Non-Goals:**
- Single-instance enforcement (explicitly rejected — multi-instance stays allowed).
- Architectural refactors: no `ExecutionStateWriter` extraction, no `StreamProcessor` decomposition, no shared loop primitive (deferred to a follow-up change).
- Async write queue / non-blocking write architecture (rejected — keep sync writes with long `busy_timeout`).
- Full test-suite update (testing is tracked separately, after implementation).
- Postgres or other storage migration.

## Decisions

### Decision: Multi-instance stays allowed — resilience only (no startup guard)
Railyin SHALL NOT add a single-instance lock. SQLITE_BUSY handling must make concurrent servers on one DB non-fatal.

**Rationale**: The user explicitly wants to keep running multiple servers against one DB (e.g., per-worktree dev servers). The fix therefore focuses on eliminating lock-hold times and absorbing transient busy errors.
**Alternative considered**: Single-instance lock file (rejected — removes flexibility the user relies on).

### Decision: Drop `model_raw_messages` entirely
A new migration drops the table (+ its three indexes). The raw-message persistence path (`createRawMessageBuffer`) is removed; `StreamProcessor.makePersistCallback` becomes a direct call to the WS broadcast callback (`onRawMessageEnqueued`), so live streaming/UI behavior is unchanged. Retention's `model_raw_messages` DELETE is removed.

**Rationale**: The table is write-only (~6 GB/day), has no production reader, and its retention DELETE was a long-lock holder. `railyin-tree`'s import feature does not use it (verified).
**Alternative considered**: Opt-in debug flag or payload capping (rejected — user chose the drop; debugging capability can be reintroduced later if needed).

### Decision: `busy_timeout` 5000 → 20000
The connection keeps sync writes; SQLITE_BUSY after a 20 s wait is treated as a genuine failure (WriteBuffer drops with a log; error paths degrade gracefully).

**Rationale**: User choice ("put it in 20000"). Combined with dropping 6 GB/day of writes and short retention locks, 20 s is effectively never reached in normal operation.
**Consequence (accepted)**: a contended write can block the event loop up to 20 s — mitigated by the volume reduction and batching.

### Decision: WAL tuning — `synchronous = NORMAL` + `journal_size_limit`
Set `PRAGMA synchronous = NORMAL` (WAL-safe; removes commit fsync stalls under multi-process contention) and `PRAGMA journal_size_limit = 67108864` (64 MB cap on WAL growth so checkpoints stay cheap).

**Rationale**: SQLite's documented WAL companion settings; one line each, low risk.
**Consequence (accepted)**: power loss may lose recent commits (never corrupts the DB) — acceptable for a local tool.

### Decision: `WriteBuffer` becomes error-safe (generic, reusable)
- `flush()` catches `flushFn` errors: SQLITE_BUSY → requeue the batch at the front with a consecutive-failure counter; after 3 attempts, log + drop (bounded memory). Other errors → log + drop.
- `_loop()` wraps iterations in try/catch so the loop never dies.
- `stop()` catches flush errors and never throws.

**Rationale**: fixes stack trace #1 for both existing buffers (raw-message buffer is removed, but the `stream_events` buffer keeps the guarantee). Keeps the generic `WriteBuffer<T>` API unchanged.

### Decision: Error paths use best-effort DB writes
`StreamProcessor.consume()`'s catch, finally, and abort paths wrap every DB state write in a `bestEffort(label, fn)` helper (try/catch + `console.error`). A busy error can no longer mask the original error or escape `consume()`.

**Rationale**: fixes stack trace #2; minimal seam (one private helper), no new layer.

### Decision: `RetentionJob` — batched, error-safe, deferred
- Remove the `model_raw_messages` DELETE.
- `stream_events` DELETE becomes a batched loop (`DELETE ... WHERE created_at < ? LIMIT 500` until 0 rows) — each statement auto-commits, so locks are short.
- Every cleanup phase is wrapped in try/catch (log + continue).
- `start()` no longer runs `runNow()` synchronously; the first run is deferred (e.g. 5 min after boot) and the hourly loop is error-safe.
- New migration adds `idx_stream_events_created_at` for the batched predicate.

**Rationale**: eliminates the boot-time full-scan DELETE and the crash-on-boot path; short locks; matches the intent of the existing `db-retention-job` spec (which already drifted from the code).

### Decision: `backupDb()` becomes size-aware
Above a threshold (1 GB), log a warning with operator guidance (`VACUUM INTO` for a manual backup) and skip the automatic copy.

**Rationale**: a 6.5 GB copy at startup on any pending migration is worse than the risk it mitigates; migrations remain checksum-guarded.

### Decision: `realLogger` repointed to file logging; `logs` table dropped
`src/bun/logger.ts`'s `log()`/`realLogger` write a structured JSON line via `console.log` (captured by `server/file-logger.ts` in prod; visible in dev console). The `Logger` interface, `LogOptions`, `noopLogger`, and all call sites stay unchanged. Migration `056` drops the `logs` table.

**Rationale**: removes the table without breaking dormant-but-live call sites (`ai/retry.ts`, `ai/anthropic.ts`, `workflow/session-memory.ts`, `conversation/context.ts`).
**Alternatives considered**: keep the table (rejected — user wants it gone); delete the logger entirely (rejected — loses the logging API and breaks call sites/tests).

### Decision: Boot phase-timing markers
`index.ts` logs `[boot] <phase> <ms>` markers around each startup phase (module load, shell-env, migrations, config/registry, engines, retention, server bind).

**Rationale**: closes the ~29 s unaccounted boot gap with real data on the next start; minimal code.

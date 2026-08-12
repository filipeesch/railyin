## Why

Railyin is hitting `SQLiteError: database is locked` (SQLITE_BUSY) frequently. Two observed failure modes:

1. `WriteBuffer._loop` → `flush()` → `insertBatch` transaction throws SQLITE_BUSY; because `_loop` has no error handling, the unhandled rejection **permanently kills the flush loop** (raw messages silently stop persisting).
2. `StreamProcessor.consume()`'s `catch` block itself runs `db.run("UPDATE tasks SET execution_state = 'failed' ...")`; when *that* hits SQLITE_BUSY, the original error is masked and the task state is never updated.

Investigation confirmed the aggravating factors:

- **Multiple server processes share one SQLite file** — two `bun run prod` servers (ports 3000 + 3001) were observed holding `~/.railyn/railyn.db` open simultaneously. WAL allows only one writer across all processes, so streaming writes collide constantly.
- **~6 GB/day of writes into `model_raw_messages`** — 648k rows in 24h, avg 9.3 KB / max 4.8 MB payloads (tool results with full file contents). No production code reads this table; it is write-only debug data.
- **`busy_timeout = 5000` blocks the event loop** — every sync `db.run` in the stream hot path can stall the entire server up to 5s during contention, freezing streaming/WS.
- **Heavy startup DB op** — `RetentionJob.start()` runs `runNow()` synchronously at boot: a full-scan DELETE over the 6 GB table in one transaction. With no error handling, a SQLITE_BUSY at boot **crashes server startup**; the hourly loop can also die silently.
- **Latent 6.5 GB copy at startup** — `backupDb()` copies the entire DB file whenever a pending migration exists.
- **WAL defaults untuned** (`synchronous=FULL`, no `journal_size_limit`); the live DB file is 6.5 GB.

## What Changes

- **SQLite connection tuning** in `src/bun/db/index.ts`: `busy_timeout` 5000 → 20000, plus `synchronous = NORMAL` (WAL-safe) and a bounded `journal_size_limit`.
- **`WriteBuffer` never dies**: per-flush error handling (SQLITE_BUSY → requeue + bounded retry; other errors → log + drop), `_loop()` survives failures, `stop()` never throws. This hardens the `stream_events` buffer too.
- **Error paths can't crash**: `StreamProcessor.consume()` catch/finally/abort DB writes become best-effort (wrapped, logged) so busy errors never mask the original error or crash `consume()`.
- **Drop `model_raw_messages`** (migration + remove the raw-message persistence path; the WS broadcast side `onRawMessageEnqueued` is preserved via a direct callback instead of a WriteBuffer).
- **Drop the `logs` table and repoint `realLogger` to file logging** (structured JSON lines via `console`, captured by `server/file-logger.ts`); the `Logger` interface and call sites stay unchanged.
- **`RetentionJob`** becomes batched (LIMIT deletes, short locks), error-safe (boot/loop never crash), and defers its first run off the boot path; `model_raw_messages` cleanup is removed; a `created_at` index on `stream_events` supports the batched deletes.
- **`backupDb()` becomes size-aware**: skip the copy with a warning above a threshold (no more 6.5 GB copies on pending migrations).
- **Boot phase-timing markers** in `index.ts` to pinpoint the ~29s unaccounted startup gap observed in logs.
- **Ops step**: VACUUM the existing 6.5 GB DB after the change.

## Capabilities

### New Capabilities
- `sqlite-write-resilience`: SQLite connection tuning (busy_timeout 20000, synchronous NORMAL, journal_size_limit) and best-effort DB writes in execution error paths so SQLITE_BUSY can never crash the stream loop or mask original errors.
- `file-structured-logging`: `realLogger` writes structured JSON lines to the file logger instead of the DB `logs` table; the `logs` table is dropped.

### Modified Capabilities
- `write-buffer`: `WriteBuffer` flushes are error-safe — SQLITE_BUSY batches are requeued with bounded retries, the background loop never dies, and `stop()` never throws.
- `db-retention-job`: cleanup runs in short batched transactions, is error-safe, and defers its first run off the boot path; `model_raw_messages` cleanup is removed (table dropped).
- `engine-stream-processor`: raw message persistence is removed (broadcast preserved via direct callback); DB state writes in catch/finally/abort paths are best-effort.
- `db-migration-runner`: `backupDb()` is size-aware — large DBs skip the automatic copy with a warning and operator guidance.

## Impact

- **Code**: `src/bun/db/index.ts`, `src/bun/pipeline/write-buffer.ts`, `src/bun/engine/stream/stream-processor.ts`, `src/bun/engine/stream/raw-message-buffer.ts` (deleted), `src/bun/engine/stream/types.ts` (new, `RawMessageItem`), `src/bun/engine/orchestrator.ts`, `src/bun/logger.ts`, `src/bun/jobs/retention-job.ts`, `src/bun/db/migrations/runner.ts`, `src/bun/index.ts`, new migrations `055`–`057`.
- **Tests** (deferred, tracked separately): `raw-message-buffer.test.ts` (delete/rewrite), `retention-job.test.ts`, `db-migrations.test.ts`, `test/helpers.ts`, `logger.test.ts`, `write-buffer.test.ts`.
- **API/RPC**: no new surface — WS broadcast behavior unchanged.
- **DB**: migrations `055_drop_model_raw_messages`, `056_drop_logs_table`, `057_stream_events_created_at_index`; existing DBs shrink via retention + one-time VACUUM (ops step).
- **Docs**: `AGENTS.md` gotchas updated (multi-instance guidance, `busy_timeout` semantics); spec files updated for the modified capabilities.

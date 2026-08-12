# Tasks — fix-db-is-locked

> **Testing is deliberately deferred** (per user): the test-suite updates listed in section 9 are tracked separately and applied after implementation.

## 1. SQLite connection tuning
- [ ] 1.1 `src/bun/db/index.ts`: raise `PRAGMA busy_timeout` from 5000 to 20000
- [ ] 1.2 `src/bun/db/index.ts`: add `PRAGMA synchronous = NORMAL` and `PRAGMA journal_size_limit = 67108864`
- [ ] 1.3 Confirm pragmas apply once on connection creation; no API change

## 2. WriteBuffer resilience (generic)
- [ ] 2.1 `flush()`: wrap `flushFn` in try/catch; classify `SQLITE_BUSY` vs other errors
- [ ] 2.2 SQLITE_BUSY: requeue batch at front + consecutive-failure counter; drop after 3 attempts with error log
- [ ] 2.3 Non-busy errors: log + drop batch (never requeue)
- [ ] 2.4 `_loop()`: outer try/catch so the loop never dies
- [ ] 2.5 `stop()`: catch + log final-flush errors, never throw

## 3. StreamProcessor error-path safety
- [ ] 3.1 Add private `bestEffort(label, fn)` helper (try/catch + `console.error`)
- [ ] 3.2 Wrap catch-block DB writes (`tasks`/`chat_sessions`/`executions` status updates)
- [ ] 3.3 Wrap finally-block DB work (`fetchTaskWithModel`, `needs_column_prompt`, `pending_messages`)
- [ ] 3.4 Wrap abort-path DB writes
- [ ] 3.5 Verify original errors still reach `onError` + done stream event

## 4. Drop model_raw_messages
- [ ] 4.1 New migration `055_drop_model_raw_messages.ts` (`DROP TABLE IF EXISTS model_raw_messages`)
- [ ] 4.2 Move `RawMessageItem` interface to `src/bun/engine/stream/types.ts`; delete `raw-message-buffer.ts`
- [ ] 4.3 `StreamProcessor`: replace `rawBuffer: WriteBuffer<RawMessageItem>` param with `onRawMessage(item)` callback; `makePersistCallback` calls it directly (broadcast behavior preserved)
- [ ] 4.4 `orchestrator.ts`: remove `createRawMessageBuffer`; pass `streamProc.onRawMessageEnqueued.bind(streamProc)` directly
- [ ] 4.5 `server/stream-processor.ts`: update `RawMessageItem` import; no behavior change to chunk broadcast
- [ ] 4.6 Remove `model_raw_messages` DELETE from `RetentionJob`

## 5. Logger repoint + drop logs table
- [ ] 5.1 `src/bun/logger.ts`: `log()`/`realLogger` write structured JSON lines via `console.log`; remove `getDb()` dependency; keep `Logger`/`LogOptions`/`noopLogger` exports
- [ ] 5.2 New migration `056_drop_logs_table.ts` (`DROP TABLE IF EXISTS logs`)
- [ ] 5.3 Confirm no production `INSERT INTO logs` / `SELECT ... FROM logs` remains (only tests/historical migrations)

## 6. RetentionJob — batched, error-safe, deferred
- [ ] 6.1 New migration `057_stream_events_created_at_index.ts`
- [ ] 6.2 Replace `stream_events` DELETE with batched `LIMIT 500` loop (auto-commit per statement)
- [ ] 6.3 Wrap each cleanup phase in try/catch (log + continue); wrap `runNow()` top-level
- [ ] 6.4 `start()`: defer first run (e.g. 5 min via `waitFn`), then hourly; error-safe loop
- [ ] 6.5 Keep archived-chat-session cleanup, now error-wrapped

## 7. backupDb() size-aware
- [ ] 7.1 `runner.ts`: skip `copyFileSync` above 1 GB with warning + `VACUUM INTO` guidance; keep copy for small DBs

## 8. Boot timing markers + ops
- [ ] 8.1 `index.ts`: `[boot] <phase> <ms>` markers (start, shell-env, migrations, config/registry, engines, retention, server bind)
- [ ] 8.2 Ops runbook (documented, not code): stop all servers → verify no process holds `railyn.db` → `PRAGMA wal_checkpoint(TRUNCATE); VACUUM;` → restart
- [ ] 8.3 Update `AGENTS.md` gotchas (multi-instance guidance, busy_timeout semantics)

## 9. Test updates (deferred, tracked separately)
- [ ] 9.1 Delete/rewrite `raw-message-buffer.test.ts` (buffer removed)
- [ ] 9.2 Rewrite `retention-job.test.ts` (batched deletes, no model_raw_messages, deferred first run)
- [ ] 9.3 Update `db-migrations.test.ts` applied-ID lists (+055/056/057)
- [ ] 9.4 Strip `model_raw_messages` + `logs` from `test/helpers.ts`
- [ ] 9.5 Update `logger.test.ts` (console-based realLogger)
- [ ] 9.6 Extend `write-buffer.test.ts` (retry/drop/never-die scenarios)

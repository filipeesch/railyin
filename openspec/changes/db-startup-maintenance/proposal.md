## Why

Railyin deletes many conversations (and their `stream_events`, `executions`, etc.) during normal app execution, but SQLite keeps the freed pages in the database file — the file only grows, never shrinks. There is no mechanism that reclaims that space: `backupDb()` only ran before pending migrations (with a `copyFileSync` that could silently miss WAL data), and a full `VACUUM` only happened if an operator ran it manually (e.g. the 11 GB → 250 MB recovery in the db-lock follow-up).

Additionally, the pre-migration backup used `copyFileSync`, which is **not consistent**: it copies the main DB file without the WAL contents, so the "backup" may be non-restorable.

## What Changes

- **New `StartupMaintenance` service** (`src/bun/db/startup-maintenance.ts`) that runs at every server boot:
  1. **Backup (every startup):** `VACUUM INTO <db>.backup` after deleting any stale snapshot — a consistent, compacted, standalone rollback point for the session. Logged as `[db] Backup created: <path>`.
  2. **Maintenance (every startup):** `PRAGMA wal_checkpoint(TRUNCATE)` trims the WAL, then a full `VACUUM` reclaims free pages — but **only when free space is significant** (default: > 64 MB **or** > 10% of the file), so cost stays proportional to garbage, not DB size. Logged with reclaimed bytes.
- **Best-effort:** both phases catch errors (e.g. `SQLITE_BUSY` while another server instance holds the write lock) and log a warning — startup never crashes or blocks on maintenance.
- **Ordering:** the backup runs **before** migrations (true pre-change rollback point), the compaction **after** migrations (reclaims both conversation-deleted pages and pages freed by the migrations themselves).
- **`backupDb()` removed from the migration runner** — the runner's job is discover/validate/apply; backups are now a boot concern owned by `StartupMaintenance` (single responsibility). The size-aware `copyFileSync` skip and its `VACUUM INTO` hint go away.
- In-memory databases (`RAILYN_DB=:memory:`, dev/tests) skip maintenance entirely.

## Capabilities

### New Capabilities
- `db-startup-maintenance`: consistent `VACUUM INTO` backup + threshold-gated compaction at every startup, best-effort (never crashes boot, skips on locked DB), no-op for in-memory DBs.

### Modified Capabilities
- `db-migration-runner`: the runner no longer performs file backups; `backupDb()` (size-aware copy) is removed. Migration discovery/validation/application and the `055`–`057` migrations are unchanged.

## Impact

- **Code**: new `src/bun/db/startup-maintenance.ts`; `src/bun/db/migrations/runner.ts` (remove `backupDb`, `BACKUP_SKIP_THRESHOLD_BYTES`, now-unused `copyFileSync`/`statSync`/`getDbPath`); `src/bun/index.ts` (wire maintenance around migrations + boot markers).
- **Tests**: new `src/bun/test/startup-maintenance.test.ts` (backup creates consistent snapshot, overwrites stale, in-memory no-op, compact reclaims above threshold, skips below, never throws).
- **API/RPC**: none.
- **DB**: no schema change; a `<db>.backup` file is written/overwritten at every startup.
- **Docs**: `AGENTS.md` gotcha note about the startup backup file and auto-compaction.

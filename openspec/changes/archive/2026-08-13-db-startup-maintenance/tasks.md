# Tasks — db-startup-maintenance

## 1. StartupMaintenance service
- [x] 1.1 New `src/bun/db/startup-maintenance.ts`: `StartupMaintenance` class with injected `db`, `dbPath`, options (`backupPath`, `freeSpaceThresholdBytes`, `freeSpaceRatioThreshold`, `log`, `warn`)
- [x] 1.2 `backup()`: skip `:memory:`; delete stale `<db>.backup`; `VACUUM INTO '<db>.backup'`; log `[db] Backup created:`; try/catch → warn, never throw
- [x] 1.3 `compact()`: skip `:memory:`; `PRAGMA wal_checkpoint(TRUNCATE)`; read `page_size`/`page_count`/`freelist_count`; full `VACUUM` only when free > threshold bytes (64 MB) or > ratio (10%); log reclaimed or "nothing to reclaim"; try/catch → warn, never throw
- [x] 1.4 `enabled` guard for in-memory databases

## 2. Runner cleanup + boot wiring
- [x] 2.1 `runner.ts`: remove `backupDb()`, `BACKUP_SKIP_THRESHOLD_BYTES`, the `backupDb()` call, and now-unused imports (`copyFileSync`, `statSync`, `getDbPath`)
- [x] 2.2 `index.ts`: `const db = getDb()` before migrations; `maintenance.backup()` → `markBoot("db backup done")`; `await runMigrations()`; `seedDefaultWorkspace()`; `maintenance.compact()` → `markBoot("db compact done")`
- [x] 2.3 `AGENTS.md`: gotcha note about the every-startup backup file and auto-compaction

## 3. Tests
- [x] 3.1 New `src/bun/test/startup-maintenance.test.ts`: backup creates consistent snapshot (rows match when reopened), overwrites stale, no-op for `:memory:`, compact reclaims above threshold (page_count drops), compact skips below threshold, never throws on failure (invalid backup path / checkpoint failure)
- [x] 3.2 Typecheck + full backend suite + e2e/api + boot smoke test (temp DB: backup file created, boot markers present)

## 4. Verify + ship
- [x] 4.1 Update `tasks.md` checkboxes
- [x] 4.2 Commit (feat + test + docs), push, open PR

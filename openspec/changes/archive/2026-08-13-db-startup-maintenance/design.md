## Context

The db-lock change (PR #136) dropped `model_raw_messages` and `logs` but kept a size-aware `copyFileSync` pre-migration backup in `src/bun/db/migrations/runner.ts`. Follow-up analysis found two problems:

1. **Space is never reclaimed.** Conversations and their dependent rows are deleted during execution, but SQLite only marks pages free in the file — the file size never shrinks without a `VACUUM`. No code path ran `VACUUM`; the operator had to do it manually (the 11 GB → 250 MB recovery in the db-lock follow-up).
2. **The pre-migration backup is not consistent.** `copyFileSync` copies only the main DB file; anything still in the WAL is silently missing, so the "backup" may not restore. Verified: `VACUUM INTO` produces a consistent snapshot that includes WAL data (sandbox test), fails if the target exists, and works with single/double-quoted paths.

Verified safety facts (sandbox):
- Full `VACUUM` in WAL mode: `integrity_check: ok` after; works with concurrent readers; fails cleanly with `SQLITE_BUSY` when another connection holds the write lock.
- `VACUUM` reclaims deleted-row space (instrumented: page_count 2867 → 957 after deleting 2/3 of rows and vacuuming; file 11.7 MB → 3.9 MB).
- `auto_vacuum=INCREMENTAL` in WAL mode showed unexpected behavior (freelist did not reflect deletes; file grew after `incremental_vacuum`) — not recommended without deeper investigation.

User decision (recorded): use `VACUUM INTO` as the backup mechanism, run it **every startup** (backup + maintenance), reclaim space with a threshold-gated full `VACUUM` ("we usually delete many conversations during the app execution, but the size is not reclaimed").

## Goals / Non-Goals

**Goals:**
- Consistent, compacted backup at every startup (`VACUUM INTO <db>.backup`).
- Automatic space reclamation at every startup for pages freed by deleted conversations.
- Bounded cost: full `VACUUM` only when free space is significant.
- Best-effort: never crash or block startup on a locked DB (multi-instance allowed).
- Clear separation: the migration runner no longer owns backups.

**Non-Goals:**
- `auto_vacuum=INCREMENTAL` / incremental maintenance (unverified WAL interaction — future investigation).
- Scheduled (non-boot) maintenance timers.
- Backup rotation beyond overwriting the single `<db>.backup`.
- Changing the existing `055`–`057` migrations or the runner's discovery/validation behavior.

## Decisions

### Decision: `VACUUM INTO` is the backup mechanism
`StartupMaintenance.backup()` deletes any stale `<db>.backup` and runs `VACUUM INTO '<db>.backup'` — a consistent, compacted, standalone snapshot (includes WAL data).

**Rationale**: verified consistent where `copyFileSync` is not; compacted output; no exclusive lock needed (read-transaction snapshot), so it is safe with other instances.
**Alternative rejected**: keep `copyFileSync` (inconsistent), or size-gate the backup (user wants an unconditional every-startup rollback point; at the current 250 MB the copy is trivial).

### Decision: Threshold-gated full VACUUM for reclamation
`StartupMaintenance.compact()` runs `PRAGMA wal_checkpoint(TRUNCATE)` then a full `VACUUM` when free space exceeds 64 MB **or** 10% of the file; otherwise it logs "nothing to reclaim" and skips.

**Rationale**: full VACUUM is verified safe and effective; the threshold bounds startup cost as the DB grows (at 250 MB it behaves like "always vacuum").
**Alternatives rejected**: unconditional VACUUM every boot (multi-minute boots on multi-GB DBs); `auto_vacuum=INCREMENTAL` (unverified WAL interaction, persistent header flag).

### Decision: Backup before migrations, compaction after
Boot order: `maintenance.backup()` → `runMigrations()` → `maintenance.compact()`.

**Rationale**: the backup is a true pre-change rollback point when migrations are pending; the compaction reclaims both conversation-deleted pages and pages freed by the migrations themselves.

### Decision: Best-effort, never blocks boot
Both phases wrap their work in try/catch; on failure (e.g. `SQLITE_BUSY` from another instance) a warning is logged and boot continues. In-memory DBs skip maintenance entirely.

**Rationale**: multi-instance is allowed; maintenance must never be a boot failure mode.

### Decision: The migration runner stops doing backups
`backupDb()` and `BACKUP_SKIP_THRESHOLD_BYTES` are removed from `src/bun/db/migrations/runner.ts`; `StartupMaintenance` owns backups and compaction.

**Rationale**: single responsibility (SRP) — the runner discovers/validates/applies migrations; boot-time file maintenance belongs to a dedicated injectable service.

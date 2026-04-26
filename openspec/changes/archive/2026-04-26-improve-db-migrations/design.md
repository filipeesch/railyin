## Context

`src/bun/db/migrations.ts` is a 1,131-line file containing all 35 database migrations inline, a 17-branch `applyMigration()` dispatcher, and `seedDefaultWorkspace()`. The file has grown organically and has accumulated four duplicate migration IDs (007, 008, 016, 018), out-of-order definitions, and inconsistent transaction strategies. The runtime sort in `runMigrations()` papers over the ordering bugs but doesn't guard against duplicates.

The `bun:sqlite` `Database` type is used directly throughout — no ORM, no query builder. Complex migrations (026–030) need `PRAGMA foreign_keys = OFF` and `BEGIN IMMEDIATE` outside the standard `db.transaction()` wrapper.

## Goals / Non-Goals

**Goals:**
- One `.ts` file per migration under `src/bun/db/migrations/`
- Zero new npm dependencies
- Startup validation: duplicate IDs → hard fail; checksum mismatch → hard fail
- Automatic DB backup before any pending migrations are applied
- Full backward compatibility with existing `schema_migrations` rows in production DBs
- Legacy migrations keep their original string IDs; new migrations use `YYYYMMDDHHMMSS_name` prefix
- `managesTransaction: true` opt-out for migrations that manage their own transaction/pragma lifecycle
- All 35 existing migrations converted to individual files with identical behavior

**Non-Goals:**
- Rollback / down migrations
- ORM or query builder adoption
- Migration CLI tooling (beyond what `runMigrations()` already does)
- Changing any migration's behavior during conversion

## Decisions

### D1 — Custom runner over third-party library (Kysely/umzug)

The project uses `bun:sqlite` raw SQL with no ORM. Kysely would require a dialect wrapper and its own `Kysely<any>` type in every migration file — an unfamiliar API and a new heavyweight dependency. Umzug adds 5 deps for functionality implementable in ~80 lines. A custom runner keeps the `Database` type consistent across the whole backend and gives full control over validation semantics.

### D2 — Filename sort determines application order; exported `id` is the DB identity

Files are sorted alphabetically by filename. Legacy files use `NNN_` prefix (`001_initial.ts` … `031_conversation_pagination_index.ts`); new files use `YYYYMMDDHHMMSS_name.ts`. Since `001` < `031` < `2026…` lexicographically, old migrations always precede new ones with no special casing.

The exported `const id` is what gets recorded in `schema_migrations` — it must match what production DBs already have (e.g. `'001_initial'`). The filename is a stable sort key but not the identity.

### D3 — Checksum stored in `schema_migrations`, NULL-tolerant for existing rows

A `checksum TEXT` column is added to `schema_migrations` in the bootstrap step. For rows already in the table (applied before this system), `checksum` is NULL and checksum validation is skipped. When a new migration is first applied by the new runner, its checksum is stored. On every subsequent boot, if a file's `sha1(up.toString())` differs from the stored value, the runner throws — preventing silent no-ops from edited migration files.

**Backfill strategy**: After applying any pending migrations, the runner backfills checksums for all already-applied migrations that have a corresponding file and a NULL checksum. This means after the first boot with the new runner, all legacy migrations get their checksums populated, and future boots will detect tampering.

### D4 — `managesTransaction` opt-out flag

Migrations that set `PRAGMA foreign_keys = OFF` or use `BEGIN IMMEDIATE` must not be wrapped in `db.transaction()` (SQLite PRAGMAs must run outside transactions, and double-BEGIN causes an error). These migrations export `managesTransaction = true` and are responsible for their own transaction lifecycle and for inserting into `schema_migrations`. The runner detects this flag and skips its default `db.transaction()` wrapper.

### D5 — DB backup: copy-on-first-migration per boot

Before applying any pending migration, the runner copies the DB file to `<path>.backup`. This is a point-in-time snapshot taken once per boot cycle (not per migration). If `RAILYN_DB` is `:memory:`, backup is skipped. The backup silently overwrites any previous backup from the last boot.

### D6 — `seedDefaultWorkspace` extracted to `src/bun/db/seed.ts`

The seed function is not a migration — it creates runtime data, not schema. Extracting it removes the only non-migration concern from the migrations module.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Conversion introduces subtle behavior change in one of the 35 migrations | All converted migrations are moved verbatim. The existing `db-migrations.test.ts` suite runs against the new runner. Each complex migration (026–030) is individually verified. |
| `checksum` based on `up.toString()` is sensitive to whitespace/formatting changes | Checksums are stored on first application. Formatting tools (prettier, etc.) could invalidate stored checksums. Mitigated by noting in CONTRIBUTING that migration files must not be reformatted after being applied. |
| DB backup overwrites previous backup, losing an older snapshot | Accepted trade-off for simplicity. The backup is a last-resort safety net, not an audit trail. A future improvement could add timestamped backups. |
| Alphabetical filename sort breaks if a legacy file is renamed | Files must never be renamed after being applied to any DB. Validated by the checksum system — renaming a file would break the ID→file mapping and the runner would treat it as a new unapplied migration with a duplicate ID. |

## Migration Plan

1. Create `src/bun/db/migrations/runner.ts` with new runner logic
2. Convert all 35 migrations to individual `.ts` files (behavior-identical)
3. Create `src/bun/db/seed.ts` with `seedDefaultWorkspace`
4. Update `src/bun/index.ts` imports
5. Delete `src/bun/db/migrations.ts`
6. Run full test suite; verify `db-migrations.test.ts` passes
7. Deploy — on first boot, runner backs up DB, backfills NULL checksums, applies any pending new migrations

**Rollback**: Not supported by design. The DB backup created at deploy time provides a last-resort restore point.

## Open Questions

*(none — all decisions resolved in exploration)*

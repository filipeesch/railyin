## Why

The current `migrations.ts` is a 1,131-line monolith with 35 inline migrations, 17 if-else dispatch branches, duplicate migration IDs (007, 008, 016, 018 each appear twice), out-of-order definitions saved only by a runtime sort, and no tamper detection. Adding a new migration requires editing this growing file and manually coordinating with every open branch. The risk of shipping a broken or silently skipped migration is high and growing.

## What Changes

- **NEW**: `src/bun/db/migrations/` directory — one `.ts` file per migration
- **NEW**: `src/bun/db/migrations/runner.ts` — custom zero-dependency migration runner (~80 lines) replacing `applyMigration()` and `runMigrations()`
- **NEW**: `checksum` column on `schema_migrations` — Flyway-style tamper detection (fail on mismatch)
- **NEW**: DB file backup created automatically before any migration is applied
- **CHANGED**: All 35 existing migrations converted to individual files, preserving their original IDs (backward compatible with production `schema_migrations` rows)
- **CHANGED**: New migrations use timestamp-prefix filenames (`YYYYMMDDHHMMSS_name.ts`), legacy migrations keep `NNN_name.ts`
- **CHANGED**: `seedDefaultWorkspace` extracted to `src/bun/db/seed.ts`
- **REMOVED**: `src/bun/db/migrations.ts` (deleted after conversion)
- **REMOVED**: The 4 duplicate-ID collisions (`007_shell_command_approval` vs `007_line_comments`, etc.)

## Capabilities

### New Capabilities

- `db-migration-runner`: File-based migration runner with startup validation, checksum enforcement, automatic DB backup, and `managesTransaction` opt-out for complex migrations.

### Modified Capabilities

*(none — no spec-level behavior changes to existing capabilities)*

## Impact

- `src/bun/db/migrations.ts` → deleted (replaced by `runner.ts` + 35 migration files)
- `src/bun/db/index.ts` → unchanged
- `src/bun/index.ts` → import path updated (`runMigrations` from `runner.ts`, `seedDefaultWorkspace` from `seed.ts`)
- `src/bun/test/db-migrations.test.ts` → extended with runner-level integration tests
- No API surface changes, no frontend changes, no new npm dependencies
- `schema_migrations` table gains a nullable `checksum TEXT` column (backward compatible)

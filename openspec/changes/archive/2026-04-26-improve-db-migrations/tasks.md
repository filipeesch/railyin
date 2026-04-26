## 1. Runner infrastructure

- [ ] 1.1 Create `src/bun/db/migrations/runner.ts` with `runMigrations()`: glob `migrations/*.ts`, exclude `runner.ts`, dynamic-import each file, sort by filename, validate no duplicate exported IDs, validate filename sort matches ID sort order
- [ ] 1.2 Add bootstrap logic in `runner.ts`: `CREATE TABLE IF NOT EXISTS schema_migrations`, then `ALTER TABLE schema_migrations ADD COLUMN checksum TEXT` if missing (idempotent)
- [ ] 1.3 Add checksum validation in `runner.ts`: for each already-applied row with non-NULL checksum, compute `sha1(up.toString())` and throw if mismatch
- [ ] 1.4 Add DB backup logic in `runner.ts`: before applying any pending migration, copy `dbPath` to `dbPath + '.backup'`; skip for `:memory:`; skip if no pending migrations
- [ ] 1.5 Add pending migration application loop in `runner.ts`: if `managesTransaction = true` call `up(db)` directly; otherwise wrap in `db.transaction()` + insert `schema_migrations` row with checksum
- [ ] 1.6 Add NULL checksum backfill at end of `runner.ts`: after applying pending migrations, update `checksum` for all applied rows that have `checksum IS NULL` and have a corresponding migration file loaded

## 2. Seed extraction

- [ ] 2.1 Create `src/bun/db/seed.ts` with `seedDefaultWorkspace()` extracted verbatim from `migrations.ts`

## 3. Convert existing migrations to files

- [ ] 3.1 Create `src/bun/db/migrations/` directory and convert migrations `001_initial` through `014_execution_cache_read_tokens` as simple files (SQL only, no special casing)
- [ ] 3.2 Convert `015_workspace_config_key` — uses `hasColumn` guard + index creation
- [ ] 3.3 Convert `016_execution_checkpoints`, `016_task_position`, `017_task_position_backfill` — guard-wrapped SQL
- [ ] 3.4 Convert `018_git_base_sha`, `018_stream_events`, `019_add_parent_block_id`, `020_line_comment_columns` — guard-wrapped SQL
- [ ] 3.5 Convert `021_model_raw_messages`, `022_drop_workspace_project_fks` — complex table rebuilds with `managesTransaction = true`
- [ ] 3.6 Convert `023_text_keys`, `024_todo_v2`, `025_todo_phase` — programmatic data migrations with `managesTransaction = true`
- [ ] 3.7 Convert `026_chat_sessions`, `027_nullable_executions` — `BEGIN IMMEDIATE` migrations with `managesTransaction = true`
- [ ] 3.8 Convert `028_chat_session_mcp_tools`, `029_conversation_stream_cleanup`, `030_stream_events_cleanup`, `031_conversation_pagination_index` — final batch
- [ ] 3.9 Verify all 35 migration files have the exact same exported `id` as their current entry in the `migrations` array (grep check)

## 4. Wire up and remove legacy file

- [ ] 4.1 Update `src/bun/index.ts` to import `runMigrations` from `./db/migrations/runner.ts` and `seedDefaultWorkspace` from `./db/seed.ts`
- [ ] 4.2 Delete `src/bun/db/migrations.ts`

## 5. Tests

- [ ] 5.1 Update `src/bun/test/db-migrations.test.ts`: rewrite existing tests to work against the new runner (import from `runner.ts`)
- [ ] 5.2 Add test: runner discovers and sorts files alphabetically, skipping `runner.ts`
- [ ] 5.3 Add test: runner throws on duplicate exported IDs
- [ ] 5.4 Add test: runner throws on sort-order mismatch between filename and ID
- [ ] 5.5 Add test: checksum stored on first application; unmodified migration passes on re-run
- [ ] 5.6 Add test: modified migration (checksum mismatch) causes hard failure
- [ ] 5.7 Add test: NULL checksum rows are skipped on validation; backfilled after run
- [ ] 5.8 Add test: DB backup created before first pending migration; skipped for `:memory:`; skipped when nothing pending
- [ ] 5.9 Add test: `managesTransaction = true` migration is called without `db.transaction()` wrapper
- [ ] 5.10 Run full backend test suite (`bun test src/bun/test --timeout 20000`) and confirm all pass

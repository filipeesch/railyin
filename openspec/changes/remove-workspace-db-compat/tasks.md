## 1. DB migration — drop FK constraints and legacy tables

- [x] 1.1 Add migration `018_drop_workspace_project_fks` in `src/bun/db/migrations.ts` that recreates `boards` without `REFERENCES workspaces(id)` and `tasks` without `REFERENCES projects(id)`, copies all rows, drops the originals, renames the new tables, and finally drops the `workspaces` and `projects` tables — all inside a transaction with `PRAGMA foreign_keys = OFF`
- [x] 1.2 Restore all indexes that existed on `boards` (`idx_tasks_board`) and `tasks` (`idx_tasks_project`) in the new table definitions, and restore the `task_git_context` FK to `tasks(id)` which should stay intact
- [x] 1.3 Verify the migration is idempotent: `CREATE TABLE IF NOT EXISTS` guards on the new tables, `DROP TABLE IF EXISTS` on the old ones

## 2. Remove compat-sync exports and callers

- [x] 2.1 Delete `syncConfiguredWorkspaces`, `syncConfiguredProjects`, and `syncFileBackedCompatibilityState` functions from `src/bun/db/migrations.ts`
- [x] 2.2 Remove the `syncFileBackedCompatibilityState` import and call from `src/bun/handlers/boards.ts`
- [x] 2.3 Remove the `syncFileBackedCompatibilityState` import and call from `src/bun/handlers/tasks.ts`
- [x] 2.4 Remove the `syncFileBackedCompatibilityState` import and call from `src/bun/handlers/projects.ts`
- [x] 2.5 Remove the `syncFileBackedCompatibilityState` import and call from `src/bun/engine/common-tools.ts`
- [x] 2.6 Remove the `syncFileBackedCompatibilityState` import and call from `src/bun/workflow/tools.ts`
- [x] 2.7 Remove the `syncFileBackedCompatibilityState` call from `src/bun/index.ts` startup

## 3. Rewrite seedDefaultWorkspace for in-memory test boot

- [x] 3.1 Rewrite `seedDefaultWorkspace()` in `src/bun/db/migrations.ts` to insert a test board directly into the `boards` table using the hash-derived workspace ID, without inserting any row into the (now-dropped) `workspaces` or `projects` tables
- [x] 3.2 Verify the in-memory test boot (`:memory:` DB) still creates a board and the app reaches `BoardView` without errors

## 4. Remove legacy DB fallback from project-store.ts

- [x] 4.1 Delete `legacyProjectRowToProject`, `getLegacyProjectById`, and the `ProjectRow` import from `src/bun/project-store.ts`
- [x] 4.2 Simplify `listProjects()` to return only `listFileBackedProjects()` — remove the DB merge loop and the `try/catch` around the legacy table query
- [x] 4.3 Simplify `getProjectById()` to search only file-backed configs — remove the `getLegacyProjectById` fallback call

## 5. Remove dead DB type and mapper code

- [x] 5.1 Delete `WorkspaceRow` and `ProjectRow` interfaces from `src/bun/db/row-types.ts`
- [x] 5.2 Delete the `mapProject` function and `ProjectRow` import from `src/bun/db/mappers.ts`

## 6. Delete workspace-storage-migration files

- [x] 6.1 Delete `src/bun/workspace-storage-migration.ts` entirely
- [x] 6.2 Delete `src/bun/test/workspace-storage-migration.test.ts` entirely

## 7. Update tests

- [x] 7.1 Remove the two obsolete compat-sync tests from `src/bun/test/db-migrations.test.ts` (`"syncs file-backed workspaces into the compatibility workspaces table"` and `"syncs file-backed projects into the compatibility projects table so FK-dependent writes succeed"`)
- [x] 7.2 Remove the `syncConfiguredProjects` and `syncConfiguredWorkspaces` imports from `src/bun/test/db-migrations.test.ts`
- [x] 7.3 Add a new test to `src/bun/test/db-migrations.test.ts` confirming that after `runMigrations()`, a board row can be inserted with an arbitrary `workspace_id` and a task row with an arbitrary `project_id` without any compat rows existing in the DB
- [x] 7.4 Run the full backend test suite (`bun test src/bun/test --timeout 20000`) and confirm all tests pass

## 8. Manual smoke check

- [x] 8.1 Start the app against a real user DB and verify existing boards and tasks are visible and functional
- [x] 8.2 Create a new board and task — confirm no FK errors in logs
- [x] 8.3 Register a new project — confirm no FK errors in logs
- [x] 8.4 Start a task execution — confirm it runs without errors related to workspace/project resolution

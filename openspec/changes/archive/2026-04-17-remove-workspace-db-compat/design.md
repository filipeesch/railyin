## Context

The multi-workspace change moved workspaces and projects to `~/.railyin/workspaces/` YAML files and introduced hash-derived stable IDs (`getWorkspaceIdForKey`, `getProjectIdForKey`). However, it stopped short of removing the DB dependency: `boards.workspace_id` still has a FK to `workspaces(id)`, and `tasks.project_id` still has a FK to `projects(id)`. A compatibility sync (`syncFileBackedCompatibilityState`) mirrors the file state into those tables before every write to satisfy the constraints.

The key insight is that the IDs themselves are already deterministic and file-derived — no random AUTOINCREMENT. The FK constraints are the only remaining reason the mirror tables need to exist.

```
getWorkspaceIdForKey("default")       → 1
getWorkspaceIdForKey("my-ws")         → SHA1("workspace:my-ws")[0..12]
getProjectIdForKey("my-ws", "api")    → SHA1("project:my-ws:api")[0..12]
```

Removing the FK constraints is therefore safe: the integer values stored in `boards.workspace_id` and `tasks.project_id` remain valid workspace/project references — they just do not need a row in a mirror table to be meaningful.

## Goals / Non-Goals

**Goals**

- Remove FK constraints from `boards.workspace_id` and `tasks.project_id`
- Drop the `workspaces` and `projects` tables
- Remove all compat-sync call sites and their supporting functions
- Remove the `workspace-storage-migration.ts` one-time migration file
- Remove the legacy DB fallback in `project-store.ts`
- Keep all existing board/task/execution data intact — zero data loss
- Keep `enabled_models.workspace_id` as a plain INTEGER (it already has no FK — no change needed)

**Non-Goals**

- Changing workspace or project identity schemes (hash-derived IDs stay)
- Moving `enabled_models`, `boards`, `tasks`, or executions out of SQLite
- Changing any frontend stores, RPC types, or workflow engine behavior
- Handling "orphaned task" UX — that is a future concern

## Decisions

### D1: SQLite table recreation for FK removal

SQLite does not support `ALTER TABLE ... DROP CONSTRAINT`. Removing a FK requires:
1. Disable FK enforcement with `PRAGMA foreign_keys = OFF`
2. Create a new version of the table without the FK
3. Copy all rows
4. Drop the original
5. Rename
6. Re-enable FK enforcement

This applies to both `boards` and `tasks`. The migration must handle all existing columns faithfully, including indexes.

**Migration ID sequence:** The next migration ID is `018_drop_workspace_project_fks`. It will:
- Recreate `boards` without `REFERENCES workspaces(id)`
- Recreate `tasks` without `REFERENCES projects(id)`
- Drop the `workspaces` table
- Drop the `projects` table

### D2: Compat sync removed at the call site, not wrapped

`syncFileBackedCompatibilityState()` is called in five places:
- `src/bun/handlers/boards.ts` — `boards.create`
- `src/bun/handlers/tasks.ts` — `tasks.create`
- `src/bun/handlers/projects.ts` — `projects.register`
- `src/bun/engine/common-tools.ts` — agent `create_task` tool
- `src/bun/workflow/tools.ts` — agent `register_project` tool

Each call site should simply have the sync line removed. No wrapper or flag needed.

### D3: Startup sync and seed removed cleanly

`src/bun/index.ts` calls both `syncFileBackedCompatibilityState()` and `seedDefaultWorkspace()` at startup. After the migration:
- `syncFileBackedCompatibilityState()` call is removed entirely
- `seedDefaultWorkspace()` must be rewritten: it currently inserts compat rows for in-memory test boot. The replacement should just ensure a test board exists using direct DB inserts that no longer need workspace/project FK rows.

The in-memory test board creation does not need a `projects` row — it can insert a board referencing a hash-derived workspace ID and a task referencing a hash-derived project ID directly.

### D4: Legacy project-store fallback removed

`project-store.ts` has a two-layer lookup: file-backed first, then DB fallback for rows that were not found in files. After the tables are dropped, the fallback must be removed:

- `listProjects()` returns only file-backed projects
- `getProjectById()` returns only file-backed projects (returns `null` if not in files)

The `legacyProjectRowToProject` helper and `getLegacyProjectById` function are deleted.

The `mapProject` function in `db/mappers.ts` and `ProjectRow` / `WorkspaceRow` types in `db/row-types.ts` are dead code after the table drop and should be removed.

### D5: workspace-storage-migration.ts deleted

`workspace-storage-migration.ts` is the one-time migration script that moved data from DB to files. It is no longer needed (no DB tables to read from) and should be deleted in full. Its test file `workspace-storage-migration.test.ts` is also deleted.

The `migrateLegacyWorkspaceStorage` function is only imported in its own test, so there are no other callers to clean up.

### D6: db-migrations.test.ts updated

The test assertions that verify compat-sync behavior become obsolete. Specifically:
- `"syncs file-backed workspaces into the compatibility workspaces table"` → remove
- `"syncs file-backed projects into the compatibility projects table so FK-dependent writes succeed"` → remove
- `"does not fail when config_key already exists but migration 015 is not recorded"` → keep (it still validates idempotent migration application)

A new test should confirm that after running migrations, `boards` and `tasks` tables exist without FK constraints referencing dropped tables, and that inserting a board/task with an arbitrary workspace/project ID succeeds without a compat row.

## Migration safety

The migration runs in a transaction with FK enforcement disabled. The row data in `boards` and `tasks` is preserved exactly. Users with existing data will have their boards and tasks remain functional — the integer IDs in those rows already correctly encode workspace/project identity. No rollback script is needed because the migration only removes constraints and drops now-empty mirror tables; if re-applied, `CREATE TABLE IF NOT EXISTS` guards make it idempotent.

## Affected files

```
src/bun/db/migrations.ts               add migration 018, remove compat sync exports
src/bun/db/row-types.ts                remove WorkspaceRow, ProjectRow
src/bun/db/mappers.ts                  remove mapProject
src/bun/project-store.ts               remove legacy DB fallback
src/bun/workspace-context.ts           no change needed
src/bun/workspace-storage-migration.ts DELETE entire file
src/bun/index.ts                       remove syncFileBackedCompatibilityState call, rewrite seedDefaultWorkspace
src/bun/handlers/boards.ts             remove syncFileBackedCompatibilityState call
src/bun/handlers/tasks.ts              remove syncFileBackedCompatibilityState call
src/bun/handlers/projects.ts           remove syncFileBackedCompatibilityState call
src/bun/engine/common-tools.ts         remove syncFileBackedCompatibilityState call
src/bun/workflow/tools.ts              remove syncFileBackedCompatibilityState call
src/bun/test/db-migrations.test.ts     update/remove obsolete compat assertions, add new FK-free test
src/bun/test/workspace-storage-migration.test.ts  DELETE entire file
```

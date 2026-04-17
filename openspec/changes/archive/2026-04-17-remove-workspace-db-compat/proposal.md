## Why

The migration from DB-backed workspaces and projects to file-backed storage landed in the multi-workspace change, but the runtime was not fully cut over. A compatibility sync layer still mirrors `~/.railyin/workspaces/` state into SQLite `workspaces` and `projects` tables on every meaningful write, and both tables still hold foreign key constraints that `boards` and `tasks` depend on. This means:

- Every `boards.create`, `tasks.create`, `projects.register`, and agent `create_task` / `register_project` tool call starts with a sync that rewrites DB rows from files.
- Any drift between the file state and the DB mirror—caused by manual edits, a failed sync, or a future migration—silently corrupts FK constraints and breaks task creation.
- The `workspaces` and `projects` tables are no longer source of truth, yet they still determine whether a write succeeds or fails.

The goal of this change is to complete the migration: remove the FK constraints, stop syncing compatibility rows, and delete the two legacy tables once they are no longer referenced.

## What Changes

- Drop the FK constraint from `boards.workspace_id → workspaces(id)` and from `tasks.project_id → projects(id)` via a DB migration that recreates those tables without the constraints.
- Remove all call sites of `syncFileBackedCompatibilityState()` across handlers, tools, and startup.
- Drop the `workspaces` and `projects` tables and remove all DB reads/writes that target them.
- Simplify `project-store.ts` by removing the legacy DB fallback in `listProjects()` and `getProjectById()`.
- Remove the `workspace-storage-migration.ts` file and its call site in startup, since the one-time migration from DB to file is long complete.
- Remove `seedDefaultWorkspace()` in-memory test seeding that inserts compat rows, replacing it with direct file-backed setup.
- Keep boards, tasks, executions, messages, hunk decisions, line comments, pending messages, task todos, enabled models, and logs DB-backed and stable throughout.

## Capabilities

### Modified Capabilities
- `workspace`: runtime no longer depends on DB rows; workspace identity is fully file-derived
- `project`: project lookup and registration uses only file-backed state; no DB fallback
- `board`: `boards.workspace_id` becomes a plain INTEGER with no FK; creation no longer requires a compat sync
- `task`: `tasks.project_id` becomes a plain INTEGER with no FK; creation no longer requires a compat sync

## Impact

- DB migration in `src/bun/db/migrations.ts` recreating `boards` and `tasks` tables without FK constraints (SQLite requires table recreation to drop constraints)
- Removal of `syncFileBackedCompatibilityState`, `syncConfiguredWorkspaces`, `syncConfiguredProjects` from `migrations.ts` and all callers
- Removal of `workspace-storage-migration.ts` (entire file)
- Simplification of `project-store.ts` (remove legacy DB fallback)
- Simplification of `seedDefaultWorkspace()` or its replacement in test/in-memory boot
- Updated DB-migration tests to remove compat-sync assertions
- No changes to frontend stores, RPC types, or workflow engine

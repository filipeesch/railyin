## Context

After removing the FK-backed `workspaces`/`projects` mirror tables (migration 018), `boards.workspace_id` and `tasks.project_id` still store hash-derived integers (`stableNumericId`). These integers are opaque — readable only by reversing the hash — and the helper functions that produce them exist solely to bridge the gap between file keys and integer DB IDs. With no FK constraint left to satisfy, the integers serve no purpose over plain text keys.

`enabled_models.workspace_id` has the same problem: it uses the same hash-derived integer.

## Goals / Non-Goals

**Goals:**
- Replace `workspace_id INTEGER` with `workspace_key TEXT` on `boards` and `enabled_models`
- Replace `project_id INTEGER` with `project_key TEXT` on `tasks`
- Backfill all existing rows using the known workspace/project configs at migration time
- Remove `stableNumericId`, `getWorkspaceIdForKey`, `getProjectIdForKey` from config once unused
- Update all read/write paths and RPC types to use text keys

**Non-Goals:**
- Changing the file-store format or workspace/project config structure
- Altering other DB tables (executions, messages, reviews, task_git_context)
- Adding any new runtime sync logic

## Decisions

### Backfill strategy
Migration 019 reads the current workspace/project config from YAML files at migration time and builds a reverse map `integer_id → key`. Any rows with a hash that doesn't match a known workspace/project get the literal string `"unknown"` to avoid a NOT NULL failure. This is safe because the hash function is deterministic and all existing users will have matching configs.

**Alternative considered:** Use a nullable column and leave orphaned rows as NULL. Rejected — downstream code would need null-guards everywhere; `"unknown"` is simpler and surfaceable.

### Column rename vs new column
SQLite requires table recreation to rename or retype a column (before SQLite 3.25 — Bun's bundled SQLite is recent enough, but the recreation pattern is already established in migrations 017/018). Migration 019 follows the same programmatic recreation pattern used in migration 018: create new tables, copy data with the mapped values, drop old, rename.

### `project_ids TEXT` on `boards`
`boards.project_ids` is already a JSON array of integers. It changes to a JSON array of project key strings. The format stays JSON; only the element type changes.

### Removing stableNumericId helpers
Once migration 019 is applied and all call sites are updated to pass text keys directly, `stableNumericId`, `getWorkspaceIdForKey`, and `getProjectIdForKey` can be deleted from `config/index.ts`.

## Risks / Trade-offs

- **Existing data with unknown IDs** → Mitigation: `"unknown"` sentinel; log a warning during migration so operators can investigate
- **RPC type change is breaking for any external client** → Mitigation: this is a single-user desktop app; no external versioned API
- **Test helper churn** → Mitigation: `seedProjectAndTask` and `initDb` already reference text keys via `getProjectIdForKey`; updating to pass strings directly simplifies the helpers

## Migration Plan

1. Apply migration 019 (programmatic, `PRAGMA foreign_keys = OFF` outside transaction)
2. All column writes updated to use text keys — no separate deploy step needed (single binary)
3. Rollback: not supported for SQLite schema changes; users on older builds would need to restore from backup — same risk as all prior migrations, acceptable for a single-user desktop app

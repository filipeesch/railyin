## 1. DB migration — rename integer columns to text keys

- [x] 1.1 Add migration `019_use_text_keys` in `src/bun/db/migrations.ts`. Programmatic migration (like 018) that:
  - Builds a reverse map `numeric_id → workspace_key` from live workspace config at migration time
  - Recreates `boards` with `workspace_key TEXT NOT NULL DEFAULT 'default'` instead of `workspace_id INTEGER`; backfills from the reverse map
  - Recreates `tasks` with `project_key TEXT NOT NULL DEFAULT 'unknown'` instead of `project_id INTEGER`; backfills by joining through boards to workspace config
  - Recreates `enabled_models` with `workspace_key TEXT NOT NULL DEFAULT 'default'` instead of `workspace_id INTEGER`; backfills from the reverse map
  - `project_ids TEXT` on `boards` changes from JSON array of integers to JSON array of project key strings; backfills by reading each project config
  - Drops old tables, renames new tables
  - Runs with `PRAGMA foreign_keys = OFF` outside the transaction (same pattern as migration 018)
- [x] 1.2 Update the initial schema in `src/bun/db/migrations.ts` (the `CREATE TABLE boards/tasks/enabled_models` SQL strings used for fresh installs) to use the new text-key columns so new installs don't start with the old integer schema

## 2. Update DB row types and mappers

- [x] 2.1 In `src/bun/db/row-types.ts`: change `BoardRow.workspace_id: number` → `workspace_key: string`; change `TaskRow.project_id: number` → `project_key: string`; change `project_ids: string` comment to reflect JSON string array; update `EnabledModelsRow.workspace_id: number` → `workspace_key: string`
- [x] 2.2 In `src/bun/db/mappers.ts`: update `mapBoard` to use `row.workspace_key` → `workspaceKey`; update `mapTask` to use `row.project_key` → `projectKey`

## 3. Update RPC types

- [x] 3.1 In `src/shared/rpc-types.ts`: rename `Board.workspaceId: number` → `workspaceKey: string`; rename `Board.projectIds: number[]` → `projectKeys: string[]`; rename `Task.projectId: number` → `projectKey: string`
- [x] 3.2 Update all RPC param types that pass `workspaceId: number` → `workspaceKey: string` or `projectId: number` → `projectKey: string`

## 4. Update handlers

- [x] 4.1 `src/bun/handlers/boards.ts`: change all reads/writes of `workspace_id` → `workspace_key`; change `getWorkspaceConfigById(row.workspace_id)` to `getWorkspaceConfig(row.workspace_key)`; update INSERT to write `workspace_key`; update `project_ids` JSON serialization to string arrays
- [x] 4.2 `src/bun/handlers/tasks.ts`: change all reads/writes of `project_id` → `project_key`; change `getProjectById(row.project_id)` to `getProjectByKey(workspaceKey, row.project_key)`; update INSERT to write `project_key`; update enabled_models queries to use `workspace_key`
- [x] 4.3 `src/bun/handlers/launch.ts`: change `getProjectById(taskRow.project_id)` → `getProjectByKey` using workspace context
- [x] 4.4 `src/bun/handlers/projects.ts`: update any project_id or workspace_id references

## 5. Update engine and workflow tools

- [x] 5.1 `src/bun/workflow/engine.ts`: change `getProjectById(task.project_id)` → `getProjectByKey`
- [x] 5.2 `src/bun/workflow/tools.ts`: change `project_id` tool params to `project_key`; update DB queries; change `parseInt(args.project_id)` → use string directly; update `INSERT INTO tasks` to write `project_key`
- [x] 5.3 `src/bun/engine/common-tools.ts`: same changes as 5.2 for the duplicate tool definitions

## 6. Update workspace-context and config helpers

- [x] 6.1 `src/bun/workspace-context.ts`: change DB query to read `workspace_key` from `boards`; update return type
- [x] 6.2 `src/bun/config/index.ts`: add `getWorkspaceConfig(key: string)` lookup if not present; add `getProjectByKey(workspaceKey: string, projectKey: string)` lookup; remove `stableNumericId`, `getWorkspaceIdForKey`, `getProjectIdForKey` once all call sites are gone
- [x] 6.3 `src/bun/project-store.ts`: update `getProjectById` → `getProjectByKey(workspaceKey, projectKey)` or remove `getProjectById` if no longer called

## 7. Update index.ts test-mode seeding

- [x] 7.1 `src/bun/index.ts`: update test-mode board INSERT to write `workspace_key`; update task INSERT to write `project_key`; update `enabled_models` INSERT to write `workspace_key`; update `SELECT workspace_key FROM boards` query

## 8. Update test helpers and tests

- [x] 8.1 `src/bun/test/helpers.ts`: update `initDb()` to create tables with text-key columns; update `seedProjectAndTask()` to insert `project_key` string directly instead of calling `getProjectIdForKey`
- [x] 8.2 `src/bun/test/handlers.test.ts`: update any hardcoded `project_id`/`workspace_id` references; update the worktree-failure test board/task INSERT
- [x] 8.3 `src/bun/test/db-migrations.test.ts`: add test verifying migration 019 produces text-key columns; update existing FK-free test to use text keys

## 9. Run tests and clean up

- [x] 9.1 Run `bun test src/bun/test --timeout 20000`; fix any failures
- [x] 9.2 Delete `stableNumericId`, `getWorkspaceIdForKey`, `getProjectIdForKey` from `src/bun/config/index.ts` once confirmed unused
- [x] 9.3 Run tests again to confirm only the 2 pre-existing failures remain

## 10. Frontend migration — remove all numeric workspace/project IDs from UI

- [x] 10.1 Remove `id: number` from `WorkspaceSummary` in `src/shared/rpc-types.ts`
- [x] 10.2 Rewrite `src/mainview/stores/workspace.ts`: `activeWorkspaceId → activeWorkspaceKey`, remove `normalizeWorkspaceId`, update all call sites
- [x] 10.3 `src/mainview/stores/board.ts`: `createBoard(workspaceKey)`, `selectFirstBoardInWorkspace(workspaceKey)`
- [x] 10.4 `src/mainview/stores/project.ts`: `registerProject({ workspaceKey })`
- [x] 10.5 `src/mainview/stores/task.ts`: `createTask({ projectKey })`, `loadEnabledModels/loadAllModels/setModelEnabled(workspaceKey)`
- [x] 10.6 `src/mainview/components/WorkflowEditorOverlay.vue`: prop `workspaceKey?: string`
- [x] 10.7 `src/mainview/components/ModelTreeView.vue`: prop `workspaceKey?: string`, `effectiveWorkspaceKey`
- [x] 10.8 `src/mainview/components/ManageModelsModal.vue`: prop `workspaceKey?: string`
- [x] 10.9 `src/mainview/components/TaskDetailDrawer.vue`: `board.workspaceKey` lookup
- [x] 10.10 `src/mainview/views/BoardView.vue`: all `workspaceId` → `workspaceKey`, workspace tabs, board filtering
- [x] 10.11 `src/mainview/views/SetupView.vue`: select option-value=key, all `workspaceId` → `workspaceKey`
- [x] 10.12 `src/mainview/App.vue`: workspace lookup by key
- [x] 10.13 Build and verify: `bun run build:canary`

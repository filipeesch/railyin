## Why

`boards.workspace_id` and `tasks.project_id` store hash-derived integers that are opaque — you cannot read a DB row and know which workspace or project it belongs to without reversing the hash. Now that the FK-backed mirror tables are gone, there is no reason to keep integers; text keys are the natural, self-documenting identifier.

## What Changes

- **BREAKING** `boards.workspace_id INTEGER` → `boards.workspace_key TEXT`
- **BREAKING** `tasks.project_id INTEGER` → `tasks.project_key TEXT`
- `enabled_models.workspace_id INTEGER` → `enabled_models.workspace_key TEXT`
- DB migration 019 backfills text keys from file config by reverse-mapping the existing hash integers, then drops the old integer columns
- All read/write paths updated to use the new text column names and types
- `getWorkspaceIdForKey` / `getProjectIdForKey` / `stableNumericId` helpers removed from config once no longer needed
- RPC types updated: `workspaceId: number` → `workspaceKey: string`, `projectId: number` → `projectKey: string`

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `workspace`: column rename and type change; lookup by key instead of numeric id
- `project`: column rename and type change; lookup by key instead of numeric id
- `board`: `workspace_id` replaced by `workspace_key`
- `task`: `project_id` replaced by `project_key`

## Impact

- `src/bun/db/migrations.ts` — migration 019, schema definitions
- `src/bun/db/row-types.ts` — BoardRow, TaskRow, EnabledModelsRow
- `src/bun/db/mappers.ts` — mapBoard, mapTask
- `src/bun/handlers/boards.ts`, `tasks.ts`, `projects.ts`
- `src/bun/handlers/launch.ts`
- `src/bun/workflow/engine.ts`, `tools.ts`
- `src/bun/engine/common-tools.ts`
- `src/bun/workspace-context.ts`
- `src/bun/config/index.ts` — remove stableNumericId helpers after migration
- `src/shared/rpc-types.ts` — Board, Task, RPC param types
- `src/bun/index.ts` — test-mode board/task seeding
- `src/bun/test/helpers.ts`, `handlers.test.ts` — test infra

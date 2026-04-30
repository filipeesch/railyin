## Why

The Boards tab in SetupView currently only allows creating a board — there is no way to rename a board, delete it, change its workflow template, or reassign projects to it from the UI. This forces users to manipulate the database or restart to correct board configuration, and the read-only list provides no actionable controls.

## What Changes

- **Board list**: Replace the read-only name list with an actionable list (Edit + Delete buttons per row), consistent with the Projects tab pattern
- **Board create/edit dialog** (`BoardDetailDialog.vue`): New dialog supporting both create and edit modes — fields: name, workflow template (native `<select>`), project assignment (checkbox list)
- **Boards tab extraction** (`BoardSetupTab.vue`): Extract all board tab logic out of `SetupView.vue` into a dedicated component for SRP compliance
- **Inline workflow-change warning**: When editing a board with existing tasks and the workflow template is changed, show a non-blocking inline warning about potential task orphaning
- **Delete guard — blocked with toast**: Delete is blocked (toast notification) if the board has tasks; only empty boards show a confirm dialog
- **`boards.update` RPC**: New backend endpoint to rename a board, change its workflow template, and reassign project keys
- **`boards.delete` RPC**: New backend endpoint; throws if the board has tasks (double guard); empty boards are deleted immediately
- **DI cleanup**: `boardHandlers(db)` refactored to `boardHandlers()` using `getDb()` internally — consistent with all other handler modules
- **`taskCount` on Board**: `boards.list` (and `boards.update`) returns a `taskCount: number` field via SQL `LEFT JOIN COUNT`. Enables reliable pre-flight checks (delete toast guard, workflow-change warning) independent of whether the board was previously loaded in the task store

## Capabilities

### New Capabilities

- `board-management`: Full CRUD for boards from the Setup UI — create, rename, change workflow template, reassign projects, delete (with task guard)

### Modified Capabilities

- `board`: Board requirements extended to include board lifecycle management (create/update/delete RPC contracts and UI behavior)

## Impact

- **Frontend**: `SetupView.vue` (board tab gutted, ~80 lines removed), new `BoardSetupTab.vue`, new `BoardDetailDialog.vue`, `src/mainview/stores/board.ts` (updateBoard + deleteBoard actions)
- **Backend**: `src/bun/handlers/boards.ts` (update + delete handlers, DI fix, LEFT JOIN count on boards.list), `src/bun/index.ts` (call site update), `src/bun/db/mappers.ts` (mapBoard includes taskCount)
- **RPC contract**: `src/shared/rpc-types.ts` — `Board` interface gains `taskCount: number`; two new method entries: `boards.update`, `boards.delete`
- **No DB migration needed**: delete uses explicit SQL guard; no schema changes required

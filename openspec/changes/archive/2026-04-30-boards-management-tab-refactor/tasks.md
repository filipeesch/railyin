## 0. Foundation — taskCount on Board

- [x] 0.1 Add `taskCount: number` to the `Board` interface in `src/shared/rpc-types.ts`
- [x] 0.2 Update `boards.list` SQL in `src/bun/handlers/boards.ts` to `SELECT b.*, COUNT(t.id) as task_count FROM boards b LEFT JOIN tasks t ON t.board_id = b.id GROUP BY b.id ORDER BY b.created_at ASC`; cast row as `BoardRow & { task_count: number }`
- [x] 0.3 Update `mapBoard()` in `src/bun/db/mappers.ts` to accept `taskCount?: number` and include it in the returned `Board`

## 1. RPC Contract

- [x] 1.1 Add `boards.update` type to `src/shared/rpc-types.ts` — params `{ id: number; name?: string; workflowTemplateId?: string; projectKeys?: string[] }`, response `Board`
- [x] 1.2 Add `boards.delete` type to `src/shared/rpc-types.ts` — params `{ id: number }`, response `Record<string, never>`

## 2. Backend Handler

- [x] 2.1 Refactor `boardHandlers(db: Database)` to `boardHandlers()` using `getDb()` internally in `src/bun/handlers/boards.ts`
- [x] 2.2 Update call site in `src/bun/index.ts`: change `boardHandlers(db)` to `boardHandlers()`
- [x] 2.3 Implement `boards.update` handler — validate workflowTemplateId exists in workspace config, run `UPDATE boards SET ...` for provided fields, return updated board via `mapBoard`
- [x] 2.4 Implement `boards.delete` handler — query `COUNT(*) FROM tasks WHERE board_id = ?`, throw if count > 0, otherwise `DELETE FROM boards WHERE id = ?`

## 3. Board Store

- [x] 3.1 Add `updateBoard(id: number, params: { name?: string; workflowTemplateId?: string; projectKeys?: string[] })` to `src/mainview/stores/board.ts` — calls `api("boards.update", ...)` then `loadBoards()`
- [x] 3.2 Add `deleteBoard(id: number)` to `src/mainview/stores/board.ts` — calls `api("boards.delete", ...)`, filters board from `boards.value`, resets `activeBoardId` if deleted board was active

## 4. BoardDetailDialog Component

- [x] 4.1 Create `src/mainview/components/BoardDetailDialog.vue` with props `{ modelValue: boolean; workspaceKey: string; board?: BoardWithTemplate }`
- [x] 4.2 Implement form with name `InputText`, workflow native `<select>` (loaded from `api("workspace.getConfig")`), and project checkbox list (filtered from `projectStore.projects` by `workspaceKey`)
- [x] 4.3 Emit `save({ name, workflowTemplateId, projectKeys[] })` on confirm; expose `setSaving(bool)` and `setSaveError(msg | null)` for parent-controlled async state
- [x] 4.4 Add inline workflow-change warning: visible when `isEdit && workflowTemplateId !== originalTemplateId && hasTasks`

## 5. BoardSetupTab Component

- [x] 5.1 Create `src/mainview/components/BoardSetupTab.vue` — reads `boardStore`, `taskStore`, `projectStore`, `workspaceStore` directly (no props)
- [x] 5.2 Implement board list using existing `project-list` / `project-item` CSS classes — each row shows board name, workflow template name, Edit and Delete icon buttons
- [x] 5.3 Implement "Add board" button (top-right) that opens `BoardDetailDialog` in create mode
- [x] 5.4 Implement Edit flow: open `BoardDetailDialog` in edit mode → on save call `boardStore.updateBoard` via `setSaving/setSaveError` pattern
- [x] 5.5 Implement Delete flow: if `board.taskCount > 0` show warning toast; otherwise show inline confirm dialog → on confirm call `boardStore.deleteBoard`
- [x] 5.6 Move `loadWorkflowOptions` and `setWorkflowOptions` logic from `SetupView.vue` into `BoardSetupTab.vue`; add `watch(activeWorkspaceKey)` inside `BoardSetupTab` to reload options on workspace switch

## 6. SetupView Cleanup

- [x] 6.1 Replace the Boards `TabPanel` body in `SetupView.vue` with `<BoardSetupTab />`
- [x] 6.2 Remove board-specific state from `SetupView.vue`: `boardName`, `boardWorkflowTemplateId`, `boardSaving`, `boardError`, `workflowOptions`, `workflowOptionsKey`
- [x] 6.3 Remove board-specific functions from `SetupView.vue`: `loadWorkflowOptions`, `setWorkflowOptions`, `createBoard`
- [x] 6.4 Remove the `loadWorkflowOptions` call from the `watch(activeWorkspaceKey)` watcher in `SetupView.vue`
- [x] 6.5 Add `import BoardSetupTab from "../components/BoardSetupTab.vue"` to `SetupView.vue`

## 7. Verification

- [x] 7.1 Run `bun run build` and confirm no TypeScript errors
- [x] 7.2 Run `bun test src/bun/test --timeout 20000` and confirm no regressions

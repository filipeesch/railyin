## 1. Config Types

- [ ] 1.1 Add `limit?: number` to `WorkflowColumnConfig` in `src/bun/config/index.ts`
- [ ] 1.2 Add `WorkflowColumnGroup` interface and `groups?: WorkflowColumnGroup[]` to `WorkflowTemplateConfig` in `src/bun/config/index.ts`
- [ ] 1.3 Mirror `limit` and `groups` additions to `WorkflowColumn` and `WorkflowTemplate` in `src/shared/rpc-types.ts`
- [ ] 1.4 Map `limit` and `groups` in the config loader so they are present in `LoadedConfig.workflows`

## 2. Position Rebalancing

- [ ] 2.1 Extract `rebalanceColumnPositions(db, boardId, columnId)` helper in `src/bun/handlers/tasks.ts` that rewrites all column positions as `1000, 2000, 3000, …` in current sort order
- [ ] 2.2 Call `rebalanceColumnPositions` after every position write in `tasks.reorder` and `tasks.transition` when the minimum adjacent gap drops below `1.0`

## 3. Card Limit Enforcement (Backend)

- [ ] 3.1 In `tasks.transition` handler (`src/bun/handlers/tasks.ts`), count cards in target column and return an error response if count >= `column.limit`
- [ ] 3.2 In `move_task` agent tool (`src/bun/workflow/tools.ts`), perform the same count check and return a string error message if the limit is exceeded

## 4. Board Rendering — Column Groups

- [ ] 4.1 Add a `renderSlots` computed in `src/mainview/views/BoardView.vue` that derives the ordered list of render slots by walking the `columns` array: a slot is either `{ type: 'standalone', column }` or `{ type: 'group', columns[] }` (first encounter of a grouped column emits the group)
- [ ] 4.2 Update the board template to iterate `renderSlots` instead of `activeBoard.template.columns`, rendering group slots as a wrapper div containing stacked sub-columns each with `[data-column-id]`
- [ ] 4.3 Ensure the group wrapper div does NOT carry `[data-column-id]` to avoid false positive drop targeting

## 5. Card Limit — UI Enforcement

- [ ] 5.1 Add `columnAtCapacity(columnId)` computed that returns true when `columnTasks(id).length >= column.limit` and `column.limit` is set
- [ ] 5.2 In `onPointerMove`, apply a `is-drag-over--full` class when the hovered column is at capacity
- [ ] 5.3 In `onPointerUp`, skip the API call and return the card to its origin when the target column `columnAtCapacity` is true
- [ ] 5.4 Update badge rendering: show `count/limit` format and apply error colour class when at capacity; show plain count when no limit is set
- [ ] 5.5 Add CSS for `.board-column.is-drag-over--full` (red dashed outline) and `.board-column__badge--full` (error colour)

## 6. Optimistic Drag-and-Drop

- [ ] 6.1 In `onPointerUp` (`src/mainview/views/BoardView.vue`), move ghost removal and `sourceEl.style.opacity = ''` to execute synchronously before the `transitionTask` / `reorderTask` call (fire-and-forget; error path already reverts via `_replaceTask`)

## 7. Tests & Validation

- [x] 7.1 Add unit tests for `rebalanceColumnPositions` in `src/bun/test/`
- [x] 7.2 Add unit tests for card limit enforcement in `tasks.transition` and `move_task`
- [x] 7.3 Update `config/workflows/delivery.yaml` and `config/workflows/openspec.yaml` with example `groups` to verify YAML parsing end-to-end
- [x] 7.4 Write and run e2e tests for board-column-groups

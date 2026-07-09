## 1. Selection state composable

- [ ] 1.1 Create `src/mainview/composables/useCardSelection.ts` with `isSelectionMode`, `selectedIds`, `selectedCount`, `enterSelectionMode`, `exitSelectionMode`, `toggleSelection`, `clearSelection`, and `isSelected`.
- [ ] 1.2 Add unit tests `src/mainview/composables/useCardSelection.test.ts` covering enter/exit, toggle, clear, and selectedCount.

## 2. TaskCard selection UI

- [ ] 2.1 Add `selectable`, `selected`, and `selectableTaskId` props to `TaskCard.vue`.
- [ ] 2.2 Render a PrimeVue Checkbox on the card when `selectable` is true.
- [ ] 2.3 Emit a `select` event (with task id and desired selected state) when the card body is clicked in selectable mode.
- [ ] 2.4 Ensure non-selectable mode preserves existing click and drag behavior.

## 3. BoardColumn prop forwarding

- [ ] 3.1 Add `selectable`, `selectedIds`, and `onSelect` props to `BoardColumn.vue`.
- [ ] 3.2 Pass the props to each `TaskCard` rendered in the column.

## 4. Task store batch delete helper

- [ ] 4.1 Add `deleteTasks(taskIds: number[], options?: { onProgress?: (taskId: number) => void }): Promise<{ deleted: number; warnings: string[]; error?: string }>` to `src/mainview/stores/task.ts`.
- [ ] 4.2 Loop over `taskIds` calling the existing `deleteTask` method, invoke `onProgress` after each deletion, collect warnings, and stop on first error.
- [ ] 4.3 Add unit tests in `src/mainview/stores/task.test.ts` for `deleteTasks` covering success, warning aggregation, and stop-on-error.

## 5. BoardView topbar controls and dialog

- [ ] 5.1 Add a topbar delete button with a trash icon that enters selection mode.
- [ ] 5.2 In selection mode, show a "Delete N" danger button and a "Cancel" button in the topbar.
- [ ] 5.3 Disable "Delete N" when no cards are selected.
- [ ] 5.4 Add a PrimeVue Dialog inline in BoardView for confirmation showing the selected card count.
- [ ] 5.5 On confirm, call `taskStore.deleteTasks(selectedIds)`, then exit selection mode.
- [ ] 5.6 On cancel, close the dialog and keep selection mode active.
- [ ] 5.7 Wire `useCardSelection` into `BoardView`, `BoardColumn`, and `TaskCard`.
- [ ] 5.8 Reset selection mode when `boardStore.activeBoardId` or `workspaceStore.activeWorkspaceKey` changes.

## 6. Playwright E2E tests

- [ ] 6.1 Create `e2e/ui/board-batch-delete.spec.ts` covering: entering selection mode, selecting/deselecting cards, Delete N count, disabled empty state, cancel exits selection mode, confirmation dialog opens, confirming deletes selected cards via `tasks.delete`, cancelling dialog keeps selection.
- [ ] 6.2 Add a test verifying selection resets when switching workspace or board.

## 7. Verification

- [ ] 7.1 Run `bun run build` and fix any TypeScript or build errors.
- [ ] 7.2 Run `bun test src/mainview/stores/task.test.ts src/mainview/composables/useCardSelection.test.ts`.
- [ ] 7.3 Run `bun run build && npx playwright test e2e/ui/board-batch-delete.spec.ts`.

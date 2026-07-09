## Why

Deleting a card currently requires opening the task detail overlay and clicking a trash icon. This is slow when a user wants to remove several cards at once. A board-level batch deletion flow will reduce clicks and make board cleanup faster.

## What Changes

- Add a delete button to the board view topbar.
- First click enters **selection mode**: each task card renders a checkbox and the whole card becomes a selection toggle.
- In selection mode the topbar shows a **Delete N** danger button and a **Cancel** button.
- Clicking **Delete N** opens a PrimeVue confirmation dialog showing the number of selected cards.
- Confirming deletes each selected card via the existing `tasks.delete` RPC.
- Selection mode resets when the active board or workspace changes.

## Capabilities

### New Capabilities
- `board-batch-delete`: Board-level multi-select card deletion UI and flow.

### Modified Capabilities
- `task-management`: Extends the existing single-card deletion behavior with a frontend batch wrapper that reuses `tasks.delete` for each selected card.

## Test Scenarios

- **Unit — `useCardSelection` composable**: enter/exit selection mode, toggle individual cards, clear selection, selected count.
- **Unit — `taskStore.deleteTasks`**: delete multiple tasks, aggregate warnings, stop on first error, invoke `onProgress` per deletion.
- **Integration — backend**: No new backend RPC; existing `tasks.delete` cascade tests in `handlers.test.ts` continue to cover deletion behavior.
- **Playwright — board batch delete E2E**:
  - Enter selection mode from topbar delete button.
  - Select/deselect cards by clicking card bodies; verify checkboxes reflect state.
  - Verify card click does not open task drawer in selection mode.
  - Verify "Delete N" button shows selected count and is disabled when selection is empty.
  - Verify Cancel button exits selection mode and clears checkboxes.
  - Verify "Delete N" opens a confirmation dialog with the selected count.
  - Verify confirming deletion calls `tasks.delete` once per selected card and removes cards from the board.
  - Verify cancelling the dialog keeps selection mode active.
  - Verify switching board or workspace exits selection mode and clears selected IDs.

## Impact

- Frontend: `BoardView.vue`, `BoardColumn.vue`, `TaskCard.vue`, `task.ts` store, a new `useCardSelection()` composable, plus unit and E2E test files.
- Backend: No changes; reuses existing `tasks.delete` handler.

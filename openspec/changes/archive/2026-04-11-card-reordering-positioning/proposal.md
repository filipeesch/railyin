## Why

Cards on the board can be dragged between columns but land at the bottom of the destination column with no way to control where they appear. There is also no way to reorder cards within a column. The only ordering available today is insertion order (`created_at ASC`), which reflects when the task was created rather than its current priority.

This matters because users naturally want to rank tasks by priority within a column and place a card at a specific position when moving it across columns.

## What Changes

- Cards remember a floating-point `position` value in the database. Tasks are ordered by `position ASC` instead of `created_at ASC`.
- Dragging a card to a new position **within the same column** updates only its `position` — no AI turn is triggered, no `workflowState` changes.
- Dragging a card to a **different column** updates both `workflowState` and `position` (inserting it at the drop point rather than appending to the bottom).
- A visual drop indicator (a highlighted horizontal line) snaps between cards during a drag to show exactly where the card will land.
- Existing tasks are migrated to sequential positions based on their current `created_at` order.

## Capabilities

### New Capabilities
- `card-positioning`: Tasks have a persistent `position` field that controls their display order within a board column.

### Modified Capabilities
- `board`: Drag-and-drop now supports intra-column reordering and precise cross-column placement. The drag ghost and column highlight are retained; a per-gap drop indicator is added.

## Non-Goals

- Column reordering (columns remain in the order defined by the workflow YAML).
- Automated or AI-driven card prioritization.
- Undo/redo for position changes.

## Impact

- `src/bun/db/migrations.ts` — DB migration: `ALTER TABLE tasks ADD COLUMN position REAL`; backfill existing rows
- `src/bun/handlers/tasks.ts` — new `tasks.reorder` handler; `tasks.list` sorts by `position`; `tasks.transition` accepts optional `targetPosition`
- `src/shared/rpc-types.ts` — `position: number` added to `Task`; `tasks.reorder` RPC signature added
- `src/mainview/stores/task.ts` — `reorderTask()` action; `transitionTask()` extended with optional `targetPosition`
- `src/mainview/views/BoardView.vue` — drop-index detection during `onPointerMove`; drop indicator rendering; same-column vs cross-column routing on `onPointerUp`

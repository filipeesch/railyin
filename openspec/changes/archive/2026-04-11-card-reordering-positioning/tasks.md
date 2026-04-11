## 1. DB Migration

- [x] 1.1 Add `ALTER TABLE tasks ADD COLUMN position REAL NOT NULL DEFAULT 0` to `src/bun/db/migrations.ts` as a new migration entry
- [x] 1.2 In the same migration, backfill existing rows: assign `position = ROW_NUMBER() OVER (PARTITION BY board_id, workflow_state ORDER BY created_at ASC) * 1000.0` using a SQLite UPDATE with a subquery (SQLite does not support window functions in UPDATE directly — use a CTE: `WITH ranked AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY board_id, workflow_state ORDER BY created_at) * 1000.0 AS pos FROM tasks) UPDATE tasks SET position = ranked.pos FROM ranked WHERE tasks.id = ranked.id`)
- [x] 1.3 Verify the migration runner in `src/bun/db/index.ts` applies the new migration on startup (no structural change needed — just confirm the pattern)

## 2. Shared Types

- [x] 2.1 Add `position: number` to the `Task` interface in `src/shared/rpc-types.ts`
- [x] 2.2 Add `tasks.reorder` RPC method signature to the RPC schema in `src/shared/rpc-types.ts`: `"tasks.reorder": { params: { taskId: number; position: number }; result: Task }`
- [x] 2.3 Add optional `targetPosition?: number` to the `tasks.transition` params type in `src/shared/rpc-types.ts`

## 3. Backend Handlers

- [x] 3.1 In `src/bun/handlers/tasks.ts`, update `tasks.list` query: change `ORDER BY t.created_at ASC` to `ORDER BY t.position ASC`
- [x] 3.2 Add `position` to the `TaskRow` type in `src/bun/db/row-types.ts` (or wherever `TaskRow` is defined)
- [x] 3.3 Add `position` mapping in `mapTask()` in `src/bun/db/mappers.ts` so the field is included in the returned `Task` object
- [x] 3.4 Implement `tasks.reorder` handler in `src/bun/handlers/tasks.ts`: `UPDATE tasks SET position = ? WHERE id = ?`, then return the updated task via `fetchTask()`
- [x] 3.5 Extend `tasks.transition` handler to read optional `targetPosition` from params; when provided, add `position = ?` to the UPDATE query that sets `workflow_state` (before calling `orchestrator.executeTransition`)

## 4. Task Store (Frontend)

- [x] 4.1 Add `reorderTask(taskId: number, position: number): Promise<void>` to the task store in `src/mainview/stores/task.ts`
  - Optimistic update: immediately set `task.position` in `tasksByBoard` and `taskIndex`
  - Call `electroview.rpc.request["tasks.reorder"]({ taskId, position })`
  - On success: sync returned task via `_replaceTask` / `onTaskUpdated`
  - On error: revert to prior position
- [x] 4.2 Extend `transitionTask(taskId, toState, targetPosition?)` signature and pass `targetPosition` to the RPC call when provided

## 5. BoardView — Drop Index Detection

- [x] 5.1 Add reactive refs to `BoardView.vue`: `dropIndex: ref<number | null>(null)` and `dropIndicatorY: ref<number>(0)`
- [x] 5.2 Add `dragSourceColumnId: ref<string | null>(null)` to capture which column the drag started from (set in `onCardPointerDown`)
- [x] 5.3 In `onPointerMove`, after computing `dragOverColumnId`, iterate the `.task-card` elements inside the hovered column's `.board-column__cards` container to compute `dropIndex`:
  ```
  const cards = colEl.querySelectorAll('.task-card')
  let idx = cards.length  // default: append at end
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect()
    if (event.clientY < rect.top + rect.height / 2) { idx = i; break }
  }
  dropIndex.value = idx
  ```
  Also skip the dragged card itself when iterating (match by `data-task-id`)
- [x] 5.4 Compute `dropIndicatorY` from the gap pixel offset within the column cards container (top of card at `idx`, or bottom of last card for append). Store as a number relative to the container's scrollTop for the CSS `top` value.

## 6. BoardView — Drop Indicator UI

- [x] 6.1 Add a `<div class="drop-indicator">` inside each `.board-column__cards` container in the template, shown only when `dragOverColumnId === column.id`
- [x] 6.2 Bind `style="top: dropIndicatorY + 'px'"` on the indicator element (use `position: absolute` so it overlays the card list without shifting layout)
- [x] 6.3 Add CSS for `.drop-indicator`: `position: absolute; left: 0; right: 0; height: 2px; background: var(--p-primary-color, #6366f1); border-radius: 2px; pointer-events: none; z-index: 10`
- [x] 6.4 Add `position: relative` to `.board-column__cards` so the absolute indicator is scoped to the column

## 7. BoardView — onPointerUp Routing

- [x] 7.1 In `onPointerUp`, compute `targetPosition` from `dropIndex` and the sorted `columnTasks(dragOverColumnId)` array using the float midpoint formula:
  - `idx === 0`: `tasks[0].position / 2`
  - `idx === tasks.length` (append): `tasks[tasks.length - 1].position + 1000`
  - Otherwise: `(tasks[idx - 1].position + tasks[idx].position) / 2`
  - Edge case: column is empty → use `1000.0`
- [x] 7.2 Route on drop:
  - `dragOverColumnId === dragSourceColumnId && targetPosition !== task.position` → call `taskStore.reorderTask(taskId, targetPosition)`
  - `dragOverColumnId !== dragSourceColumnId` → call `taskStore.transitionTask(taskId, dragOverColumnId, targetPosition)`
  - Position unchanged → no-op (avoid redundant RPC)
- [x] 7.3 Reset `dropIndex` and `dragSourceColumnId` in the `finally` block of `onPointerUp`

## 8. BoardView — columnTasks Sort

- [x] 8.1 Update `columnTasks(columnId)` to sort results by `task.position` ascending before returning, ensuring the frontend order always reflects the persisted position even before a full reload

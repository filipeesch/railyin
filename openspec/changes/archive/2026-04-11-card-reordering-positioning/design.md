## Context

The board's drag-and-drop system is a custom pointer-event implementation in `BoardView.vue`. On `pointerdown` a ghost clone is created; `pointermove` tracks cursor position and highlights the hovered column; `pointerup` calls `tasks.transition` to move the card to the target column. Currently it detects only **which column** is hovered — not **where within the column** to insert.

`tasks.list` orders by `created_at ASC`. The `Task` type has no `position` field. `tasks.transition` always calls `orchestrator.executeTransition`, which triggers an AI execution turn — so it must never be called for a same-column reorder.

## Goals / Non-Goals

**Goals:**
- Persistent float position field on every task, used as the sort key within a column
- Visual drop indicator snapping between cards during drag
- Same-column drag: update position only, no AI turn
- Cross-column drag: update both `workflowState` and `position` at the drop point
- Migration backfills existing rows using `created_at` order

**Non-Goals:**
- Column reordering
- Undo/redo for position changes
- Automated card prioritization

## Decisions

### Decision 1: Float midpoint encoding for positions

**Chosen:** `position REAL` (SQLite `REAL` maps to IEEE 754 double). Migration assigns `(row_number * 1000.0)`. Inserting between two cards at positions `a` and `b` uses `(a + b) / 2`. Appending at the bottom uses `max_position + 1000.0`. Inserting at the top uses `min_position / 2`.

**Why:** For a local app with <100 cards per column, float midpoints give effectively unlimited insertions without periodic compaction. Dense integer re-indexing would require updating every card after the insertion point. Sparse integers eventually need compaction. Float midpoints need no bookkeeping.

**Precision limit:** IEEE 754 doubles have 52 mantissa bits. Starting at 1000.0, you can bisect ~50 times before adjacent values become indistinguishable (~1e-12 gap). In practice this is never reached — a reindex (assign 1000, 2000, 3000…) can be added later as a background maintenance step if ever needed.

### Decision 2: Separate `tasks.reorder` RPC — never call `tasks.transition` for same-column moves

**Chosen:** A new `tasks.reorder` RPC accepts `{ taskId, position }` and executes a bare `UPDATE tasks SET position = ? WHERE id = ?`. No orchestrator involvement.

**Why:** `tasks.transition` unconditionally calls `orchestrator.executeTransition`, which creates an execution record and may trigger an AI turn if the target column has an `on_enter_prompt`. Calling it for a same-column reorder would corrupt execution history and potentially fire unwanted AI turns.

`BoardView.onPointerUp` routes by comparing `dragSourceColumnId` to `dropTargetColumnId`:
- Same column → `tasks.reorder`
- Different column → `tasks.transition` with optional `targetPosition`

### Decision 3: Extend `tasks.transition` with optional `targetPosition`

**Chosen:** `tasks.transition` gains an optional `targetPosition?: number` param. When provided, the handler sets `position = targetPosition` in the same DB write that updates `workflow_state`, before calling `orchestrator.executeTransition`.

**Why:** Cross-column drops now land at the precise drop point rather than appending to the bottom. The orchestrator call is unchanged — it still fires as before.

### Decision 4: Drop index detection via card midpoints

**Chosen:** During `onPointerMove`, after identifying the hovered column, iterate the rendered card elements in that column and compare `cursorY` to each card's vertical midpoint:

```
for each card element in column (top to bottom):
  midY = card.getBoundingClientRect().top + card.offsetHeight / 2
  if cursorY < midY → insertIndex = indexOfCard
  break

if cursorY > all midpoints → insertIndex = column.length  // append
```

The drop index is stored in a reactive ref `dropIndex`. The corresponding `position` value is computed as:
- `insertIndex === 0`: `columnTasks[0].position / 2`
- `insertIndex === n` (end): `columnTasks[n-1].position + 1000`
- Otherwise: `(columnTasks[insertIndex-1].position + columnTasks[insertIndex].position) / 2`

### Decision 5: Drop indicator as an absolutely-positioned div injected into the column cards container

**Chosen:** A `<div class="drop-indicator">` is rendered inside `.board-column__cards` using `position: absolute`. Its `top` is set to the pixel offset of the target gap. It is only visible when `dragOverColumnId` matches the current column.

**Why:** Using a pseudo-element or injecting a placeholder between `v-for` items would force Vue to re-render the card list on every `pointermove` tick. An absolutely-positioned overlay avoids modifying the card DOM and can be updated with a single `style.top` write.

The gap pixel position is computed from the bounding rect of the last card before the insertion point (or 0 for top, `container.scrollHeight` for bottom).

## Architecture

```
BoardView.vue (onPointerMove)
  │
  ├─ identify hovered column element
  ├─ iterate card elements → compute dropIndex
  ├─ compute targetPosition (float midpoint)
  └─ update reactive refs: dragOverColumnId, dropIndex, dropIndicatorY

BoardView.vue (onPointerUp)
  │
  ├─ sameColumn && position unchanged → no-op
  ├─ sameColumn && position changed
  │     └─ taskStore.reorderTask(taskId, targetPosition)
  │           └─ RPC: tasks.reorder → UPDATE tasks SET position = ?
  └─ differentColumn
        └─ taskStore.transitionTask(taskId, toState, targetPosition)
              └─ RPC: tasks.transition → UPDATE + orchestrator.executeTransition

columnTasks() computed
  └─ sort by task.position ASC (was: insertion order from tasks.list)
```

## File Impact

| File | Change |
|---|---|
| `src/bun/db/migrations.ts` | New migration: `ALTER TABLE tasks ADD COLUMN position REAL NOT NULL DEFAULT 0`; UPDATE backfill using ROW_NUMBER ordered by `created_at` |
| `src/bun/handlers/tasks.ts` | `tasks.list` → `ORDER BY position ASC`; new `tasks.reorder` handler; `tasks.transition` accepts optional `targetPosition` and writes it to DB before calling orchestrator |
| `src/shared/rpc-types.ts` | `Task.position: number`; add `tasks.reorder` signature |
| `src/mainview/stores/task.ts` | `reorderTask(taskId, position)` action with optimistic update; `transitionTask` extended with optional `targetPosition` |
| `src/mainview/views/BoardView.vue` | `dropIndex` + `dropIndicatorY` reactive refs; `onPointerMove` card iteration logic; drop indicator `<div>`; `onPointerUp` routing; `columnTasks()` sorted by position |

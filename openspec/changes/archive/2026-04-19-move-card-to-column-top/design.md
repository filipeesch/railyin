## Context

Cards on the board have a `position` float column that determines their order within a column. The drag-and-drop path (`BoardView.vue`) correctly computes a `targetPosition` by halving the position of the card above the drop point. However, two other transition paths do not set `position`:

1. **Select dropdown** (`TaskDetailDrawer.vue` `transition()`) calls `taskStore.transitionTask(id, toState)` with no position, so the backend leaves the card at its old position value — which is meaningless in the target column context.
2. **Agent `move_task` tool** (`workflow/tools.ts`) directly runs `UPDATE tasks SET workflow_state = ?` without touching `position`.

Both paths result in the card landing at an undefined position in the target column.

## Goals / Non-Goals

**Goals:**
- Cards moved via the Select dropdown always land at the **top** of the target column.
- Cards moved via the agent `move_task` tool always land at the **top** of the target column.
- The `tasks.transition` backend RPC defaults to top-of-column when `targetPosition` is not provided (belt-and-suspenders, consistent default for any future caller).

**Non-Goals:**
- Changing drag-and-drop behavior (already correct).
- Adding a UI to choose the target position when using the Select dropdown.
- Changing `tasks.create` default position (backlog append is intentional).

## Decisions

### D1: Position math — halve the minimum

**Decision**: When placing at the top of a column, compute `position = MIN(existing_position) / 2`. If the column is empty, use `500`.

**Rationale**: This is identical to the logic already used by drag-and-drop for `idx === 0` (see `BoardView.vue` line 460: `targetPosition = candidates[0].position / 2`). Consistent formula, no new concept. The value `500` leaves space above for future placements.

**Alternative considered**: `position = 0` — rejected because repeated top insertions would produce negative values after enough halves. The halving approach keeps all positions positive indefinitely.

### D2: Compute position in the frontend for the Select dropdown

**Decision**: In `TaskDetailDrawer.vue`, compute the top position from `taskStore.tasksByBoard` (already in reactive state) before calling `transitionTask`, then pass it as `targetPosition`.

**Rationale**: The frontend already has all column tasks loaded. Computing there avoids an extra round-trip and keeps the optimistic update in the store consistent with what the server will actually do.

**Alternative considered**: Let the backend always compute it — simpler frontend, but the optimistic update in the store would show the wrong position until the RPC returns.

### D3: Compute position in the DB for agent `move_task`

**Decision**: In `workflow/tools.ts`, add a `SELECT MIN(position)` query for the target column before the `UPDATE`, then include `position = ?` in the same update statement.

**Rationale**: The `move_task` tool runs purely on the backend; there is no frontend state available. The query is trivial (single index scan on `board_id + workflow_state + position`).

### D4: Backend `tasks.transition` defaults to top when no `targetPosition` given

**Decision**: In `handlers/tasks.ts`, when `params.targetPosition` is `null`/`undefined`, query `SELECT MIN(position)` for the target column and compute the top position before the state update.

**Rationale**: Makes the RPC self-consistent regardless of caller. Protects against future callers (CLI, e2e tests) that omit `targetPosition` getting unpredictable placement.

## Risks / Trade-offs

- **Floating point exhaustion** → Mitigation: halving positions is already in production for drag-and-drop; the same risk exists and is accepted. A rebalance strategy (if ever needed) is a separate concern.
- **Race condition between two simultaneous top insertions** → Mitigation: both would compute `MIN / 2` from the same snapshot; one would "win" and appear above the other. No data corruption; just non-deterministic ordering between the two, which is acceptable.
- **Optimistic update mismatch** → Mitigation: D2 ensures the frontend computes the same position the backend will apply, so the optimistic update and server response stay in sync.

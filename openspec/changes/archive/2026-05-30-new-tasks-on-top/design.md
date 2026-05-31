## Context

New tasks are inserted at the bottom of the backlog column (`MAX(position) + 1000`). Since the board renders tasks sorted by `position ASC`, the newest card always appears at the bottom — forcing users to scroll past all existing work. The expected UX is "most recent at the top", matching the mental model of a to-do list or inbox.

The position system already supports a "top of column" operation: `tasks.transition` and `execMoveTask` both compute `MIN(position) / 2` (or `500` when the column is empty) to prepend a moved task. Creation simply needs to use the same strategy.

The same arithmetic is currently duplicated in two places: `tasks.ts` (transition handler) and `board-tool-executor.ts` (execMoveTask). Centralising it in `PositionService` is the right home — it already owns all other position mutations.

## Goals / Non-Goals

**Goals:**
- New tasks created via `tasks.create` (UI) appear at the top of the backlog column
- New tasks created via `execCreateTask` (AI board tool) explicitly compute and assign a top position
- Top-position arithmetic lives in exactly one place (`PositionService.getTopPosition`)
- Inline duplications in `tasks.transition` and `execMoveTask` are replaced with the shared method

**Non-Goals:**
- Making new-task placement configurable per board or per column
- Changing the ordering of any other operation (move, reorder, rebalance)
- Frontend changes (board already sorts by `position ASC`)
- DB schema changes

## Decisions

### D1: Add `getTopPosition(boardId, columnId)` to `PositionService`

`PositionService` is the single owner of position arithmetic. Adding `getTopPosition` there keeps the responsibility cohesive and DRY.

**Alternative considered**: inline the fix directly in `tasks.create` (minimal diff). Rejected because it leaves three other call sites with duplicate logic and misses the cleanup opportunity.

### D2: `getTopPosition` signature uses `boardId` + `columnId` (not a task id subquery)

The existing inline code in `tasks.transition` uses a subquery (`board_id = (SELECT board_id FROM tasks WHERE id = ?)`). `execMoveTask` already has `boardId` in scope and passes it directly. The cleaner signature takes `boardId` explicitly — one fewer DB round-trip and clearer intent.

### D3: `BoardToolExecutor` instantiates `PositionService` internally

`BoardToolExecutor` already receives `db` in its constructor. `PositionService` only needs `db`. No change to `BoardToolExecutor`'s public constructor signature is required — it creates `new PositionService(db)` internally, the same pattern as `tasks.ts` does today.

**Alternative considered**: inject `PositionService` as a constructor parameter. Acceptable but over-engineered for this change size; no test benefit since `PositionService` itself is thin and already tested.

### D4: No DB migration

The `position` column has `DEFAULT 0`. The new logic writes an explicit positive position on every insert; the default is never reached. No migration needed.

## Risks / Trade-offs

- **Position collisions after rebalancing**: Inserting at `MIN/2` can eventually produce positions below `1` after many inserts without rebalancing. This is mitigated by the existing `rebalanceColumnPositions` which fires after transitions and reorders. Creation does not currently trigger rebalance — acceptable because the first drag-reorder will normalise positions.
- **Concurrent inserts**: Two concurrent `tasks.create` calls could compute the same `MIN/2`. SQLite's default WAL mode serialises writes, so both inserts will land with the same position value. The rebalance guard (gap < 1) will correct this on the next transition or reorder. No data loss, minor ordering ambiguity.

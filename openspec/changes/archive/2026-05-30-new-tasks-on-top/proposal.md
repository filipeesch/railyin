## Why

When a user creates a new task it lands at the bottom of the backlog column, forcing them to scroll past all existing work. New tasks represent freshly-captured intent and should appear at the top of the first board column so they are immediately visible and ready to be prioritised.

## What Changes

- `tasks.create` RPC handler now assigns a position at the **top** of the backlog column (`MIN(position) / 2`, or 500 when empty) instead of `MAX(position) + 1000`.
- `BoardToolExecutor.execCreateTask` (AI-initiated creation) now explicitly computes and assigns the same top position instead of relying on the DB default (`0`).
- `PositionService` gains a `getTopPosition(boardId, columnId)` method that encapsulates the top-position arithmetic, shared by both creation paths and the existing transition paths (cleanup).
- Inline top-position calculations in `tasks.transition` and `execMoveTask` are replaced with calls to `PositionService.getTopPosition` (no behaviour change — pure deduplication).

## Capabilities

### New Capabilities

*(none — this is a behavioural correction to an existing capability)*

### Modified Capabilities

- `position-service`: `PositionService` gains a new public method `getTopPosition(boardId, columnId): number` that queries `MIN(position)` for the given column and returns `MIN / 2` (or `500` when the column is empty).
- `task-management`: Task creation MUST place the new task at the top of the target column, not the bottom.
- `board-tool-executor`: `execCreateTask` MUST use `PositionService.getTopPosition` to assign position on creation.

## Impact

- **Backend**: `src/bun/handlers/position-service.ts`, `src/bun/handlers/tasks.ts`, `src/bun/workflow/tools/board-tool-executor.ts`
- **Frontend**: No changes — the board already sorts tasks by `position ASC`
- **DB schema**: No migration needed — `position` column already exists with a `REAL NOT NULL DEFAULT 0` constraint
- **Tests**: Existing position-service and board-tool-executor test suites will need a new scenario covering top-of-column placement on creation

## 1. PositionService — add getTopPosition

- [ ] 1.1 Add `getTopPosition(boardId: number, columnId: string): number` method to `PositionService` in `src/bun/handlers/position-service.ts` — queries `MIN(position)` for the column, returns `MIN / 2` or `500` when empty

## 2. Fix tasks.create (UI creation path)

- [ ] 2.1 Replace `MAX(position) + 1000` in the `tasks.create` INSERT in `src/bun/handlers/tasks.ts` with a call to `positionService.getTopPosition(params.boardId, 'backlog')`
- [ ] 2.2 Update the two-step INSERT (create task, then update position) if needed, or use the computed value directly in the INSERT

## 3. Fix execCreateTask (AI creation path)

- [ ] 3.1 Instantiate `PositionService` in `BoardToolExecutor` (constructor or lazily) using the injected `db`
- [ ] 3.2 Compute position via `positionService.getTopPosition(boardId, 'backlog')` in `execCreateTask` and include it in the INSERT statement in `src/bun/workflow/tools/board-tool-executor.ts`

## 4. Cleanup — deduplicate inline top-position logic

- [ ] 4.1 Replace inline `MIN(position) / 2` computation in `tasks.transition` (`src/bun/handlers/tasks.ts`) with `positionService.getTopPosition(boardId, targetState)`
- [ ] 4.2 Replace inline `MIN(position) / 2` computation in `execMoveTask` (`src/bun/workflow/tools/board-tool-executor.ts`) with `positionService.getTopPosition(boardId, targetState)`

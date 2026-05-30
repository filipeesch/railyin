## 1. Unit tests — PositionService.getTopPosition (PS-4)

- [x] 1.1 Add suite `PS-4` to `src/bun/test/position-service.test.ts` covering scenario PS-4.1: non-empty column returns `MIN/2`
- [x] 1.2 Add scenario PS-4.2 to `PS-4`: empty column returns `500`
- [x] 1.3 Add scenario PS-4.3 to `PS-4`: single-task column returns `position/2`
- [x] 1.4 Add scenario PS-4.4 to `PS-4`: cross-board isolation (board A's tasks do not affect board B's result)

## 2. Integration tests — tasks.create handler position (TC-POS)

- [x] 2.1 Add suite `TC-POS` to `src/bun/test/handlers.test.ts` covering scenario TC-POS-1: first task in empty backlog has `position === 500`
- [x] 2.2 Add scenario TC-POS-2 to `TC-POS`: second task has `position < 500` (250)
- [x] 2.3 Add scenario TC-POS-3 to `TC-POS`: third task has `position < 250` (125)
- [x] 2.4 Add scenario TC-POS-4 to `TC-POS`: response `position` field matches the `position` DB column value

## 3. Integration tests — execCreateTask position (BE-4.x)

- [x] 3.1 Add scenario BE-4.2 to the existing `BE-4` suite in `src/bun/test/board-tool-executor.test.ts`: `execCreateTask` places task above existing tasks in non-empty backlog
- [x] 3.2 Add scenario BE-4.3 to `BE-4`: `execCreateTask` assigns position `500` when backlog is empty

## 4. Playwright tests — card DOM ordering (CREATE-4/5)

- [x] 4.1 Add test `CREATE-4` to `e2e/ui/board-create-task.spec.ts`: newly created task card appears first in the backlog column DOM when returned with a lower position than existing cards
- [x] 4.2 Add test `CREATE-5` to `e2e/ui/board-create-task.spec.ts`: a task pushed via WebSocket `task.updated` with a lower position than existing cards appears first in the backlog column DOM

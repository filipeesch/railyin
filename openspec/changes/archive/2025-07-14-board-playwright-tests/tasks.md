## 1. Fixture Infrastructure

- [x] 1.1 Add `setupBoardWithTemplate(api: ApiMock, template: WorkflowTemplate): void` helper to `e2e/ui/fixtures/mock-data.ts` — calls `api.returns("boards.list", [makeBoard({ template } as any)]).returns("workspace.getConfig", makeWorkspace({ workflows: [template] }))`
- [x] 1.2 Create `e2e/ui/fixtures/board-helpers.ts` with `navigateToBoard(page, boardId?)` extracted from the local helper in `board.spec.ts`
- [x] 1.3 Add `startDragOnCard(page, cardLocator)` to `board-helpers.ts` — dispatches `pointerdown` + `pointermove` ≥5px via `page.evaluate` using `PointerEvent`
- [x] 1.4 Add `dragCardToColumn(page, cardLocator, columnLocator)` to `board-helpers.ts` — full sequence: down → move → up over target column center
- [x] 1.5 Add `assertGhostInDom(page)` to `board-helpers.ts` — asserts `document.body` contains a fixed-position clone element with `z-index: 9999`

## 2. Refactor Existing board.spec.ts

- [x] 2.1 Replace the 4–5 repeated inline workspace+template override blocks in the G-* suite with calls to `setupBoardWithTemplate(api, template)` — verify no test behaviour changes by running `bun run test:e2e:board`

## 3. DnD Tests (board-dnd.spec.ts)

- [x] 3.1 Create `e2e/ui/board-dnd.spec.ts` with suite scaffold (imports, `beforeEach` navigating to board with two columns and one task)
- [x] 3.2 Write DND-1: click below 5px threshold → no `.dragging` class, no ghost in body
- [x] 3.3 Write DND-2: drag ≥5px → card has `.dragging` class
- [x] 3.4 Write DND-3: drag active → ghost clone in `document.body` with `position: fixed; z-index: 9999`
- [x] 3.5 Write DND-4: pointer moves over target column → column receives `droppable-highlight` class
- [x] 3.6 Write DND-5: successful drop → `tasks.transition` called with correct `taskId`/`toState`, card in target column
- [x] 3.7 Write DND-6: drop onto same column → `tasks.transition` NOT called
- [x] 3.8 Write DND-7: `user-select: none` on body during drag, removed after drop
- [x] 3.9 Write DND-8: `test.fail()` — `tasks.transition` returns capacity error → card reverts to source column (unimplemented in `BoardView.vue`)

## 4. Unread State Tests (board-unread.spec.ts)

- [x] 4.1 Create `e2e/ui/board-unread.spec.ts` with suite scaffold
- [x] 4.2 Write URD-1: `message.new` WS push for non-active task → `.task-card__unread-dot` visible
- [x] 4.3 Write URD-2: `stream.event` type `assistant` for non-active task → unread dot visible
- [x] 4.4 Write URD-3: clicking task card clears `.task-card__unread-dot`
- [x] 4.5 Write URD-4: unread task → workspace tab shows `.workspace-tab__unread-dot`

## 5. Workspace Navigation Tests (board-workspace-nav.spec.ts)

- [x] 5.1 Create `e2e/ui/board-workspace-nav.spec.ts` with suite scaffold (mock returning 2 workspaces)
- [x] 5.2 Write WN-1: two workspace tabs visible and current tab is highlighted
- [x] 5.3 Write WN-2: clicking inactive workspace tab triggers `boards.list` for that workspace and renders its boards

## 6. Task Creation Tests (board-create-task.spec.ts)

- [x] 6.1 Create `e2e/ui/board-create-task.spec.ts` with suite scaffold
- [x] 6.2 Write CRT-1: "New task" creation trigger visible in backlog column
- [x] 6.3 Write CRT-2: valid title submission calls `tasks.create` and card appears in backlog
- [x] 6.4 Write CRT-3: empty title → `tasks.create` not called, validation hint shown

## 7. Capacity Tests (board-capacity.spec.ts)

- [x] 7.1 Create `e2e/ui/board-capacity.spec.ts` with suite scaffold (workflow template with column `limit: 2`)
- [x] 7.2 Write CAP-1: column at `limit: N` with N tasks shows capacity indicator in header
- [x] 7.3 Write CAP-2: `tasks.transition` returning capacity error → error message visible in UI
- [x] 7.4 Write CAP-3: column with `limit: null` → no capacity indicator rendered
- [x] 7.5 Write CAP-4: card moved out of full column → capacity indicator decrements
- [x] 7.6 Write CAP-5: board reload with column at capacity → indicator still correct

## 8. WebSocket Reactivity Tests (board-ws-updates.spec.ts)

- [x] 8.1 Create `e2e/ui/board-ws-updates.spec.ts` with suite scaffold
- [x] 8.2 Write WS-1: `task.updated` push with `executionState: "running"` → card badge updates without reload
- [x] 8.3 Write WS-2: `task.updated` push with `executionState: "completed"` → running badge removed without reload
- [x] 8.4 Write WS-3: `test.fail()` — `task.updated` push with unknown task ID → new card appears in column (Bug 2: `execCreateTask` never broadcasts)
- [x] 8.5 Write WS-4: `task.updated` push with changed `workflowState` for existing task → card moves columns without reload

## 9. Project Badge Spec Gap (board-project-badge.spec.ts)

- [x] 9.1 Create `e2e/ui/board-project-badge.spec.ts`
- [x] 9.2 Write PB-1: `test.fail()` — task with `projectKey` set → card renders project key badge (`TaskCard.vue` does not implement this)

## 10. Validation

- [x] 10.1 Run `bun run build && npx playwright test e2e/ui/board.spec.ts` — ensure G-* refactor does not break existing tests
- [x] 10.2 Run `bun run build && npx playwright test e2e/ui/board-dnd.spec.ts` — all DnD tests pass (DND-8 expected-fail passes as `test.fail`)
- [x] 10.3 Run `bun run build && npx playwright test e2e/ui/board-unread.spec.ts e2e/ui/board-workspace-nav.spec.ts e2e/ui/board-create-task.spec.ts e2e/ui/board-capacity.spec.ts` — all pass
- [x] 10.4 Run `bun run build && npx playwright test e2e/ui/board-ws-updates.spec.ts` — WS-1, WS-2, WS-4 pass; WS-3 expected-fail passes
- [x] 10.5 Run `bun run build && npx playwright test e2e/ui/board-project-badge.spec.ts` — PB-1 expected-fail passes
- [x] 10.6 Run full board suite `bun run test:e2e:board` — no regressions in existing tests

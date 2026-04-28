## Why

The board Playwright suite (`e2e/ui/board.spec.ts`) covers only ~21 of 46 spec scenarios across the board, column-groups, column-card-limit, card-column-placement, and contextual-task-creation specs. Two confirmed bugs — agent-created tasks never appearing and execution-state badges not updating after `waiting_user` pauses — have no regression coverage.

## What Changes

- **Split** the monolithic `board.spec.ts` (719 lines) into focused spec files by concern: DnD, unread state, workspace navigation, task creation, capacity enforcement, WS-reactivity bugs
- **Add** ~28 new Playwright test cases covering the identified gaps
- **Add** `e2e/ui/fixtures/board-helpers.ts` with shared DnD helpers (`startDragOnCard`, `dragCardToColumn`, `assertGhostInDom`) and a `navigateToBoard` utility extracted from the existing local helper
- **Add** `setupBoardWithTemplate()` factory to `e2e/ui/fixtures/mock-data.ts`, replacing the repeated verbose inline fixture in the G-* suite
- **Refactor** the G-* suite in `board.spec.ts` to use the new factory (no behaviour change)
- **Add** 3 `test.fail()` cases documenting known spec gaps: DnD card-revert on API error (DND-8), WS board refresh when agent creates a task (WS-3), and project badge on task card (PB-1)

## Capabilities

### New Capabilities

- `board-playwright-coverage`: End-to-end Playwright tests covering the full board spec surface — DnD lifecycle, unread indicators, workspace tab navigation, task creation form, column capacity enforcement, WebSocket reactivity for execution-state changes, and agent tool side-effects (`create_task`, `move_task`)

### Modified Capabilities

<!-- No spec-level requirement changes — this change only adds test coverage for existing specs -->

## Impact

- `e2e/ui/` — 6 new spec files, 1 new fixture helper file
- `e2e/ui/fixtures/mock-data.ts` — new `setupBoardWithTemplate()` export
- `e2e/ui/board.spec.ts` — G-* suite refactored (non-breaking)
- No production code changes; no API changes; no DB migrations

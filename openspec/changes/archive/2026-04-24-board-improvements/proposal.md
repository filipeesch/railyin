## Why

The board has three UX regressions: task cards show launch buttons that belong in the drawer, stacked (grouped) columns don't scroll when overflowed, and dragging a card in a long column can't reach positions outside the visible area. Alongside these fixes, the legacy `src/ui-tests/` test infrastructure (bun+bridge, requires live Electrobun app) is dead code — every suite has a Playwright equivalent in `e2e/ui/` — and should be removed.

## What Changes

- **Remove** `LaunchButtons` (run/tool buttons) from `TaskCard.vue` card mode — they belong only in the task drawer (`TaskChatView.vue`)
- **Remove** the `openTerminal` event and handler chain from `TaskCard` → `BoardView` (only emitted via the removed launch row)
- **Fix** grouped (stacked) column scroll: add `max-height: 100%` + flex distribution to `.board-column-group` so `.board-column__cards` `overflow-y: auto` activates
- **Add** drag auto-scroll: rAF loop that scrolls a column's card container when the drag cursor is within 60px of its top/bottom edge
- **Fix** dead `.is-drag-over` CSS binding that has no corresponding style rule — add a subtle visual highlight
- **Delete** `src/ui-tests/` directory (board.test.ts, chat-session-panel.test.ts, chat-sidebar.test.ts, bridge.ts)
- **Delete** `scripts/run-ui-tests.ts` and remove `test:ui:run` from `package.json`
- **Update** `.github/prompts/run-ui-tests.prompt.md` and `test-loop.prompt.md` to reference Playwright instead of the bun bridge
- **Add** Playwright tests in `e2e/ui/board.spec.ts` (new Suite BD) covering all 3 board fixes

## Capabilities

**New Capabilities:** none

**Modified Capabilities:** none — these are UX fixes and infrastructure cleanup with no spec-level behaviour changes.

## Impact

- `src/mainview/components/TaskCard.vue` — remove launch row, event, and related imports
- `src/mainview/views/BoardView.vue` — CSS fix, drag auto-scroll logic, remove openTerminal handler
- `e2e/ui/board.spec.ts` — 4 new tests (Suite BD)
- `src/ui-tests/` — deleted
- `scripts/run-ui-tests.ts` — deleted
- `package.json` — remove `test:ui:run` script
- `.github/prompts/run-ui-tests.prompt.md`, `test-loop.prompt.md` — updated
- `LaunchButtons.vue`, `stores/launch.ts` — **unchanged** (still used in `TaskChatView.vue`)

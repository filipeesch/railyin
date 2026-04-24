## 1. Remove LaunchButtons from TaskCard

- [x] 1.1 Remove the `v-if="launchConfig && task.worktreePath"` launch row block from `TaskCard.vue` template
- [x] 1.2 Remove `launchConfig` ref, `onMounted` fetch, and `runLaunch` function from `TaskCard.vue` script
- [x] 1.3 Remove `openTerminal` from `defineEmits` in `TaskCard.vue`
- [x] 1.4 Remove `LaunchButtons` import and `useLaunchStore` import from `TaskCard.vue`
- [x] 1.5 Remove `@open-terminal="onOpenTerminal"` from both `<TaskCard>` usages in `BoardView.vue`
- [x] 1.6 Remove the `onOpenTerminal` function from `BoardView.vue` (confirm it has no other callers)
- [x] 1.7 Remove `.task-card__launch-row` CSS rule from `TaskCard.vue` styles

## 2. Fix grouped column scroll

- [x] 2.1 Add `max-height: 100%; overflow: hidden;` to `.board-column-group` in `BoardView.vue` styles
- [x] 2.2 Change `.board-column-group > .board-column` from `flex: none` to `flex: 1 1 0; min-height: 0;`

## 3. Add drag auto-scroll

- [x] 3.1 Add module-level `scrollRAF` and `scrollContainer` variables to `BoardView.vue`
- [x] 3.2 Implement `startAutoScroll(container, direction)` and `stopAutoScroll()` helpers using `requestAnimationFrame`
- [x] 3.3 In `onPointerMove`, detect when cursor is within 60px of top/bottom of the hovered `.board-column__cards` container and call `startAutoScroll`/`stopAutoScroll` accordingly
- [x] 3.4 Call `stopAutoScroll()` in `onPointerUp` to cancel any active scroll loop on drop

## 4. Fix dead `.is-drag-over` CSS

- [x] 4.1 Add a CSS rule for `.board-column.is-drag-over` in `BoardView.vue` (e.g. subtle background highlight to signal a valid drop target)

## 5. Delete legacy test infrastructure

- [x] 5.1 Delete `src/ui-tests/board.test.ts`
- [x] 5.2 Delete `src/ui-tests/chat-session-panel.test.ts`
- [x] 5.3 Delete `src/ui-tests/chat-sidebar.test.ts`
- [x] 5.4 Delete `src/ui-tests/bridge.ts`
- [x] 5.5 Delete `scripts/run-ui-tests.ts` (file was already absent from disk)
- [x] 5.6 Remove `"test:ui:run"` script from `package.json`

## 6. Update legacy prompt files

- [x] 6.1 Update `.github/prompts/run-ui-tests.prompt.md` to reference `npx playwright test e2e/ui/` instead of `bun test src/ui-tests`
- [x] 6.2 Update `.github/prompts/test-loop.prompt.md` to reference `e2e/ui/` Playwright tests and remove references to the bun bridge

## 7. Add Playwright tests (Suite BD)

- [x] 7.1 Add `BD-1`: task card has no `.task-card__launch-row` even when `launch.getConfig` returns profiles/tools
- [x] 7.2 Add `BD-2`: grouped column `.board-column__cards` has `scrollHeight > clientHeight` when overflowed with many tasks
- [x] 7.3 Add `BD-3`: grouped column card list can be scrolled to bottom (set `scrollTop`, assert it persists)
- [x] 7.4 Add `BD-4`: drag auto-scroll — holding drag cursor near bottom edge of a column increments `scrollTop`

## 8. Verify

- [ ] 8.1 Run `bun run test:e2e:board` and confirm all existing tests still pass plus new Suite BD passes
- [ ] 8.2 Confirm `LaunchButtons.vue` and `stores/launch.ts` still build and work in the task drawer (`TaskChatView.vue`)

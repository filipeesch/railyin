## 1. Drawer width improvements

- [x] 1.1 Replace hardcoded `drawerWidth = ref(860)` with `ref(Math.round(window.innerWidth * 0.7))` in `TaskDetailDrawer.vue`
- [x] 1.2 Reset `drawerWidth` to `Math.round(window.innerWidth * 0.7)` in `onHide` so each new open starts at 70%

## 2. Fix overlay-dismiss bug (delete, save-edit, model change)

- [x] 2.1 Set `dismissable` prop to `false` on the `<Drawer>` component (disables PrimeVue's built-in outside-click)
- [x] 2.2 Add a `mousedown` event listener on `document` in `onMounted`, removed in `onUnmounted`
- [x] 2.3 In the listener: skip closing if `document.body.classList.contains('p-overlay-open')` (active PrimeVue overlay)
- [x] 2.4 In the listener: skip closing if `editDialogVisible.value` or `deleteDialogVisible.value` is true
- [x] 2.5 In the listener: skip closing if the click target is inside the Drawer's panel element (`.p-drawer`)
- [x] 2.6 Otherwise call `taskStore.closeTask()` to close the drawer
- [ ] 2.7 Verify: delete task dialog opens and completes without closing the drawer prematurely
- [ ] 2.8 Verify: edit task save works end-to-end without drawer closing
- [ ] 2.9 Verify: selecting a different model does not close the drawer

## 3. Context-aware send/cancel button

- [x] 3.1 Replace the static send `<Button icon="pi pi-send">` in the input row with a `v-if` / `v-else` pair conditioned on `task.executionState === 'running'`
- [x] 3.2 Idle branch: `pi-send` icon, `@click="send"`, disabled when `!inputText.trim()`
- [x] 3.3 Running branch: `pi-stop-circle` icon, `@click="cancel"`, always enabled, severity `warn`
- [x] 3.4 Remove the standalone Cancel `<Button>` section from the side panel

## 4. Model selector repositioned

- [x] 4.1 Add a second row below the textarea+button row in `.task-detail__input` containing the model `<Select>`
- [x] 4.2 Remove the model Select and its enclosing `.side-section` from the side panel
- [x] 4.3 Update CSS for `.task-detail__input` to be `flex-direction: column` with an inner row for textarea+button

## 5. Board drag-and-drop (pointer events)

- [x] 5.1 Remove `draggable="true"`, `@dragstart`, `@dragend`, `@dragover`, `@drop` bindings from template
- [x] 5.2 Add `@pointerdown="onCardPointerDown($event, task.id)"` to `TaskCard` instances; add `@click="onCardClick(task.id)"`
- [x] 5.3 Add `data-column-id` attribute to each column div for hit-detection
- [x] 5.4 Implement `onCardPointerDown`: capture grab offset (`clientX/Y - rect.left/top`), set `userSelect: none`, store drag state with `sourceEl`, register `pointermove`/`pointerup`/`pointercancel` on `document`
- [x] 5.5 Implement `onPointerMove`: after 5px threshold activate drag — set `cursor: grabbing`, clone source card element as ghost (`position:fixed`, `rotate(1.5deg)`, elevated shadow), hide source card with `opacity:0`, position ghost at grab offset under cursor; detect hovered column via `elementFromPoint`
- [x] 5.6 Implement `onPointerUp`: transition task if column changed, remove ghost, restore source card `opacity`, reset `cursor` and `userSelect`, clear drag state
- [x] 5.7 Implement `onCardClick`: suppress click within 200ms of drag end to prevent accidental drawer opens
- [x] 5.8 Add `dragOverColumnId` ref and bind `is-drag-over` class to columns; add `outline: 2px dashed` CSS for that class

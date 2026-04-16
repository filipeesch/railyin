## 1. TodoPanel — Remove Create Button

- [x] 1.1 Open `src/mainview/components/TodoPanel.vue`
- [x] 1.2 Locate the `[+]` button in the header (around line 13-17)
- [x] 1.3 Remove the entire button element and its wrapper
- [x] 1.4 Verify the panel still shows todo count and expand/collapse functionality
- [x] 1.5 Test: Confirm no create button is visible in TodoPanel

## 2. TodoDetailOverlay — Remove Inputs

- [x] 2.1 Open `src/mainview/components/TodoDetailOverlay.vue`
- [x] 2.2 Remove the number input field (lines 13-20) — `todo-overlay__number-input`
- [x] 2.3 Remove the status dropdown (lines 23-28) — `todo-overlay__status-select`
- [x] 2.4 Remove the phase dropdown (lines 29-32) — second `todo-overlay__status-select`
- [x] 2.5 Remove `boardColumns` ref from script (no longer needed)
- [x] 2.6 Remove `fetchBoardColumns()` function call
- [x] 2.7 Verify header structure is simplified to title + action buttons only

## 3. TodoDetailOverlay — Add PrimeVue Button Components

- [ ] 3.1 Import PrimeVue Button component at top of script
  ```typescript
  import Button from "primevue/button";
  ```
- [ ] 3.2 Replace delete button with PrimeVue Button
  ```vue
  <Button 
    v-if="props.todoId != null"
    icon="pi pi-trash" 
    severity="danger" 
    text 
    rounded 
    title="Delete todo"
    :disabled="saving"
    @click="onDelete" 
  />
  ```
- [ ] 3.3 Replace close button with PrimeVue Button
  ```vue
  <Button 
    icon="pi pi-times" 
    severity="secondary" 
    text 
    rounded 
    title="Close"
    @click="onClose" 
  />
  ```
- [ ] 3.4 Add title icon to header
  ```vue
  <i class="pi pi-check-circle" />
  ```
- [ ] 3.5 Wrap title in proper structure
  ```vue
  <div class="todo-overlay__title">
    <i class="pi pi-check-circle" />
    <span>{{ form.title }}</span>
  </div>
  ```

## 5. TodoDetailOverlay — Update Form and Logic

- [x] 5.1 Keep `status` in reactive form object (needed for isPending computed)
- [x] 5.2 Update `loadTodo()` function:
  - Keep: `form.status = todo.status;`
  - Keep: number, title, description, phase
- [x] 5.3 Update `onSave()` function:
  - Remove status from edit request payload
  - Keep: number, title, description, phase
- [x] 5.4 Update `onDelete()` function:
  - Add check: `if (!isPending.value) return;`
  - Or handle in backend validation
- [x] 5.5 Keep `TodoStatus` import (used for status field type)
- [x] 5.6 Verify overlay still loads todo data correctly

## 6. TodoDetailOverlay — Add Dark Mode Overrides

- [x] 6.1 Add unscoped `<style>` block at end of component
- [x] 6.2 Add dark mode overrides for overlay background
  ```css
  <style>
  html.dark-mode .todo-overlay {
    background: var(--p-surface-900, #0f172a);
  }
  html.dark-mode .todo-overlay__header {
    background: var(--p-surface-800, #1e293b);
    border-bottom-color: var(--p-surface-700, #334155);
  }
  html.dark-mode .todo-overlay__footer {
    border-top-color: var(--p-surface-700, #334155);
  }
  </style>
  ```
- [x] 6.3 Verify PrimeVue Button components don't need manual overrides
- [ ] 6.4 Test: Toggle dark mode and verify overlay colors adapt correctly

## 7. RPC Handlers — Add Validation

- [x] 7.1 Open `src/bun/handlers/tasks.ts`
- [x] 7.2 Locate `todos.edit` RPC handler
- [x] 7.3 Add validation at start of handler
  ```typescript
  const todo = getTodo(taskId, todoId);
  if (!todo) return { error: "Todo not found" };
  if (todo.status !== "pending") {
    return { error: "Can only edit description of pending todos" };
  }
  ```
- [x] 7.4 Add validation for delete operation (if separate handler exists)
  ```typescript
  if (todo.status !== "pending") {
    return { error: "Can only delete pending todos" };
  }
  ```
- [x] 7.5 Verify error messages match spec requirements
- [ ] 7.6 Test: Try editing non-pending todo via RPC and confirm error

## 8. Cleanup — Remove Unused Code

- [ ] 8.1 Remove `TodoStatus` type import if no longer used anywhere
- [ ] 8.2 Remove any CSS classes for removed inputs:
  - `todo-overlay__number-input`
  - `todo-overlay__status-select`
- [ ] 8.3 Verify no references to `boardColumns` remain
- [ ] 8.4 Run TypeScript compiler to check for errors
  ```bash
  npx tsc --noEmit
  ```

## 9. Testing — Verify All Scenarios

- [ ] 9.1 Test: Open TodoPanel — confirm no `[+]` button
- [ ] 9.2 Test: Open pending todo overlay — confirm:
  - No number input
  - No status dropdown
  - No phase dropdown
  - Edit tab visible
  - Save/Cancel buttons visible
  - Delete button visible
- [ ] 9.3 Test: Open in-progress todo overlay — confirm:
  - No number input
  - No status dropdown
  - No phase dropdown
  - Edit tab NOT visible
  - No Save/Cancel buttons
  - No delete button
  - Only Preview tab visible
- [ ] 9.4 Test: Edit pending todo description — confirm save works
- [ ] 9.5 Test: Try to edit non-pending todo — confirm edit mode unavailable
- [ ] 9.6 Test: Delete pending todo — confirm soft-delete works
- [ ] 9.7 Test: Try to delete non-pending todo — confirm delete button hidden
- [ ] 9.8 Test: Toggle dark mode — confirm overlay colors adapt correctly
- [ ] 9.9 Test: RPC validation — try editing non-pending todo via direct RPC call

## 10. Documentation — Update Comments

- [ ] 10.1 Update any JSDoc comments referencing user-editable fields
- [ ] 10.2 Add comment explaining pending-only restriction in overlay component
- [ ] 10.3 Verify no stale comments about number/status/phase editing

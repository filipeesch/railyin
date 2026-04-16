## Why

The todo overlay currently exposes too many controls to users, creating confusion and potential execution issues. Users shouldn't be modifying todo numbers, status, or phase—these are model-controlled aspects of task execution. The current UI allows users to change status on in-progress/done items, which can interfere with the model's execution flow. Additionally, the number field creates UX confusion with sparse values (10, 20, 30) that users don't understand or need to see.

## What Changes

- **Remove user todo creation**: Delete the `[+]` button from TodoPanel—only the model can create todos via `create_todo` tool
- **Hide todo numbers**: Remove number input from overlay and number display from list—users never need to see or edit execution order
- **Remove status editing**: Delete status dropdown from overlay—model controls status via `update_todo_status` tool
- **Remove phase editing**: Delete phase dropdown from overlay—model controls phase via `edit_todo` tool
- **Restrict edits to pending items**: Users can only edit description of todos with status="pending"
- **Restrict deletion to pending items**: Users can only soft-delete todos with status="pending"
- **Fix overlay visual pattern**: Replace custom buttons with PrimeVue Button components following WorkflowEditorOverlay pattern
- **Fix dark mode**: Add proper dark mode overrides using semantic tokens and `html.dark-mode` selector

## Capabilities

### New Capabilities
<!-- None — this is a UI simplification change, not a new capability -->

### Modified Capabilities
- `task-todo-tool`: User UI restrictions on todo editing (only pending descriptions)
- `engine-common-tools`: No changes to model tool behavior

## Impact

- `src/mainview/components/TodoPanel.vue` — remove `[+]` button
- `src/mainview/components/TodoDetailOverlay.vue` — complete redesign: remove number/status/phase inputs, add PrimeVue Button components, conditional rendering for pending items, dark mode fixes
- `src/bun/handlers/tasks.ts` — add validation to reject non-pending todo edits from UI
- `src/shared/rpc-types.ts` — no changes needed
- No backend schema changes
- No model tool behavior changes

## Why

The `allowed_transitions` feature was wired into drag-and-drop and the backend but the workflow column Select in the Task Drawer (`TaskChatView.vue`) was not updated — it still shows every board column, letting users pick invalid transitions that the backend then rejects. This creates a confusing UX gap where the drag UI respects constraints but the Select does not.

## What Changes

- The column Select in the Task Drawer will filter options based on the current task's column `allowedTransitions`, matching the existing drag-and-drop behaviour.
- The current column will appear in the Select as a disabled (non-selectable) option, giving users a visual anchor for where they are.
- Forbidden columns will be omitted from the Select entirely.
- When `allowedTransitions` is not configured on a column, all columns remain available (preserves backward-compatibility).
- A `useColumnTransitions` composable will be extracted, housing the shared filtering logic consumed by both the Task Drawer Select and the Board drag-and-drop forbidden-column computation, removing the duplicate logic from `BoardView.vue`.

## Capabilities

### New Capabilities
- `column-transitions-composable`: A shared composable (`useColumnTransitions`) and a co-located pure function (`getValidTransitionColumns`) that encapsulate the column-transition filtering rules. Both the Task Drawer Select and the Board drag-and-drop consume this composable.

### Modified Capabilities
- `column-allowed-transitions`: Add requirement that the Task Drawer workflow Select respects `allowedTransitions` — only the current column (disabled) and valid transition targets are shown; forbidden columns are excluded.

## Impact

- `src/mainview/composables/useColumnTransitions.ts` — new file
- `src/mainview/composables/useColumnTransitions.test.ts` — new file
- `src/mainview/components/TaskChatView.vue` — consume composable, fix Select options, add no-op guard on `transition()`
- `src/mainview/views/BoardView.vue` — consume composable, replace inline `forbiddenColumnIds` computed (cleanup)
- `openspec/specs/column-allowed-transitions/spec.md` — new requirement added for Task Drawer Select behaviour
- No backend changes, no RPC changes, no DB changes

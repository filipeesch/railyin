## Why

Several rough edges in the task detail drawer and board view degrade daily usability: three action buttons are silently broken (delete, save edit, model change) because PrimeVue's Drawer dismisses itself when overlay panels appear, the drawer is undersized by default, and the board's drag-and-drop cursor misleads users with a forbidden icon during valid drags.

## What Changes

- **Fix Drawer overlay-dismiss bug**: Delete task, Save edit, and model Select all close the drawer silently because teleported PrimeVue overlays (Select panel, Dialog backdrop) register as outside-clicks. Implement a smart close guard that ignores clicks inside active overlays while keeping true outside-clicks closing the drawer.
- **Drawer default width**: Change the default drawer width from the hardcoded `860px` to `70%` of the viewport width (computed at mount time). Width resets to 70% when the drawer is closed.
- **Cancel button in input row**: Move the Cancel action from the side panel into the send-button slot — the icon toggles between send (→) and stop (■) based on execution state, keeping the primary interaction always in the same place.
- **Model selector repositioned**: Move the model `<Select>` from the side panel to below the message textarea, making it contextually adjacent to "what model handles my next message".
- **Board drag-and-drop cursor**: Replace HTML5 Drag-and-Drop with pointer events to fully control cursor during task drag. A `grabbing` cursor is set on `document.body` during drag; text selection is suppressed. A dashed column outline indicates the active drop target.

## Capabilities

### New Capabilities
<!-- None introduced — all changes improve existing capabilities -->

### Modified Capabilities
- `task-detail`: Drawer layout changes (width, input area reorganisation) and fix of overlay-dismiss bug affecting delete, save-edit, and model-selection actions.
- `board`: Drag-and-drop cursor feedback during task column transitions.

## Impact

- `src/mainview/components/TaskDetailDrawer.vue` — primary change surface (layout, overlay guard, input row)
- `src/mainview/views/BoardView.vue` — pointer-events drag implementation
- `src/mainview/components/TaskCard.vue` — no CSS cursor changes (cursor is controlled via `document.body` during drag)
- No backend changes required
- No RPC schema changes
- No new dependencies

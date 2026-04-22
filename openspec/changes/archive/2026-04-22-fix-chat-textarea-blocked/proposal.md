## Why

The chat textarea in `TaskDetailDrawer` has three UX defects: it permanently locks after an AI turn ends (requiring the user to close and reopen the drawer), its background is indistinguishable from the drawer background, and long unbroken lines cause the input row to grow horizontally, breaking the layout.

## What Changes

- **Fix editor lock after AI turn**: Replace the incorrect bare `EditorView.editable.of()` call with a proper `Compartment`-wrapped extension so the editor can be dynamically re-enabled when `disabled` transitions from `true` to `false`.
- **Fix editor background visibility**: Change the CM6 theme background from `--p-surface-0/900` (same as the drawer panel) to `--p-inputtext-background` or the appropriate input surface token so the editor is visually distinct as an interactive field.
- **Fix horizontal layout overflow**: Constrain `.cm-editor` to `width: 100%` and set `.cm-scroller` to `overflow-x: hidden`, forcing word-wrap to activate and preventing the editor from growing outside its flex cell.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `chat-editor`: Requirements for the editor's disabled/re-enabled lifecycle, visual styling as an input field distinct from its container, and word-wrap behaviour are being clarified/added.

## Impact

- **Files changed**: `src/mainview/components/ChatEditor.vue` only
- **APIs**: No RPC or API changes
- **Dependencies**: No new packages
- **Affected components**: `TaskDetailDrawer.vue` consumes `ChatEditor` but requires no changes

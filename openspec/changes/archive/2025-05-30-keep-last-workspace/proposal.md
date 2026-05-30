## Why

Refreshing the browser loses both the selected workspace and the selected board, forcing users to re-navigate every time. Additionally, the workflow YAML editor — which was previously accessible via a pencil button on the board header — was removed during workflow management refactoring, making it harder to quickly edit a workflow without going through the Setup screen.

## What Changes

- **Persist workspace selection**: `activeWorkspaceKey` is saved to `localStorage` and restored on page load, falling back to the first workspace if the saved value no longer exists.
- **Persist board selection**: `activeBoardId` is saved to `localStorage` and restored on page load, with validation that the board belongs to the active workspace.
- **Workflow edit button on board header**: A pencil icon button appears next to the board selector when a board is active, opening the existing `WorkflowEditorOverlay` for the current board's workflow template. The overlay auto-closes on save.
- **Extract shared `readStorage<T>` utility**: The `readStorage` helper currently duplicated across `terminal.ts`, `drawer.ts`, `ChatSidebar.vue`, and `BoardView.vue` is extracted to a shared utility and used in the new store changes.

## Capabilities

### New Capabilities

- `board-selection-persistence`: Persist and restore active workspace and board selections across page reloads using localStorage.
- `board-header-workflow-edit`: Quick-access workflow YAML editor button on the board header, scoped to the active board's workflow template.

### Modified Capabilities

- `board`: Board store gains localStorage-backed `activeBoardId` init and persistence.
- `workspace`: Workspace store gains localStorage-backed `activeWorkspaceKey` init and persistence.

## Impact

- `src/mainview/stores/workspace.ts` — adds localStorage read/watch
- `src/mainview/stores/board.ts` — adds localStorage read/watch
- `src/mainview/App.vue` — passes `activeWorkspaceKey` to `boardStore.loadBoards()` (cross-store validation now lives inside the board store)
- `src/mainview/views/BoardView.vue` — adds pencil button + `WorkflowEditorOverlay` wiring
- `src/mainview/utils/storage.ts` — new shared utility (no existing consumers changed in behavior)
- `src/mainview/stores/terminal.ts`, `stores/drawer.ts`, `components/ChatSidebar.vue` — refactored to use shared utility (no behavior change)

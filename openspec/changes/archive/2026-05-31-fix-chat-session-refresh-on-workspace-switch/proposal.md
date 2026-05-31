## Why

The chat session list refreshes correctly on workspace switch via `useSessionSyncHandler` composable, but board lists do NOT reload when switching workspaces. This causes stale board data: after a workspace switch, `boardStore.selectFirstBoardInWorkspace()` operates on a pre-cached board array that may not include boards created in other workspaces during the session. The bug persists because only sessions are synced — boards remain loaded once at app mount.

## What Changes

- **Add board reload on workspace switch**: Extend `useSessionSyncHandler` or create a parallel `useBoardSyncHandler` to reload `boardStore.loadBoards()` when the active workspace changes, ensuring board list is always fresh.
- **Consolidate workspace-scope reloads**: Move both session and board sync into a single coordination mechanism so all dependent state updates atomically for the new workspace.
- **No spec-level requirement changes**: Board reload on workspace switch is implied by existing `workspace` spec ("switching workspace preserves other workspaces" → requires loading correct data for target workspace), but no new normative requirements are added.

## Capabilities

### New Capabilities
<!-- None — this is a bug fix aligned with existing patterns -->

### Modified Capabilities
- `workspace`: Clarified that "preserves other workspaces" implies re-loading boards for the target workspace on switch, not just preserving their database records.

## Impact

| Area | Files |
|------|-------|
| Composable (new) | `src/mainview/composables/useBoardSyncHandler.ts` — mirrors `useSessionSyncHandler` pattern for boards |
| App.vue | `src/mainview/App.vue` — adds board sync handler alongside existing session sync |
| Store: board | `src/mainview/stores/board.ts` — no code changes, receives cross-store import dependency |
| View: BoardView | `src/mainview/views/BoardView.vue` — removes manual `selectFirstBoardInWorkspace()` call from `onWorkspaceChange` |
| Tests | No test files changed (test suite covered separately) |

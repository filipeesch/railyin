## 1. Shared Storage Utility

- [x] 1.1 Create `src/mainview/utils/storage.ts` with `readStorage<T>(key, fallback)` helper
- [x] 1.2 Migrate `terminal.ts` to import `readStorage` from shared utility (remove local copy)
- [x] 1.3 Migrate `drawer.ts` inline localStorage reads to use `readStorage`
- [x] 1.4 Migrate `ChatSidebar.vue` inline localStorage read to use `readStorage`
- [x] 1.5 Migrate `BoardView.vue` `loadChatSidebarOpen()` function to use `readStorage`

## 2. Persist Workspace Selection

- [x] 2.1 In `workspace.ts`: initialise `activeWorkspaceKey` from `readStorage("railyn.activeWorkspaceKey", null)`
- [x] 2.2 In `workspace.ts`: add `watch(activeWorkspaceKey, ...)` to persist to `localStorage`
- [x] 2.3 In `workspace.ts` `loadWorkspaces()`: validate persisted key exists in fetched list; fall back to `workspaces[0].key` if not found

## 3. Persist Board Selection

- [x] 3.1 In `board.ts`: initialise `activeBoardId` from `readStorage("railyn.activeBoardId", null)`
- [x] 3.2 In `board.ts`: add `watch(activeBoardId, ...)` to persist to `localStorage`
- [x] 3.3 In `board.ts` `loadBoards()`: validate persisted id exists in fetched list; fall back to `boards[0].id` if not found

## 4. Cross-Store Validation on Boot

- [x] 4.1 Extend `board.ts` `loadBoards()` signature to `loadBoards(workspaceKey?: string)`: after fetching boards, if `activeBoardId` is set and the matching board's `workspaceKey` does not equal `workspaceKey`, reset `activeBoardId` to the first board of that workspace
- [x] 4.2 In `App.vue`: update `boardStore.loadBoards()` call to pass `workspaceStore.activeWorkspaceKey`

## 5. Workflow Edit Button on Board Header

- [x] 5.1 In `BoardView.vue`: add `workflowEditor` ref state (`{ visible, templateId, templateName, yaml }`)
- [x] 5.2 In `BoardView.vue`: add `openWorkflowEditor()` function that calls `workflow.getYaml` and populates state
- [x] 5.3 In `BoardView.vue` template: add pencil `<Button>` with `v-if="boardStore.activeBoard"` immediately after the board `<Select>`
- [x] 5.4 In `BoardView.vue` template: add `<WorkflowEditorOverlay>` instance wired to `workflowEditor` state with `@close` and `@saved` both closing the overlay
- [x] 5.5 In `BoardView.vue`: import `WorkflowEditorOverlay` component

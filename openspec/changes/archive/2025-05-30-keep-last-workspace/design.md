## Context

The board UI currently loses two key pieces of UI state on every page reload:
- **Active workspace** — `activeWorkspaceKey` in `workspace.ts` initialises to `null` and always falls back to the first workspace returned by the API.
- **Active board** — `activeBoardId` in `board.ts` initialises to `null` and always falls back to the first board of the workspace.

Additionally, the in-header workflow YAML editor pencil button was removed in the `workflow management and seeding` refactor (commit `0cff69f`). The `WorkflowEditorOverlay` component, `workflow.getYaml`, and `workflow.saveYaml` RPCs all remain intact — only the board-header entrypoint was removed.

The `terminal.ts` store demonstrates the established pattern for UI persistence: a local `readStorage<T>` helper reads from `localStorage` at store init, and `watch()` persists each value back on change.

## Goals / Non-Goals

**Goals:**
- Restore active workspace and board on page reload without any backend changes
- Add a quick-access workflow editor button to the board header (inline, next to the board selector)
- Extract the `readStorage<T>` helper to a shared utility to eliminate duplication across 4+ files

**Non-Goals:**
- Server-side session persistence
- Persisting any other UI state beyond workspace and board selection
- Changes to the workflow YAML editor itself (`WorkflowEditorOverlay`)
- Adding the edit button to any surface other than the board header

## Decisions

### D1: localStorage in the store, not in the component
Persist `activeWorkspaceKey` in `workspace.ts` and `activeBoardId` in `board.ts` via `watch()`. The component (`BoardView.vue`, `App.vue`) does not need to know about persistence — stores stay the single source of truth.

**Alternative considered**: Persist in `BoardView.vue` or `App.vue`. Rejected — stores are the right owner; components should not manage persistence of store state.

### D2: Validate saved values on load — guard lives inside the store
On `loadWorkspaces()`, if the persisted key is not present in the fetched list, fall back to `workspaces[0].key`. On `loadBoards(workspaceKey?)`, if the persisted id is not present in the fetched list OR belongs to a different workspace than `workspaceKey`, fall back to `boards[0].id` for that workspace. The cross-workspace guard is owned by the board store, not by `App.vue`.

`App.vue` becomes thin: `await boardStore.loadBoards(workspaceStore.activeWorkspaceKey)`. Internal store calls (`createBoard`, `updateBoard`) pass no argument.

**Alternative considered**: Unconditionally restore without validation. Rejected — deleted workspaces/boards would leave the app in a broken state.
**Alternative considered**: Keep the cross-workspace guard in `App.vue`. Rejected — the store should own its own consistency invariant and be independently testable.

### D3: Pencil button is `v-if`, not `:disabled`
The workflow edit button is conditionally rendered (`v-if="boardStore.activeBoard"`) rather than always-present-but-disabled. A disabled button with no label gives no affordance; hiding it is cleaner since there is no board context to edit when empty anyway.

### D4: Workflow overlay auto-closes on save
`WorkflowEditorOverlay` already emits both `saved` and `close` from its `onSave()`. Binding `@close="workflowEditor.visible = false"` covers both the Cancel path and the save path — no extra handler needed.

### D5: Shared `readStorage<T>` utility
A single `src/mainview/utils/storage.ts` module exposes `readStorage<T>(key, fallback)`. Terminal, drawer, ChatSidebar, and BoardView are migrated to use it. This is a pure refactor — no behavior change.

**Key: namespace** — all new keys are prefixed `railyn.` (e.g. `railyn.activeWorkspaceKey`) consistent with the existing `railyn.chatSidebarOpen` key.

## Risks / Trade-offs

- **Stale keys after workspace/board delete** → Mitigated by the validation-on-load fallback in D2.
- **Board belongs to wrong workspace** → Mitigated by the cross-store guard in `App.vue`.
- **readStorage migration touches 4 existing files** → All changes are mechanical (swap `JSON.parse(localStorage.getItem(key))` for `readStorage(key, fallback)`). No logic changes.
- **localStorage unavailable (SSR / test env)** → The existing `readStorage` pattern already guards with `typeof localStorage === "undefined"`.

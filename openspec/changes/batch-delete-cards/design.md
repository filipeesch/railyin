## Context

The board view (`src/mainview/views/BoardView.vue`) renders columns of `TaskCard` components. Deleting a card today requires opening the task detail overlay (`TaskDetailOverlay.vue`) and clicking its trash icon. There is no multi-select mechanism on the board.

The existing `tasks.delete` RPC handler already cancels running executions, removes the worktree, cascades DB deletes, and returns an optional warning. We will reuse it for each selected card instead of introducing a new backend endpoint.

## Goals / Non-Goals

**Goals:**
- Add a topbar control that enters a selection mode for cards on the active board.
- Render a checkbox on each card during selection mode.
- Allow selecting/deselecting cards by clicking the card body.
- Delete all selected cards after a confirmation dialog.
- Keep selection state local to the board view.

**Non-Goals:**
- New backend RPC or batch DB transaction.
- Column-restricted selection (e.g., backlog only).
- Keyboard shortcuts or shift-range selection.
- Persisting selection across navigation.

## Decisions

### 1. Reuse `tasks.delete` per card
**Why:** No backend changes are needed. The existing handler already handles running executions, worktree cleanup, cascade deletes, and warnings. A new `tasks.deleteBatch` RPC would add backend complexity and testing surface for marginal gain.

**Alternative considered:** New `tasks.deleteBatch` RPC — rejected to keep the change frontend-focused and avoid backend migration/testing.

### 2. Selection state lives in a local composable
**Why:** Selection is a transient UI concern tied to the board view. A dedicated `useCardSelection()` composable keeps `BoardView` from accumulating more responsibilities and avoids polluting the global task store.

**Alternative considered:** Add selection state to `useTaskStore` — rejected because it would make global state out of a purely local view mode.

### 3. PrimeVue Dialog for confirmation
**Why:** The app already uses PrimeVue Dialog for destructive confirmation in `SetupView.vue` (project deletion). Reusing the same component keeps UX consistent.

**Alternative considered:** Native `window.confirm()` — rejected because it is less flexible and inconsistent with the app's dialog style.

### 4. Whole-card toggle in selection mode
**Why:** Larger hit targets make selection faster, especially on trackpads or touch devices. The checkbox provides clear visual state without requiring precise clicks.

**Alternative considered:** Checkbox-only toggle — rejected because it requires more clicks and smaller targets.

### 5. Separate Cancel button in selection mode
**Why:** Gives users an explicit, discoverable way to exit selection mode without deleting. A single toggle button would change meaning between enter and exit, which can be confusing.

### 6. Explicit props for selection state
**Why:** `TaskCard` remains a pure presentational component. Passing `selectable`, `selected`, and `onSelect` from `BoardView` through `BoardColumn` makes the component easy to unit test with Vue Test Utils and avoids hidden coupling to `useCardSelection`.

**Alternative considered:** `TaskCard` imports `useCardSelection` directly — rejected because it couples presentation to a specific transient state mechanism.

### 7. Inline confirmation dialog
**Why:** The dialog is small and tightly coupled to `BoardView`'s selection state. Keeping it inline avoids a single-use component and extra prop plumbing.

**Alternative considered:** Separate `BatchDeleteConfirmDialog.vue` — rejected because reuse is unlikely and the dialog is simple.

### 8. Testable via existing RPC mock
**Why:** `taskStore.deleteTasks` is tested by mocking the `api()` RPC layer, matching the existing `task.test.ts` pattern. No dependency injection of `deleteTask` is needed.

**Alternative considered:** Inject `deleteTask` into `deleteTasks` for stubbing — rejected because it adds a parameter used only for tests and complicates the public API.

## Risks / Trade-offs

- [Risk] Deleting N cards causes N sequential RPC round trips.  
  **Mitigation:** For typical board sizes this is acceptable; if latency becomes an issue later, a backend batch endpoint can be introduced without changing the UI contract.

- [Risk] A card deleted by another client while selection mode is active could leave a stale selected ID.  
  **Mitigation:** `taskStore.deleteTask` already removes the task from local state; the selection set is filtered against remaining tasks before deletion.

- [Risk] Drag-and-drop and selection click may conflict.  
  **Mitigation:** Selection toggling only happens on `click`, while drag uses `pointerdown`/`pointermove`/`pointerup`. The existing 200 ms drag-end guard prevents accidental drawer opens after drag.

## Migration Plan

No migration needed. The change is purely additive frontend behavior and reuses the existing `tasks.delete` RPC.

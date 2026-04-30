## Context

The Boards tab in `SetupView.vue` currently only offers a create-board form and a read-only name list. There is no way to rename, delete, or reconfigure a board from the UI. The Projects tab — added in the previous workspace-management milestone — established the pattern: an actionable list with Edit/Delete buttons per row, a dedicated dialog component for create/edit, and inline confirm dialogs for delete.

`SetupView.vue` is 686 lines and growing. All tab logic lives in one file. The boards section will add significant state (dialog visibility, form state, delete confirmation, toast feedback) that warrants extraction.

Backend gaps: `boards.ts` handler only exposes `boards.list` and `boards.create`. Update and delete are missing. The handler also takes `db: Database` as a constructor argument, inconsistent with every other handler module which calls `getDb()` internally.

## Goals / Non-Goals

**Goals:**
- Full board CRUD from the Setup UI: create, rename, change workflow template, reassign projects, delete
- Consistent UX with the Projects tab (same list style, same dialog-per-edit pattern)
- Extract board tab concern into `BoardSetupTab.vue` (Single Responsibility)
- Fix `boardHandlers` DI inconsistency
- Protect board delete when tasks exist (backend throws; frontend shows toast pre-flight)
- Inline warning when changing workflow template on a board with existing tasks

**Non-Goals:**
- Workflow YAML editing (already handled by `WorkflowEditorOverlay.vue`)
- Extracting the Projects or Workspace tabs (separate concern)
- DB schema migration (no ON DELETE CASCADE change needed)
- Playwright e2e tests (handled in a follow-up)

## Decisions

### D1: BoardDetailDialog.vue — mirrors ProjectDetailDialog

**Decision:** Create a new `BoardDetailDialog.vue` component that handles both create and edit modes (controlled by presence of a `board` prop), emitting a `save` event with the form data. The parent (`BoardSetupTab`) drives the save lifecycle through `setSaving()` / `setSaveError()` exposed methods.

**Rationale:** Mirrors `ProjectDetailDialog.vue` exactly — same prop/emit contract, same parent-controlled async saving pattern. Consistency lowers cognitive load for future contributors. Board fields (name, workflow, projects) are few enough to fit in one dialog.

**Alternative considered:** Inline form in `BoardSetupTab` — rejected because it mixes list and form state, and diverges from the established Projects pattern.

---

### D2: Project assignment via checkbox list

**Decision:** Render workspace projects as a scrollable checkbox list inside the dialog. Each row: `[✓] project-name`.

**Rationale:** Projects per workspace are typically 2–10. Checkboxes are always visible (no dropdown interaction), accessible, and require no new PrimeVue component imports. PrimeVue's `MultiSelect` was considered but adds unnecessary complexity for a small list.

**Alternative considered:** Native `<select multiple>` — rejected due to poor UX (Ctrl+click multi-select is non-obvious).

---

### D3: BoardSetupTab.vue — extract boards concern from SetupView

**Decision:** All board-related state, computed values, and methods move from `SetupView.vue` into a new `BoardSetupTab.vue`. `SetupView` renders `<BoardSetupTab />` in the Boards TabPanel with no props.

**Rationale:** SetupView is already 686 lines. Adding board CRUD state (dialog, delete confirm, workflow options, toast) would push it past 800. BoardSetupTab reads from stores directly (same pattern as other components) so no prop drilling is needed.

**What moves:** `loadWorkflowOptions`, `setWorkflowOptions`, `workflowOptions`, `boardName`, `boardWorkflowTemplateId`, `boardSaving`, `boardError`, `createBoard` function, and the workspace watcher clause that triggers workflow option loading.

---

### D4: Delete and workflow warning use `board.taskCount` — not tasksByBoard

**Decision:** `boards.list` returns `taskCount: number` per board (via SQL `LEFT JOIN COUNT`). `BoardSetupTab` and `BoardDetailDialog` read `board.taskCount` directly. `taskStore.tasksByBoard` is NOT used for these pre-flight checks.

**Rationale:** `tasksByBoard` is only populated when the board has been visited in the current session. In a fresh session (user opens Setup before visiting any board), `tasksByBoard[boardId]` is `undefined`, making the pre-flight check silently wrong. `board.taskCount` is always present because it comes from the `boards.list` response. This also makes Playwright tests trivial: `makeBoard({ taskCount: 3 })` vs `makeBoard({ taskCount: 0 })` without any navigation setup.

**What changes:** `boards.list` SQL becomes:
```sql
SELECT b.*, COUNT(t.id) as task_count
FROM boards b LEFT JOIN tasks t ON t.board_id = b.id
GROUP BY b.id ORDER BY b.created_at ASC
```
`BoardRow` is cast inline as `BoardRow & { task_count: number }` (no row type pollution). `mapBoard()` accepts an optional `taskCount` and includes it in the returned `Board`. `Board` interface gains `taskCount: number`. `boards.update` re-fetches with the same COUNT subquery before returning.

**Alternative considered:** Rely on `taskStore.tasksByBoard` for pre-flight — rejected because it silently fails in fresh sessions and requires convoluted multi-step navigation in Playwright tests.

---

### D5: boardHandlers() uses getDb() internally

**Decision:** Remove the `db: Database` parameter from `boardHandlers`. Call `getDb()` at the top of each handler function. Update the single call site in `index.ts`.

**Rationale:** All other handler modules (`projectHandlers`, `taskHandlers`, etc.) use `getDb()` internally. `boardHandlers` is the only outlier. Fixing this removes a cognitive inconsistency with no functional change.

---

### D6: boards.update — partial update, reload-list strategy

**Decision:** `boards.update` accepts `{ id, name?, workflowTemplateId?, projectKeys? }` and returns the updated `Board`. The frontend calls `boardStore.loadBoards()` after a successful update to refresh the full list (including the embedded template object).

**Rationale:** Boards are few; a full reload is cheap and avoids stale template data in the store when `workflowTemplateId` changes. Selective in-place patching would require re-resolving the template from config on the frontend, which duplicates backend logic.

## Risks / Trade-offs

- **Workflow orphan risk** → Mitigated by the inline non-blocking warning in the edit dialog when `workflowTemplateId` changes on a board with tasks. Tasks remain in DB; they simply won't appear in columns until moved or the template is restored.
- **SetupView watcher partial removal** → The existing `watch(activeWorkspaceKey)` in SetupView calls `loadWorkflowOptions` among other things. Moving workflow option loading to `BoardSetupTab` means the watcher in SetupView loses that clause; care must be taken not to break the remaining watcher responsibilities (model reload, wsForm sync).

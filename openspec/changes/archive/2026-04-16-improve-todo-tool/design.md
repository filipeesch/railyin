## Context

The todo tool currently lives exclusively in `src/bun/workflow/tools.ts`, which is only executed by the native engine. Copilot and Claude engines use `engine/common-tools.ts` for their shared tools. This means the todo feature is completely unavailable to those engines.

The existing schema (`task_todos`) has: `id`, `task_id`, `title`, `status` (not-started/in-progress/completed), `result`, `created_at`, `updated_at`. No ordering field, no rich description.

The `TodoPanel.vue` component is read-only — it displays todos but offers no user interaction beyond expanding/collapsing.

## Goals / Non-Goals

**Goals:**
- Move the todo tool group into `engine/common-tools.ts` so Copilot, Claude, and Native engines all share it
- Extend the schema with `number REAL` (float ordering) and `description TEXT` (rich markdown memory)
- Replace status values with: `pending`, `in-progress`, `done`, `blocked`, `deleted` (`deleted` = soft-delete via status)
- Expose 6 model-callable tools: `create_todo`, `edit_todo`, `delete_todo`, `list_todos`, `get_todo`, `reprioritize_todos`
- Write ALWAYS/NEVER tool descriptions so models know when and how to use these tools
- Add a `TodoDetailOverlay.vue` (non-fullscreen) for viewing/editing todo description as markdown preview + edit toggle
- Add per-item delete button in `TodoPanel.vue`; user can also create and edit todos from the UI

**Non-Goals:**
- No cross-task todo visibility (todos remain scoped to their task)
- No real-time collaboration or conflict resolution on todos
- No drag-and-drop reorder (reprioritize is done via the `reprioritize_todos` tool or by editing number)
- No todo templates or recurring todos

## Decisions

### D1: Todos move to `common-tools.ts` (not a separate file)
**Decision**: Add the todo tool group directly to `common-tools.ts` alongside the task management tools.

**Rationale**: The pattern is already established — `COMMON_TOOL_DEFINITIONS` array + `executeCommonTool` switch + `buildCommonToolDisplay`. Adding a todos group here requires zero engine adapter changes; Copilot and Claude pick it up automatically. A separate file would require wiring into every engine adapter.

**Alternative considered**: A separate `common-todo-tools.ts` module. Rejected — would require each engine adapter to import and register it separately, and the group is small enough to live alongside the existing tools.

### D2: Float ordering with `reprioritize_todos` for bulk reorder
**Decision**: The `number` column is `REAL`. Models set it freely on create (e.g., 1.0, 2.0, 2.5 to insert between). `reprioritize_todos` accepts `[{id, number}]` and rewrites all numbers atomically in a single transaction.

**Rationale**: Float space allows mid-sequence insertion without touching unrelated rows. This matches how tools like Linear and Notion order items internally. The bulk rewrite tool handles cleanup when the order gets messy.

**Alternative considered**: Integer sequence auto-maintained by the system (always 1, 2, 3…). Rejected — every insert requires a renumber sweep; float is simpler at the tool call level.

### D3: `deleted` is a status value, not a column
**Decision**: Soft-delete is implemented by setting `status = 'deleted'`. No separate `deleted_at` column.

**Rationale**: Keeps the schema minimal. `list_todos` and `get_todo` filter out `deleted` items by default. The model's `delete_todo` tool (which sets status=deleted) can be surfaced in the UI as a "remove" button. If full audit is needed later, `deleted_at` can be added as a migration.

**Alternative considered**: Separate `deleted_at` timestamp column. Rejected — unnecessary complexity for this use case.

### D4: `description` is required on `create_todo`
**Decision**: `description` is a required parameter in `create_todo`. The tool description uses ALWAYS/NEVER to mandate rich content.

**Rationale**: The entire purpose of the description field is persistent memory across context compaction. Optional fields get skipped under time/token pressure. ALWAYS statements in tool descriptions are the most reliable enforcement mechanism available.

### D5: Replace `update_todo` with `edit_todo`; separate `delete_todo`
**Decision**: `edit_todo` handles all field mutations (number, title, description, status). `delete_todo` is a separate tool that explicitly sets `status = 'deleted'`.

**Rationale**: A dedicated `delete_todo` tool makes the intent clear and allows a distinct display label ("deleted todo #2"). The ALWAYS/NEVER description can specifically guide when to delete vs. mark done vs. mark blocked.

### D6: `TodoDetailOverlay.vue` — non-fullscreen panel overlay
**Decision**: A compact overlay (not full-screen) that opens when the user clicks a todo item. Shows number + title in header (editable), markdown preview of description, toggle to edit mode (textarea). Delete button in header.

**Rationale**: Matches the pattern of existing overlays in the codebase (`WorkflowEditorOverlay.vue`). Non-fullscreen keeps context — user can see the chat behind it. The description can be long (rich spec) so inline expansion in `TodoPanel.vue` would make the panel unmanageable.

## Risks / Trade-offs

- **Migration complexity**: Existing `task_todos` rows have `status = 'not-started'` or `'completed'`. Migration must UPDATE these to `pending`/`done` alongside the ALTER TABLE for new columns. → Mitigation: explicit SQL UPDATE in the migration before renaming values.
- **Native engine duplication**: After moving todos to `common-tools.ts`, the native engine's `workflow/tools.ts` must remove the old todo handlers to avoid double-registration. → Mitigation: remove the `todos` group from the native tool definitions and handler switch as part of this change.
- **Float number collisions**: Models may assign the same number to two todos. `list_todos` should ORDER BY `number, id` (stable tie-break). → No hard constraint needed; the model can reprioritize.
- **description token cost**: Rich descriptions add tokens to every system injection that includes the todo list. → `list_todos` returns only `id, number, title` — description is only fetched via `get_todo`. System injections use list format.

## Migration Plan

1. Add migration `020_todo_v2` (or next available):
   - `ALTER TABLE task_todos ADD COLUMN number REAL NOT NULL DEFAULT 0`
   - `ALTER TABLE task_todos ADD COLUMN description TEXT NOT NULL DEFAULT ''`
   - `UPDATE task_todos SET status = 'pending' WHERE status = 'not-started'`
   - `UPDATE task_todos SET status = 'done' WHERE status = 'completed'`
   - Backfill `number` from `id` ordering: `UPDATE task_todos SET number = id` (preserves existing relative order)
2. Rewrite `src/bun/db/todos.ts` with new helpers matching the new schema
3. Add todo tool group to `COMMON_TOOL_DEFINITIONS` in `common-tools.ts`
4. Add todo cases to `executeCommonTool` and `buildCommonToolDisplay`
5. Remove todo group from `workflow/tools.ts`
6. Update `TodoItem` in `rpc-types.ts` with new fields
7. Update `TodoPanel.vue` + add `TodoDetailOverlay.vue`
8. Update `todos.list` RPC handler; add `todos.get`, `todos.create`, `todos.edit` handlers

**Rollback**: No rollback risk on schema — new columns have defaults. If deploy fails, old code still runs (new columns ignored). The status rename is the only irreversible part; a reverse migration can rename them back.

## Open Questions

- Should `list_todos` include `blocked` and `deleted` items, or filter to only active ones (`pending`, `in-progress`, `done`)? → Lean: include `blocked`, exclude `deleted` by default; add an optional `include_deleted` parameter for UI use.
- Should the UI allow the user to create todos directly (not just edit AI-created ones)? → From the task description: yes. Need a "+" button in TodoPanel header and create form in the overlay.

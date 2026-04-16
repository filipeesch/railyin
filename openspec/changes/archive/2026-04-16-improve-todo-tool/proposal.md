## Why

The todo tool is currently only available in the native engine, making it invisible to the Copilot and Claude engines. The schema also lacks the fields needed for rich context preservation — specifically a `description` field where the model can write detailed markdown specs, and a `number` field for explicit ordering — meaning context compaction can cause the model to lose track of complex multi-step work.

## What Changes

- Move todo tools from `workflow/tools.ts` (native-only) into `engine/common-tools.ts` so all engines (Copilot, Claude, Native) share them
- **BREAKING**: Replace `status` values (`not-started`, `in-progress`, `completed`) with (`pending`, `in-progress`, `done`, `blocked`, `deleted`) — `deleted` replaces a separate soft-delete field
- Add `number: REAL` column for float-based ordering (model sets numbers freely; `reprioritize_todos` bulk-rewrites order)
- Add `description: TEXT` column — rich markdown spec, required on `create_todo`, serves as persistent memory across context compaction
- Replace `update_todo` + `delete_todo` with a unified `edit_todo` tool; add a dedicated `get_todo` tool and `reprioritize_todos` tool
- Extend `TodoPanel.vue` with per-item delete button and a new `TodoDetailOverlay.vue` for viewing/editing todo description as markdown
- User can also create and edit todos via the UI overlay

## Capabilities

### New Capabilities

- `todo-tool-v2`: Revised todo tool with number ordering, rich description field, full status lifecycle (pending/in-progress/done/blocked/deleted), six model-callable tools (create, edit, delete, list, get, reprioritize), and user-editable UI overlay

### Modified Capabilities

- `task-todo-tool`: Requirements change significantly — new fields, new status values, new tool surface, moved to common-tools. All prior requirements are superseded by `todo-tool-v2`.
- `engine-common-tools`: New todo tool group added to the common tool set available across all engines.

## Impact

- `src/bun/db/todos.ts` — rewritten with new schema helpers
- `src/bun/db/migrations.ts` — new migration: add `number`, `description` columns; rename status values
- `src/bun/engine/common-tools.ts` — new todo tool group added (6 tools)
- `src/bun/workflow/tools.ts` — todo tool group removed (now in common-tools)
- `src/bun/engine/copilot/tools.ts` — no changes needed (picks up common-tools automatically)
- `src/shared/rpc-types.ts` — `TodoItem` interface updated with new fields
- `src/mainview/components/TodoPanel.vue` — delete button per item, click to open overlay
- `src/mainview/components/TodoDetailOverlay.vue` — new component
- `src/bun/handlers/tasks.ts` — `todos.list` RPC handler updated; new `todos.get`, `todos.create`, `todos.edit` handlers for UI

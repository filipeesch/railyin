## Why

AI agents currently have no way to read or modify the board they are running on. All inter-task coordination must go through worktree file conventions or the ad-hoc `created_tasks` return field. A proper tasks tool group gives agents first-class board awareness and management power, enabling orchestrator patterns and self-organising workflows.

## What Changes

- Introduce two new tool groups: `tasks_read` and `tasks_write`
- Add `get_task`, `get_board_summary`, and `list_tasks` (read tools)
- Add `create_task`, `edit_task`, `delete_task`, and `move_task` (write tools)
- `create_task` supports cross-board creation (`board_id` param)
- `move_task` is fire-and-forget — triggers `on_enter_prompt` asynchronously without blocking the calling agent
- `edit_task` enforces the same pre-worktree constraint as the UI (locked once worktree exists)
- `delete_task` reuses the full existing cascade: cancels running execution, removes worktree directory, removes all DB records, keeps the git branch
- `list_tasks` merges listing and search into a single tool with a `query` field for title/description text search
- `get_task` accepts an optional `include_messages` count to return the last N conversation messages alongside task metadata
- Register `tasks_read` and `tasks_write` as named groups in `TOOL_GROUPS` so workflow YAML can reference them

## Capabilities

### New Capabilities

- `tasks-read-tools`: `get_task`, `get_board_summary`, and `list_tasks` AI tools — read-only board introspection for agents
- `tasks-write-tools`: `create_task`, `edit_task`, `delete_task`, and `move_task` AI tools — board mutation for agents

### Modified Capabilities

- `column-tool-config`: Two new group names (`tasks_read`, `tasks_write`) become valid entries in column `tools` arrays

## Impact

- `src/bun/workflow/tools.ts` — new tool definitions and executor cases
- `src/bun/handlers/tasks.ts` — reused logic for task CRUD (edit, delete, move, create)
- `src/bun/workflow/engine.ts` — `move_task` triggers `handleTransition` fire-and-forget
- `config/workflows/*.yaml` — workflow authors can now grant `tasks_read` / `tasks_write` to columns
- No database schema changes required

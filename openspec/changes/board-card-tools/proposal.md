## Why

In chat sessions, the AI agent cannot use board tools because no board context is available — every board tool fails with "board_id is required". Agents also cannot discover what boards exist in a workspace. Additionally, "task" is confusing terminology for board items — "card" is the standard Kanban term and reduces ambiguity with the execution "task" concept.

## What Changes

- **New `list_boards` tool**: Agents can discover boards in the workspace (returns `id` + `name`). Enables board tool usage from chat sessions.
- **Rename all board task tools to card terminology**: `get_task` → `get_card`, `list_tasks` → `list_cards`, `create_task` → `create_card`, `edit_task` → `edit_card`, `delete_task` → `delete_card`, `move_task` → `move_card`, `message_task` → `message_card`. **BREAKING**: Old tool names are removed entirely.
- **Consolidate card tool definitions**: Extract card tool definitions into a single shared source (`card-tool-definitions.ts`) imported by both `common-tools.ts` and `workflow/tools/registry.ts`.
- **Update tool groups**: `tasks_read` → `cards_read`, `tasks_write` → `cards_write`.
- **Add `list_boards` to `cards_read` group**: Agents get board discovery alongside card operations.

## Capabilities

### New Capabilities
- `list-boards-tool`: AI tool that returns available boards (id + name) in the workspace, enabling board tool usage from chat sessions.

### Modified Capabilities
- `engine-common-tools`: Tool names change from task_* to card_*, list_boards added, definitions consolidated.
- `board-tool-executor`: New `execListBoards` method added to interface and implementation.

## Impact

- `src/bun/engine/card-tool-definitions.ts` — new file with shared card tool definitions
- `src/bun/engine/common-tools.ts` — imports consolidated definitions, renames all switch cases
- `src/bun/workflow/tools/registry.ts` — imports consolidated definitions, renames groups/descriptions
- `src/bun/workflow/tools/board-tool-executor.ts` — adds `execListBoards` method
- `src/bun/workflow/tools/types.ts` — adds `execListBoards` to interface
- `scripts/backfill-tool-call-display.ts` — add card tool name mappings

> **Tests are in a separate change:** `board-card-tools-tests`

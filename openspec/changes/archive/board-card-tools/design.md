## Context

Board tools (`create_task`, `list_tasks`, etc.) currently require a `board_id` parameter. In task execution contexts, `board_id` is resolved from the executing task's board automatically. In chat sessions, `boardId` is `null` — agents cannot use board tools at all because they have no way to discover available boards.

Two sources of truth exist for tool definitions: `COMMON_TOOL_DEFINITIONS` in `common-tools.ts` (engine-facing) and `TOOL_DEFINITIONS` in `workflow/tools/registry.ts` (workflow column resolution). Both define the same board tools with slightly different parameters and descriptions, creating maintenance drift.

The tool names use "task" terminology which is confusing because it collides with the internal `Task` domain concept (board items on a board are more like Kanban "cards").

## Goals / Non-Goals

**Goals:**
- Agents in chat sessions can discover boards via `list_boards` tool and then use board tools by specifying `board_id`
- Board tool names use "card" terminology (`create_card`, `list_cards`, etc.) to distinguish from internal `Task` domain objects
- Single source of truth for card tool definitions to eliminate drift between engine and workflow tool registrations
- All board tool descriptions include explicit ⚠️ BOARD TOOL warnings directing agents to use only when the user explicitly asks

**Non-Goals:**
- Workflow YAML config group name updates (user will handle manually)
- DB schema or RPC type changes (internal `Task` type, `tasks` table remain unchanged)
- Backward compatibility for old tool names

## Decisions

### 1. Consolidated tool definitions file
Create `src/bun/engine/card-tool-definitions.ts` exporting `CARD_TOOL_DEFINITIONS` and `CARD_TOOL_NAMES`. Both `common-tools.ts` and `registry.ts` import from this file.

**Why over keeping two files:** Eliminates drift risk. When a tool description or parameter changes, it's updated in one place. Both consumers get identical definitions.

### 2. Tool name mapping
```
get_task         → get_card
list_tasks       → list_cards
create_task      → create_card
edit_task        → edit_card
delete_task      → delete_card
move_task        → move_card
message_task     → message_card
get_board_summary → get_board_summary (unchanged)
(new)            → list_boards
```

**Why `task_id` parameter stays:** It's an internal database identifier — renaming it would require changes across the entire codebase (DB queries, RPC types, handlers) with no user-visible benefit. The tool name change is sufficient for agent-facing clarity.

### 3. `list_boards` returns minimal data (id + name only)
**Why not full board info:** Agents need enough to identify a board and pass its `board_id` to other tools. Full workflow template/column data is noise for this use case and bloats responses.

### 4. `board_id` remains required
**Why not auto-default:** Using the wrong board silently is worse than a clear error. The `list_boards` tool gives agents what they need to make an informed choice. Error messages will mention `list_boards`.

### 5. Tool group name changes
```
tasks_read  → cards_read
tasks_write → cards_write
```
`DEFAULT_TOOL_NAMES` updated to `["cards_read", "cards_write"]`.

## Risks / Trade-offs

- [Risk] `backfill-tool-call-display.ts` script references old tool names → Updated to handle both old and new names for historical data.
- [Risk] Workflow YAML files reference `tasks_read`/`tasks_write` groups → Out of scope — user updates manually. Existing workflows continue working until YAML is updated.

> **Test coverage** is handled by a separate change: `board-card-tools-tests`


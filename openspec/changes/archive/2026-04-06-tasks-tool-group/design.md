## Context

AI agents today operate exclusively within their git worktree. They can read files, write files, search code, and run shell commands — but they have no way to observe or modify the board they are running on. Cross-task coordination is limited to the ad-hoc `created_tasks` return convention (a free-form result field) and `spawn_agent` (which creates ephemeral, untracked children).

This design introduces two tool groups — `tasks_read` and `tasks_write` — that give agents first-class board awareness. The implementation is deliberately thin: the tool executor delegates to existing handler logic already used by the UI (`tasks.create`, `tasks.update`, `tasks.delete`, `tasks.transition`). No new data model is required for this change.

Current tool group registry in `src/bun/workflow/tools.ts`:
```
read, write, search, shell, interactions, agents, web
```

## Goals / Non-Goals

**Goals:**
- `tasks_read` group: `get_task`, `get_board_summary`, `list_tasks`
- `tasks_write` group: `create_task`, `edit_task`, `delete_task`, `move_task`
- Cross-board task creation (`board_id` param on `create_task`, defaults to current task's board)
- `move_task` triggers `handleTransition` fire-and-forget (no blocking)
- `list_tasks` merges listing and text search via an optional `query` field (searches title + description)
- `get_task` returns optional last-N conversation messages via `include_messages` param
- Both group names registered in `TOOL_GROUPS` for use in workflow YAML
- No DB schema changes

**Non-Goals:**
- Conversation content search in `list_tasks` (metadata search only in this change)
- Queued messaging / `message_task` tool (covered in a follow-on change)
- Cross-workspace board access
- Pagination beyond a configurable `limit` param

## Decisions

### Decision: Delegate to existing handler functions, not raw DB queries

The tool executor in `executeTool` will call the same logic already used by the IPC handlers in `handlers/tasks.ts` — `mapTask`, `handleTransition`, `cancelExecution`, `triggerWorktreeIfNeeded`, etc. — rather than writing parallel DB queries.

**Alternative considered:** Direct SQLite queries in `executeTool`. Rejected because it would duplicate business logic (especially the cascade delete and the worktree trigger) and create a maintenance split between UI behaviour and agent behaviour.

### Decision: `move_task` is fire-and-forget

`handleTransition` is async and may run an on_enter_prompt execution. The tool returns success immediately after updating `workflow_state` in the DB without awaiting the execution.

**Alternative considered:** Blocking until the transition completes. Rejected because an orchestrator agent calling `move_task` should not be held hostage to the target column's AI execution time, which is unbounded.

### Decision: `list_tasks` unifies listing and search

A single tool with an optional `query` field. Without `query` it is a filtered list; with `query` it additionally filters by title/description substring match (case-insensitive SQL LIKE). No separate `search_tasks` tool.

**Alternative considered:** Two separate tools. Rejected as unnecessary surface area — the calling model can use one tool for both intents.

### Decision: `edit_task` respects the pre-worktree lock

Same constraint as the UI: `edit_task` returns an error if `worktree_status` is `creating` or `ready`. This is not a safety bypass for agents.

### Decision: `delete_task` reuses existing cascade

Calls `cancelExecution` if running, then executes the same DB cascade and `git worktree remove --force` already implemented for the UI delete flow. Self-deletion is allowed; the engine handles a task deleting itself by detecting the missing task on next DB check and terminating gracefully.

### Decision: `get_task` with `include_messages`

Returns `Task` type plus, when `include_messages: N` is provided, the last N messages from the task's conversation. Messages are returned newest-first then reversed so the caller gets them in chronological order.

### Decision: Two separate group names, not one `tasks` group

`tasks_read` and `tasks_write` are registered separately so workflow authors can grant read-only board visibility without mutation rights. This mirrors the existing `read`/`write` split for filesystem tools.

## Risks / Trade-offs

- **Self-deletion mid-execution** → The engine's post-tool-call DB fetch will return null for the task; the engine should detect this and halt the loop cleanly. Risk: currently unverified — needs a test.
- **Fire-and-forget `move_task` ordering** → If an agent calls `move_task` and then immediately `get_task`, the returned `execution_state` may still be `idle` before the triggered execution starts. Agents must not rely on immediate execution state after a move.
- **`list_tasks` scale** → A board with thousands of tasks and a broad filter returns all matches. The `limit` param (default 50) mitigates this but is not enforced at the DB level for now.
- **Cross-board create** → An agent creating tasks on a board it did not originate from has no validation that the target board's project_id is valid for that board. The existing `tasks.create` handler validates this, so the risk is contained.

## Migration Plan

No migrations required. New tools are additive only. Existing workflows that do not reference `tasks_read` or `tasks_write` in their column `tools` arrays are unaffected.

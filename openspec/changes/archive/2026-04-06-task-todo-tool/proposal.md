## Why

When a model runs a complex, multi-step task it has no structured way to track its own plan across tool calls, context compaction, or sub-agent delegation. The compaction summary captures todos as lossy prose and sub-agents start with a blank slate, forcing redundant re-investigation. A model-controlled, DB-persisted todo list gives the model a structured working memory that survives compaction and enables clean, context-rich handoffs to sub-agents.

## What Changes

- New `todos` tool group with five tools: `create_todo`, `get_todo`, `update_todo`, `delete_todo`, `list_todos`
- Each todo has: `id`, `title`, `status`, `context` (written at creation — what the agent needs to know going in), and `result` (written at completion — what actually happened)
- Active todos (id/title/status only) injected as a system block on every API call, before conversation history — survives compaction transparently
- `context` and `result` are stored in DB and retrieved on demand via `get_todo(id)`, keeping injection minimal
- Sub-agents can call `list_todos` + `get_todo(id)` to discover and consume context for delegated items
- Collapsible todo panel in the chat UI, displayed above the message input box, showing progress (e.g. `2 / 4`) in collapsed state
- Compaction prompt updated: section 7 ("Pending Tasks") defers to the todo system and avoids prose summarization of items already tracked there

## Capabilities

### New Capabilities

- `task-todo-tool`: DB-persisted, task-scoped todo list controlled by the model via tools. Covers the DB schema, tool definitions, tool execution, system block injection, and sub-agent access patterns.

### Modified Capabilities

- `compaction-prompt`: Section 7 ("Pending Tasks") updated to instruct the model not to summarize todos that are managed by the todo system, to prevent drift and duplication.

## Impact

- New DB table: `task_todos` (task-scoped, with id, title, status, context, result, timestamps)
- New tool group `todos` in `src/bun/workflow/tools.ts`
- `compactMessages()` in `engine.ts`: inject todos system block alongside session notes
- `compactConversation()` system prompt updated (compaction-prompt spec)
- New Vue component for the collapsible todo panel in the task detail / chat view
- RPC: new handler to read todos for UI rendering (read-only; model writes via tools)

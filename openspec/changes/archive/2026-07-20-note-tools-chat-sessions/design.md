## Context

Chat sessions have note tools (`create_note`, `list_notes`, `update_note`) available to the AI but no UI tab for users to view created notes. `SessionChatView.vue` only has Chat and Decisions tabs, while `TaskChatView.vue` has Notes, Decisions, Info, Git, and Chat tabs. Notes are conversation-scoped (not task-scoped), so they work identically for both task and chat contexts — the only gap is the UI tab.

Additionally, task-scoped tools (todos) are exposed to chat sessions but fail at runtime with `"Error: only available within a task execution"` because they need `ctx.task.id` which is `null` for chat sessions. These tools waste AI turns and provide confusing error messages.

## Goals / Non-Goals

**Goals:**
- Add Notes tab to `SessionChatView.vue` for viewing AI-created notes in standalone chat sessions
- Filter task-scoped tools from chat sessions at the tool registration layer to prevent runtime failures
- Maintain consistency across all engines (Pi, Copilot, Claude, Cursor, OpenCode)
- Reuse existing `NotesPanel.vue` without modification

**Non-Goals:**
- Adding `delete_note` tool (deferred — backend exists but not needed now)
- Adding Notes tab to task chat (already exists)
- Adding todo tools to chat sessions (they are task-scoped)
- Refactoring todo tool definitions into separate module (cleanup opportunity, not required)

## Decisions

### Decision 1: Notes tab placement in SessionChatView
**Choice:** Add Notes tab after Decisions tab, mirroring `TaskChatView.vue` ordering.

**Rationale:** `SessionChatView.vue` already has a tab switcher with Chat and Decisions tabs. Adding Notes follows the same pattern — `NotesPanel.vue` takes a `conversationId` prop which is available via `session.conversationId`. No changes to `NotesPanel.vue` needed.

**Alternatives considered:**
- Reorder tabs to match TaskChatView exactly (Chat, Info, Git, Decisions, Notes) — rejected because Info and Git are task-specific and don't apply to sessions
- Show Notes inline below Decisions — rejected because tabs provide clear separation and reduce visual clutter

### Decision 2: Tool filtering at registration layer
**Choice:** Filter task-scoped tools in each engine's tool builder function using `ctx.task.id === null` as the condition.

**Rationale:** Filtering at registration time is cleaner than runtime guards — the tool is simply not available rather than failing when called. The `CommonToolContext` already has `task.id` which is `null` for chat sessions.

**Alternatives considered:**
- Filter in `buildCommonTools()` only — insufficient because each engine wraps definitions differently (Pi uses `AgentTool`, Copilot uses `Tool`, Claude uses `sdk.tool()`, etc.)
- Filter at `COMMON_TOOL_DEFINITIONS` level with two separate arrays (`CHAT_TOOL_DEFINITIONS` and `TASK_TOOL_DEFINITIONS`) — rejected because it creates maintenance burden and the filter condition is context-dependent

### Decision 3: Task-scoped tool identification
**Choice:** Define `TODO_TOOL_NAMES` set in `common-tools.ts` listing all todo tool names. Each engine builder checks this set when `taskId` is `null`.

**Rationale:** Explicit list is clearer than inferring from runtime guards. Follows existing pattern of `CARD_TOOL_NAMES`, `WORKSPACE_TOOL_NAMES`, and `LSP_TOOL_DEFINITIONS`.

**Tools to filter:** `create_todo`, `edit_todo`, `list_todos`, `get_todo`, `reorganize_todos`, `update_todo_status`

### Decision 4: Engine-specific filtering implementation
**Choice:** Each engine's tool builder receives `taskId` and applies filtering before wrapping definitions.

| Engine | Builder | Filter Location |
|---|---|---|
| Pi | `buildCommonTools()` in `pi/tools/common.ts` | Already has `CommonToolContext` with `task.id` |
| Copilot | `buildCopilotTools()` in `copilot/tools.ts` | Has `context: CommonToolContext` parameter |
| Claude | `buildTools()` in `claude/tools.ts` | Has `context: CommonToolContext` parameter |
| Cursor | `buildCursorTools()` in `cursor/tools.ts` | Has `context: CommonToolContext` parameter |
| OpenCode | MCP server `tools/list` | Has `contextMap` with per-conversation context |

**Rationale:** Each engine already constructs `CommonToolContext` with `task.id`. The filter is a one-line check per engine.

**OpenCode special case:** The MCP server uses static `MCP_TOOL_DEFINITIONS` derived from `COMMON_TOOL_DEFINITIONS`. Filtering requires checking the active context entry's `taskId` at `tools/list` time. If no active context exists, return all tools (conservative default).

## Risks / Trade-offs

[Risk] Filtering breaks existing tests that expect todo tools in chat sessions → **Mitigation:** Update tests to reflect new expected tool sets. Existing tests for todo tools in task context remain unchanged.

[Risk] OpenCode MCP server filtering is more complex due to static definitions → **Mitigation:** Filter at `tools/list` endpoint using context map. If context unavailable, return full set (conservative).

[Risk] Future task-scoped tools not automatically filtered → **Mitigation:** Document the `TODO_TOOL_NAMES` set as the single source of truth. Add to checklist when adding new task-scoped tools.

[Risk] Notes tab refresh timing in SessionChatView → **Mitigation:** Use same refresh trigger pattern as TaskChatView — increment `notesRefreshTrigger` when session status changes from `running` to non-running.

## Open Questions

- Should we also filter decision tools? (decisions work for chat sessions via `conversationId`, so no — they stay)
- Should we filter board tools? (board tools already work in chat sessions per `chat-session/spec.md` requirement — they stay)

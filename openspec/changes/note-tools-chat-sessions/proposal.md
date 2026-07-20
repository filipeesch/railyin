## Why

Notes created by the AI in chat sessions are invisible to users — `SessionChatView.vue` lacks a Notes tab even though `NotesPanel.vue` works with any `conversationId` and notes are conversation-scoped (not task-scoped). Additionally, task-scoped tools like `create_todo` are exposed to chat sessions but always fail at runtime with guard errors.

## What Changes

- **Add Notes tab to `SessionChatView.vue`**: Reuse `NotesPanel.vue` alongside the existing Chat and Decisions tabs, mirroring the Decisions tab pattern already in both views.
- **Filter task-scoped tools from chat sessions**: Exclude `create_todo`, `edit_todo`, `list_todos`, `get_todo`, `reorganize_todos`, and `update_todo_status` from the tool set when `taskId` is `null` (chat session context). Filtering applied at the tool registration layer so it's consistent across all engines.
- **Test infrastructure**: Extract `TODO_TOOL_NAMES` constant for clean assertions, add session fixture to Playwright fixtures (mirrors existing `task` fixture), add unit tests for tool filtering across all engines, add Playwright tests for Notes tab in session context.

## Capabilities

### New Capabilities

- `chat-session-notes-tab`: Notes tab in `SessionChatView.vue` for viewing AI-created notes in standalone chat sessions. Reuses existing `NotesPanel.vue` component with `session.conversationId`.

- `tool-context-filtering`: Context-aware filtering of task-scoped tools (todos) from chat session tool sets. Tools that require `taskId` are excluded when `taskId` is `null`, applied consistently across all engines (Pi, Copilot, Claude, Cursor, OpenCode).

### Modified Capabilities

- `task-note-tools`: Chat sessions already have note tools available; no backend change needed. This change adds the missing UI surface to make notes visible in chat sessions.

## Impact

- **Frontend**: `SessionChatView.vue` adds Notes tab, reuses `NotesPanel.vue`
- **Backend**: `common-tools.ts` adds `TODO_TOOL_NAMES` constant and task-scoped tool filtering logic; all engine tool builders (Pi, Copilot, Claude, Cursor, OpenCode) pass context through
- **Tests**: New unit tests for filtering (`tool-context-filtering.test.ts`), new Playwright tests for session notes (`session-chat-notes.spec.ts`), session fixture added to `fixtures/index.ts`
- **No breaking changes**: Notes tab is additive; tool filtering only removes tools that would have failed at runtime

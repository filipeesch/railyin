## Why

Chat in Railyin is today exclusively a feature of tasks — you cannot use the AI assistant without first creating a task. This creates friction for quick exploration, cross-task coordination, and scratchpad thinking. Users need a place to think freely with AI context before committing to a task structure.

## What Changes

- **New**: Standalone chat sessions exist at workspace level, independent of any task
- **New**: Right-side `ChatSidebar` lists all chat sessions with live status indicators (running / unread / waiting / archived)
- **New**: Session auto-naming with user rename capability (pencil button)
- **New**: Sessions auto-archive after 7 days of inactivity
- **Modified**: `conversations.task_id` becomes nullable — conversations become the universal primitive for both task chat and standalone sessions
- **Modified**: `stream_events` gains a `conversation_id` column to support query unification (no UNION needed)
- **Rewrite**: `TaskDetailDrawer.vue` is replaced by a unified `ConversationDrawer.vue` shell (PrimeVue `<Drawer>`) that serves both task and session contexts. A `useDrawerStore` manages open/close state. Task content is in `TaskChatView.vue`; session content is in `SessionChatView.vue`. Both share `ConversationPanel.vue` (composed of `ConversationBody.vue` + `ConversationInput.vue`).
- **Future (out of scope)**: Promoting a session into one or more tasks; forking task conversations

## Capabilities

### New Capabilities

- `chat-session`: Standalone AI chat sessions — create, list, rename, archive, and interact with workspace-level sessions; live status indicators; unread tracking via `last_read_at` timestamp
- `conversation-drawer`: Unified `ConversationDrawer.vue` shell (PrimeVue `<Drawer>`, right-side, resizable) used for both task and session contexts. `useDrawerStore` is the single source of truth. `TaskChatView.vue` (Chat+Info tabs) and `SessionChatView.vue` (session header + conversation only) slot into it. `ConversationPanel.vue` (`ConversationBody` + `ConversationInput`) is the shared conversation surface.
- `conversation-panel`: `ConversationPanel.vue` composed of `ConversationBody.vue` (virtual list, streaming tree, tool groups, reasoning) and `ConversationInput.vue` (textarea, model select, MCP, attachments, autocomplete). Used by both task and session views.

### Modified Capabilities

- `conversation`: `task_id` becomes nullable; adds `parent_conversation_id` and `forked_at_message_id` columns to support future forking; `stream_events` adds `conversation_id` column
- `task-detail`: `TaskDetailDrawer.vue` is replaced by `ConversationDrawer.vue` + `TaskChatView.vue` + `TaskInfoPanel.vue`. All existing task drawer features (virtual list, tool groups, streaming, attachments, autocomplete, model select, Info tab) are preserved in the new component structure.

## Impact

- **Database**: Schema migration required — `conversations.task_id NOT NULL` → nullable; new `chat_sessions` table; `stream_events.conversation_id` backfill
- **Backend**: New `chatSessions.*` RPC handlers; existing conversation/stream query paths extended to support `conversation_id` lookup
- **Frontend**: `BoardView.vue` wires `<ConversationDrawer>` (replaces `TaskDetailDrawer` + `ChatSessionPanel`); new `ConversationDrawer.vue`, `useDrawerStore.ts`, `TaskChatView.vue`, `TaskInfoPanel.vue`, `SessionChatView.vue`, `ConversationPanel.vue`, `ConversationBody.vue`, `ConversationInput.vue`, `ChatSidebar.vue` components; `chatStore` extended with session state
- **RPC types**: New `ChatSession` interface; `chatSessions.*` methods added to `RailynAPI`
- **Tests**: ~48 new Playwright tests across 2 new spec files + additions to `board.spec.ts`

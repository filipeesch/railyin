## 1. Database Migration

- [x] 1.1 Add migration: make `conversations.task_id` nullable (ALTER TABLE, preserve existing rows)
- [x] 1.2 Add migration: add `parent_conversation_id INTEGER NULL` and `forked_at_message_id INTEGER NULL` columns to `conversations`
- [x] 1.3 Add migration: create `chat_sessions` table (`id`, `workspace_key`, `title`, `status`, `conversation_id`, `last_activity_at`, `last_read_at`, `archived_at`, `created_at`)
- [x] 1.4 Add migration: add `conversation_id INTEGER NULL` column to `stream_events`
- [x] 1.5 Add migration: backfill `stream_events.conversation_id` via `JOIN conversations ON stream_events.task_id = conversations.task_id`
- [x] 1.6 Add migration: create index on `stream_events(conversation_id)`

## 2. Backend: RPC Types & Handlers

- [x] 2.1 Add `ChatSession` interface to `src/shared/rpc-types.ts`
- [x] 2.2 Add `chatSessions.*` methods to `RailynAPI` type: `list`, `create`, `rename`, `archive`, `markRead`, `sendMessage`, `getMessages`
- [x] 2.3 Implement `chatSessions.list` handler: query `chat_sessions` ordered by `last_activity_at DESC`
- [x] 2.4 Implement `chatSessions.create` handler: insert `chat_sessions` row + `conversations` row (task_id NULL), auto-generate title
- [x] 2.5 Implement `chatSessions.rename` handler: update `chat_sessions.title`
- [x] 2.6 Implement `chatSessions.archive` handler: set `status = 'archived'`, set `archived_at`
- [x] 2.7 Implement `chatSessions.markRead` handler: update `last_read_at = NOW()`
- [x] 2.8 Implement `chatSessions.sendMessage` handler: insert user message, trigger AI execution with `workspace_root` as cwd
- [x] 2.9 Implement `chatSessions.getMessages` handler: query `conversation_messages WHERE conversation_id = ?`
- [x] 2.10 Extend `getStreamEvents` in `src/bun/db/stream-events.ts` to support lookup by `conversation_id`
- [x] 2.11 Add background job: auto-archive sessions with `last_activity_at < NOW() - 7 days`
- [x] 2.12 Push `chatSession.updated` WebSocket event when session status changes

## 3. ~~Shared ConversationPanel Component~~ *(superseded by Section 8)*

> Superseded by Section 8 (Unified Conversation Drawer Rewrite). The incremental extraction approach was abandoned in favour of a full rewrite with `ConversationBody.vue`, `ConversationInput.vue`, and a thin `ConversationPanel.vue` container. See tasks 8.3, 8.4, 8.5.

## 4. ~~Docked Detail Panel Layout~~ *(superseded by Section 8)*

> Superseded by Section 8. The docked panel approach (flex-row board layout) was abandoned. The unified `ConversationDrawer.vue` uses PrimeVue `<Drawer>` as the shell. See tasks 8.1, 8.2.

## 5. Chat Sidebar Component

- [x] 5.1 Create `src/mainview/components/ChatSidebar.vue` with session list, sorted by `last_activity_at DESC`
- [x] 5.2 Implement "New Chat" button → calls `chatSessions.create` and opens the new session panel
- [x] 5.3 Implement session list item: title, status indicator, hover actions (rename pencil, archive)
- [x] 5.4 Implement inline rename (pencil icon → inline text field → blur/Enter saves)
- [x] 5.5 Implement status indicators: running (blue dot), waiting (amber dot), unread (red dot), archived (grey)
- [x] 5.6 Subscribe to `chatSession.updated` WebSocket events to update sidebar live
- [x] 5.7 Implement "Show archived" toggle to reveal archived sessions at bottom of list
- [x] 5.8 Implement empty state ("No chats yet — start one!")
- [x] 5.9 Add `chatSessions.*` state to task store (or new `chatStore`): active session id, list, unread set

## 6. ~~Chat Session Panel Component~~ *(superseded by Section 8)*

> Superseded by Section 8. `ChatSessionPanel.vue` is replaced by `SessionChatView.vue` which slots into `ConversationDrawer`. See task 8.8.

## 7. Playwright Tests

- [x] 7.1 Add `makeChatSession()` and `makeChatMessage()` factories to `e2e/ui/fixtures/mock-data.ts`
- [x] 7.2 Add `chatSessions.*` baseline stubs to `e2e/ui/fixtures/index.ts`
- [x] 7.3 Add `ws.pushChatSessionUpdated()` helper to `WsMock`
- [x] 7.4 Write `e2e/ui/chat-sidebar.spec.ts` — Suite CS-A: Sidebar rendering (9 tests)
- [x] 7.5 Write `e2e/ui/chat-sidebar.spec.ts` — Suite CS-B: Session creation & naming (6 tests)
- [x] 7.6 Write `e2e/ui/chat-sidebar.spec.ts` — Suite CS-C: Session archiving (3 tests)
- [x] 7.7 Write `e2e/ui/chat-sidebar.spec.ts` — Suite CS-D: Live WS status updates (4 tests)
- [x] 7.8 Write `e2e/ui/chat-session-drawer.spec.ts` — Suite CD-A: Opening and rendering (6 tests)
- [x] 7.9 Write `e2e/ui/chat-session-drawer.spec.ts` — Suite CD-B: Sending messages (4 tests)
- [x] 7.10 Write `e2e/ui/chat-session-drawer.spec.ts` — Suite CD-C: Streaming & execution state (4 tests)
- [x] 7.11 Write `e2e/ui/chat-session-drawer.spec.ts` — Suite CD-D: waiting_user states (5 tests)
- [x] 7.12 Write `e2e/ui/chat-session-drawer.spec.ts` — Suite CD-E: Persistence & ordering (3 tests)
- [x] 7.13 Add Suite BL to `e2e/ui/board.spec.ts`: Board layout with docked panels (4 tests)

---

## 8. Unified Conversation Drawer Rewrite (Phase 2 — Agreed Architecture)

> **Context:** After merging main, the architecture was re-evaluated. The agreed design is:
> - One `ConversationDrawer.vue` shell (PrimeVue `<Drawer>`) for both tasks AND chat sessions
> - `conversationId` is the unifying handle (both tasks and sessions have a `conversations` DB row)
> - A `useDrawerStore` controls open/close with `mode: "task" | "session" | null`
> - `TaskChatView.vue` and `SessionChatView.vue` slot into the drawer as the mode-specific content
> - `ConversationPanel.vue` is the shared chat surface used by both views
> - `TaskDetailDrawer.vue` and `ChatSessionPanel.vue` are fully replaced and deleted

### 8.1 useDrawerStore

- [x] 8.1.1 Create `src/mainview/stores/drawer.ts`
  - State: `mode: "task" | "session" | null`, `taskId: number | null`, `sessionId: number | null`, `conversationId: number | null`, `width: number`
  - Actions: `openForTask(taskId, conversationId)`, `openForSession(sessionId, conversationId)`, `close()`, `setWidth(w)`
  - Width persisted in `localStorage` key `"railyn.drawerWidth"`, default `480`
  - `open*` calls always replace current state (only one drawer at a time)
  - Remove dependency on `taskStore.activeTaskId` as the drawer trigger

### 8.2 ConversationDrawer.vue (shell)

- [x] 8.2.1 Create `src/mainview/components/ConversationDrawer.vue`
  - PrimeVue `<Drawer position="right" :modal="false" :dismissable="false">` opened when `drawerStore.mode !== null`
  - Resize handle div (same `mousedown→mousemove→mouseup` pattern as current TaskDetailDrawer ~lines 940-980, updates `drawerStore.width`)
  - `<template #header><slot name="header" /></template>` — caller fills title/status/actions
  - `<slot />` — renders either `<TaskChatView>` or `<SessionChatView>` based on `drawerStore.mode`
  - Close button calls `drawerStore.close()`
  - NO task or session specific logic in this component

### 8.3 ConversationBody.vue

- [x] 8.3.1 Create `src/mainview/components/ConversationBody.vue`
  - Purely presentational. Props: `messages: ConversationMessage[]`, `streamState?: TaskStreamState | null`, `streamVersion?: number`, `streamingToken?`, `streamingReasoningToken?`, `streamingStatusMessage?`, `streamingActiveId?: number | null`, `conversationId?: number | null`
  - **Must preserve from TaskDetailDrawer** (critical — regression risk):
    - Virtual list via `@tanstack/vue-virtual` `useVirtualizer` (perf for large conversations)
    - `StreamBlockNode` rendering when `streamState.roots.length > 0`
    - Legacy message rendering: `MessageBubble`, `ToolCallGroup` (via `pairToolMessages` util), `ReasoningBubble`
    - Auto-scroll to bottom on new messages (`watch(messages, () => nextTick(() => scrollToBottom())`)
    - Streaming status message + spinner when running with no content
  - Reference: `TaskDetailDrawer.vue` template lines ~108-210, script lines ~940-1000

### 8.4 ConversationInput.vue

- [x] 8.4.1 Create `src/mainview/components/ConversationInput.vue`
  - Works in both task AND session context. Props: `executionState: string`, `disabled?: boolean`, `placeholder?: string`, `taskId?: number | null`, `workspaceKey?: string`. Emits: `send: [text: string, attachments: Attachment[]]`, `cancel: []`
  - **Features to preserve from TaskDetailDrawer** (all workspace-level, work in both modes):
    - Textarea: `Shift+Enter` for newline, `Enter` to send
    - Model selector dropdown (`taskStore.availableModels`)
    - MCP tool selector popover (`McpToolsPopover`)
    - File attachments (chip display, remove chip, forward to send emit)
    - Send button (disabled when empty or running)
    - Cancel button (shown when `executionState === "running"`)
  - **Task-specific conditional** (`v-if="taskId != null"`): autocomplete @-mention chips using worktree file discovery
  - Reference: `TaskDetailDrawer.vue` template lines ~210-380, script lines ~700-940

### 8.5 ConversationPanel.vue (rewrite)

- [x] 8.5.1 Rewrite `src/mainview/components/ConversationPanel.vue`
  - Composes `<ConversationBody>` + `<ConversationInput>` — no task or session awareness
  - Props: union of Body + Input props. Emits: `send: [text, attachments]`, `cancel: []`
  - Current thin version is inadequate (created before main features) — full rewrite needed

### 8.6 TaskChatView.vue

- [x] 8.6.1 Create `src/mainview/components/TaskChatView.vue`
  - Slots into `ConversationDrawer` as task-mode content
  - Tab switcher: `Chat` | `Info` (only shown in task mode)
  - Chat tab: `<ConversationPanel>` wired to `taskStore` (messages, streamState, streamingToken, executionState, conversationId for selfId)
  - Info tab: `<TaskInfoPanel :taskId="taskId">`
  - Header slot content: task title, exec status badge (`Tag`), sync-files button, delete button
  - Emits via ConversationPanel: `onSend → taskStore.sendMessage(taskId, text, attachments)`, `onCancel → taskStore.cancel(taskId)`
  - Props: `taskId: number`
  - Reference: `TaskDetailDrawer.vue` lines ~50-280 for chat content + wiring

### 8.7 TaskInfoPanel.vue

- [x] 8.7.1 Create `src/mainview/components/TaskInfoPanel.vue`
  - Info tab content for tasks. Props: `taskId: number`. All data from `taskStore`
  - Content extracted from `TaskDetailDrawer.vue` lines ~280-450:
    - Workflow state selector
    - Model selector (`taskStore.availableModels`)
    - Shell auto-approve toggle + approved commands list
    - Worktree path (click → open in terminal)
    - Base branch display
    - Changed files list + sync button
    - Task todos list
    - Code review cards

### 8.8 SessionChatView.vue

- [x] 8.8.1 Create `src/mainview/components/SessionChatView.vue`
  - Replaces `ChatSessionPanel.vue`. Slots into `ConversationDrawer`
  - No tabs — full height is `<ConversationPanel>`
  - Header slot: session title (click → `<InputText>` inline rename → `Enter` → `chatStore.renameSession`), status badge (`idle`/`running`/`waiting_user`), archive button (`chatStore.archiveSession` → `drawerStore.close()`)
  - Props: `sessionId: number`
  - Wires: `chatStore.messages` + `chatStore.activeSession.status` → `ConversationPanel`, `onSend → chatStore.sendMessage`, `onCancel → chatStore.cancel`

### 8.9 Wiring (BoardView + stores)

- [x] 8.9.1 Update `BoardView.vue`: remove `<TaskDetailDrawer>` and `<ChatSessionPanel>`, add single `<ConversationDrawer>` that renders `<TaskChatView v-if="drawerStore.mode==='task'">` or `<SessionChatView v-if="drawerStore.mode==='session'">`
- [x] 8.9.2 Update task card click handler → `drawerStore.openForTask(taskId, task.conversationId)`
- [x] 8.9.3 Update `chatStore.selectSession()` → `drawerStore.openForSession(sessionId, session.conversationId)`
- [x] 8.9.4 Update `chatStore.closeSession()` → `drawerStore.close()`
- [x] 8.9.5 Update `App.vue`: remove `onTaskUpdated`-based drawer logic if it depends on `activeTaskId`, route through `drawerStore`
- [x] 8.9.6 Verify `ChatSidebar.vue` still works (it calls `chatStore.selectSession` which now routes through drawerStore)

### 8.10 Delete replaced files

- [x] 8.10.1 Delete `src/mainview/components/TaskDetailDrawer.vue` (only after all tests pass)
- [x] 8.10.2 Delete `src/mainview/components/ChatSessionPanel.vue` (only after all tests pass)
- [x] 8.10.3 Run `grep -r "TaskDetailDrawer\|ChatSessionPanel" src/` to find and clean all remaining imports

### 8.11 Playwright tests — Unified Drawer

- [x] 8.11.1 Create `e2e/ui/task-drawer.spec.ts` — task drawer via ConversationDrawer:
  - Task card click → drawer opens with task title in header
  - Chat tab active by default, Info tab switch shows TaskInfoPanel
  - Send message → POST `/api/tasks.sendMessage`
  - Streaming token → bubble appears in ConversationBody
  - Tool call group renders (ToolCallGroup)
  - Reasoning bubble renders
  - Running state → cancel visible, send disabled
  - Model selector present in ConversationInput
  - Attachment button present
  - Resize handle changes drawer width
  - Close → `drawerStore.mode === null`
  - Opening session AFTER task → drawer content switches to session mode
- [x] 8.11.2 Create `e2e/ui/chat-session-drawer.spec.ts` — session drawer via ConversationDrawer:
  - Sidebar session click → drawer opens with session title, no tabs visible
  - Send → POST `/api/chatSessions.sendMessage`
  - Status badge shows idle/running/waiting
  - Archive button → drawer closes
  - Inline rename: click title → input → enter → title updates
  - Unread dot on sidebar item before session opened
  - Opening task after session → switches to task mode
  - Model selector present (shared feature)
- [x] 8.11.3 Create `e2e/ui/conversation-body.spec.ts` — shared rendering:
  - Messages render correct bubble count
  - User vs assistant bubble styling
  - Tool call group pairing (tool_start + tool_result → single ToolCallGroup)
  - Reasoning bubble
  - Streaming token → streaming bubble
  - StreamBlockNode tree when `streamState.roots` populated
  - Virtual list: 100+ messages without DOM overflow
  - Auto-scroll on new message

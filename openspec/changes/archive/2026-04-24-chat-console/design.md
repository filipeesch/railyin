## Context

Railyin is an Electron-based AI coding assistant with a board-based task management UI. Today, every AI conversation is attached to a task — `conversations.task_id NOT NULL` is the root constraint. The `TaskDetailDrawer.vue` (1396 lines) is deeply coupled to task state: branch name, worktree status, launch config, changed files, and execution state.

The goal is to make conversations a first-class, workspace-level primitive — decoupled from tasks — while preserving all existing task chat behavior.

## Goals / Non-Goals

**Goals:**
- Standalone AI chat sessions at workspace scope (no task required)
- Shared `ConversationPanel` component used by both task and session contexts
- Live status sidebar (running / unread / waiting / archived indicators)
- DB migration that makes `task_id` nullable without breaking existing task chat
- Board layout: docked detail panel instead of floating overlay drawer

**Non-Goals:**
- Session promotion to task (future)
- Conversation forking UI (future — DB columns are added but no UI)
- Multi-project session scoping (workspace-level only)
- Message search across sessions

## Decisions

### 1. Conversations as the universal primitive

**Decision**: All queries use `conversation_id` as the primary key, not `task_id`.

**Rationale**: `stream_events` is currently keyed `(task_id, seq)`. Adding `conversation_id` to stream_events and backfilling it via `JOIN conversations` means all existing and new queries use the same `WHERE conversation_id = ?` path — no UNION, no conditional branching.

**Alternative considered**: Keep dual key paths (task queries use `task_id`, session queries use `conversation_id`). Rejected because it creates a permanent fork in query logic and makes future features (forking) harder.

### 2. ~~Docked panel~~ → Unified PrimeVue Drawer shell *(superseded)*

> **Superseded** by the "Unified Conversation Drawer" decision at the bottom of this document.

**Original decision**: Replace the PrimeVue `<Drawer>` overlay with a flex-row docked panel that compresses the board.

**Revised decision**: Keep PrimeVue `<Drawer>` as the shell (overlay, right-side, resizable) but unify it into a single `ConversationDrawer.vue` component that serves both task and session contexts. The docked panel approach was abandoned to reduce CSS layout risk and because `<Drawer>` already provides resize, dismiss, and z-index management for free.

**Rationale for revision**: The docked panel would require a full `BoardView` flex-row layout refactor with non-trivial resize-handle CSS. PrimeVue `<Drawer>` gives all the same UX (resizable width via a custom handle, right-side position, Escape to close) without changing the board layout model.

### 3. `last_read_at` timestamp for unread state

**Decision**: Use a `last_read_at` DATETIME column on `chat_sessions`. "Has unread" = `last_activity_at > last_read_at`.

**Rationale**: The current in-memory `Set<taskId>` unread tracker is lost on restart. A timestamp in DB survives restarts, enables sorting ("most recent unread first"), and makes the unread state queryable from the backend. Same pattern works for tasks (future).

**Alternative considered**: A boolean `has_unread` column. Rejected because a timestamp gives more information (how old is the unread?) at no extra cost.

### 4. `ConversationPanel` as the shared extraction point

**Decision**: Extract the conversation timeline, message bubbles, streaming renderer, and CodeMirror input into a single `ConversationPanel.vue` component. It receives `conversationId`, `entityId`, `entityType: 'task' | 'chat_session'` as props.

**Rationale**: The task drawer and session panel share ~80% of their UI. Maintaining two copies would diverge quickly. A shared component with thin wrappers is the correct split.

**Alternative considered**: Keep task drawer as-is, build session panel from scratch. Rejected because it creates immediate duplication debt.

### 5. Session naming: auto-generated, user-renameable

**Decision**: Auto-generate session names from the timestamp ("Chat – Apr 21") with a pencil-icon rename button in the sidebar item and panel header.

**Rationale**: Users need to find sessions later. Auto-naming provides a reasonable default without friction. Inline rename (no modal) is the least-friction pattern for power users.

### 6. Auto-archive after 7 days inactivity

**Decision**: A background job checks `last_activity_at < NOW() - 7 days` and sets `status = 'archived'`. Archived sessions are hidden by default with a "Show archived" toggle.

**Rationale**: Prevents the sidebar from accumulating stale sessions over time without requiring manual cleanup.

## Risks / Trade-offs

- **Migration risk on `conversations.task_id`**: This column is NOT NULL today and is referenced by several queries. Migration must be careful to not break existing task conversations. → Mitigation: Phase 1 makes it nullable and backfills; Phase 2 (separate PR) removes the column from queries.
- **`stream_events` backfill**: The `conversation_id` backfill requires a `JOIN` during migration and could be slow on large datasets. → Mitigation: Run as a separate migration step with a progress log; index `conversation_id` after backfill.
- **`TaskDetailDrawer.vue` refactor scope creep**: 1396 lines of coupled code. Extracting ConversationPanel could surface unexpected dependencies. → Mitigation: Extract incrementally, keeping task drawer working at each step. Run existing chat.spec.ts after each extraction.
- **Layout regression**: Changing from overlay to docked panel changes the CSS box model. Other components may have assumed overlay behavior. → Mitigation: Suite BL in Playwright validates layout; run full board.spec.ts as regression.

## Migration Plan

**Phase 1 (this change):**
1. Add `conversations.task_id` → nullable (ALTER TABLE)
2. Add `conversations.parent_conversation_id`, `forked_at_message_id` columns (NULL)
3. Create `chat_sessions` table
4. Add `stream_events.conversation_id` column + backfill via `JOIN`
5. Add index on `stream_events(conversation_id)`
6. Deploy — existing task conversations continue working (task_id still present)

**Phase 2 (future, separate migration):**
- Drop `task_id` from `stream_events` once all query paths use `conversation_id`

**Rollback**: Phase 1 migration is additive only (new nullable columns, new table). Rollback = drop new columns and table. No data loss.

## Open Questions

- Should the AI assistant for standalone sessions have different system prompt / toolset than task sessions? (Lean: same tools, different initial context — no project/task context in session, but workspace path injected)
- Should session `last_read_at` be updated on every panel open, or only when the user scrolls to the bottom? (Lean: on panel open, same as task unread)

---

## Architecture: Unified Conversation Drawer (Decided)

### Component Hierarchy

```
ConversationDrawer.vue              ← PrimeVue Drawer shell, resize handle, useDrawerStore
  ├── TaskChatView.vue              ← mode="task" content
  │   ├── Tab: Chat → ConversationPanel.vue
  │   └── Tab: Info → TaskInfoPanel.vue
  └── SessionChatView.vue           ← mode="session" content
      └── ConversationPanel.vue
            ├── ConversationBody.vue   (virtual list, streaming, tool groups, reasoning)
            └── ConversationInput.vue  (textarea, model, MCP, attachments, autocomplete)
```

### Decision: Single drawer shell for both tasks and sessions

**Decision**: One `ConversationDrawer.vue` (PrimeVue `<Drawer>`, right-side) replaces both `TaskDetailDrawer.vue` and `ChatSessionPanel.vue`. Mode-specific content (`TaskChatView` or `SessionChatView`) is rendered inside based on `useDrawerStore.mode`.

**Rationale**: One resize handle, one z-index story, one animation, one dismiss mechanic. `ChatSessionPanel` was a custom `position:fixed` div with none of the drawer affordances.

### Decision: useDrawerStore as single controller

**Decision**: A `useDrawerStore` Pinia store with `{ mode: 'task'|'session'|null, conversationId, taskId, sessionId, width }` is the single source of truth. Both task card clicks and session sidebar clicks call into this store.

**Rationale**: Prevents state collisions (both task and session non-null simultaneously). Width persisted to `localStorage("railyn.drawerWidth")`, default 480px. `open*` calls always replace current state — only one drawer at a time.

### Decision: conversationId as the unifying handle

**Decision**: The `conversationId` (DB `conversations.id`) is how the drawer knows which conversation to load. Tasks have `task.conversationId`; sessions have `session.conversationId`. The drawer store holds it.

**Rationale**: Consistent with Decision 1 (conversations as universal primitive). All message/stream queries use `conversation_id`.

### Decision: Rewrite from scratch, not incremental refactor

**Decision**: `TaskDetailDrawer.vue` is deleted and replaced by new components, not incrementally refactored.

**Rationale**: The file is 1300+ lines mixing drawer chrome, task info, chat, streaming, attachments, autocomplete, and resize logic. Incremental extraction risks constant partial-broken states. Rewrite with clear component boundaries, relying on Playwright tests for regression safety.

**Risk mitigation**: Existing Playwright test suites (board.spec.ts, extended-chat.spec.ts) serve as regression guard. New suites added in `e2e/ui/task-drawer.spec.ts`, `e2e/ui/chat-session-drawer.spec.ts`, `e2e/ui/conversation-body.spec.ts`.

### Decision: Workspace-level features shared, task-specific features gated

**Decision**: Model selector, MCP tools, file attachments live in `ConversationInput.vue` and work in both task and session modes. Autocomplete with worktree file discovery and task @-mention chips is gated by `taskId != null` prop.

**Rationale**: These are workspace-level capabilities, not task capabilities. Sessions should have access to the same AI tools.

### Decision: Task has Chat+Info tabs; session has no tabs

**Decision**: `TaskChatView` renders a tab switcher (Chat | Info). `SessionChatView` has no tabs — the conversation fills the full drawer body.

**Rationale**: Tasks have meaningful non-chat metadata (worktree, model, shell config, todos). Sessions are simpler — their "settings" (title, archive) live in the header actions, not a tab.

## Context

Chat sessions are stored in SQLite (`chat_sessions` table, migration 026). The frontend loads them via `chatSessions.list` on app boot and keeps in-memory state in the Pinia `chat` store. Live updates arrive via WebSocket push (`chatSession.updated`). Three gaps exist in the sync path, and there is no cleanup job for archived sessions.

**Current sync gaps:**
1. `App.vue` calls `chatStore.loadSessions(activeWorkspaceKey)` once on mount but never again — workspace switches don't reload the list.
2. `onChatSessionUpdated` in `chat.ts` appends/updates sessions regardless of workspace — sessions from workspace B bleed into workspace A's sidebar.
3. WS reconnect in `rpc.ts` backs off and reconnects but has no catchup logic — sessions created while disconnected are missed.
4. `chatSession.created` event type exists in `rpc-types.ts` and is wired in `App.vue`/`rpc.ts` but the backend never emits it; only `chatSession.updated` is broadcast.

**Missing cleanup:** `startChatSessionAutoArchiveJob` archives sessions idle > 7 days but never hard-deletes them. Child tables (`conversation_messages`, `stream_events`, `executions`) have no `ON DELETE CASCADE`, so deleting a conversation leaves orphaned rows.

## Goals / Non-Goals

**Goals:**
- Sessions reload correctly after workspace switch
- WS push events are filtered to the active workspace
- Sessions missing due to WS downtime are recovered on reconnect
- Archived sessions and all linked data are hard-deleted 7 days post-archival
- Dead `chatSession.created` code is removed
- Toolbar button shows non-archived session count badge

**Non-Goals:**
- Restoring the active session on page reload (decided: start fresh)
- Manual hard-delete from the UI (decided: archive only)
- Changing how sessions are created or archived

## Decisions

### 1. Extract `useSessionSyncHandler` composable for all session reload triggers

Both reload triggers (workspace switch and WS reconnect) are encapsulated in a single `useSessionSyncHandler({ onWsReconnect, loadSessions, watchKey })` composable in `src/mainview/composables/`. Accepts a getter `() => string | null` for the workspace key so it is fully independent of Vue reactivity — `watch(() => deps.watchKey(), ...)` works whether the source is a Pinia getter or a test stub. This replaces the inline `watch` and explicit `loadSessions` call in `App.vue`, keeps all "when to reload" logic in one testable unit, and enables proper unit tests via constructor injection (no Pinia or WsMock needed).

### 2. Filter WS push by workspace in `onChatSessionUpdated`, not at the WS layer

Filtering at the WS transport layer (broadcast channel) would require workspace awareness in the server's push, which adds complexity. Filtering in the store handler is simpler: compare `session.workspaceKey` against `workspaceStore.activeWorkspaceKey`. The store already imports other stores so the coupling is acceptable.

### 3. Re-sync on reconnect via `onWsReconnect` callback in `rpc.ts`

The reconnect handler is in `rpc.ts` (`ws.onopen` when `_wsRetries > 0`). Exposing a single `onWsReconnect` callback (same pattern as `onTaskUpdated`, `onChatSessionUpdated`) lets `App.vue` register a reload without `rpc.ts` knowing about chat. This keeps `rpc.ts` as a pure transport layer.

### 4. Hard-delete via a second interval inside `startChatSessionAutoArchiveJob`

A second `setInterval` inside the existing function avoids introducing a new module. It queries `WHERE status = 'archived' AND archived_at < datetime('now', '-7 days')` and deletes matching `chat_sessions` rows. Cascades handle child data (see migration below).

### 5. New migration `048_chat_cascade.ts` for `ON DELETE CASCADE`

SQLite doesn't support `ALTER TABLE ... ADD CONSTRAINT`. The migration must recreate affected tables with cascade constraints. Scope: only `conversation_messages` and `stream_events` need the cascade (they reference `conversations.id`). `executions` already cascades from `conversations` (check migration history). The migration must be safe to run on existing data — no data loss for task-linked conversations. Migration number `047` is taken by `conversation_sampling_preset` (merged from main).

### 6. Count badge uses `chatStore.sessions.length` (non-archived only)

`ChatSidebar.vue` already computes `activeSessions` as `sessions.filter(s => s.status !== 'archived')`. The badge on the toggle button in `BoardView.vue` reuses the same filter from the store. No new computed property needed.

## Risks / Trade-offs

- **[Risk] Migration recreating tables** → Handled by wrapping in a transaction with explicit data copy. Test on a DB with existing rows before deploying.
- **[Risk] Hard-delete job races with an open session** → The job only targets `archived` sessions. A session being actively used can never be `archived`, so no race is possible.
- **[Risk] Reconnect re-fetch during heavy load** → `loadSessions` is a lightweight indexed query. Acceptable cost on reconnect; no debounce needed.
- **[Trade-off] WS push filter drops cross-workspace events** → In a multi-workspace setup, session updates from another workspace are silently ignored in the sidebar. This is intentional per the decision to filter by active workspace. Users switching workspaces see the correct list after the watch fires.

## Migration Plan

1. Write migration `047_chat_cascade.ts` that recreates `conversation_messages` and `stream_events` with `ON DELETE CASCADE` on `conversation_id`.
2. Deploy migration — safe on live data, no schema-breaking changes to other tables.
3. Deploy backend with the hard-delete job (no new API surface).
4. Deploy frontend changes (workspace watch, WS filter, reconnect, badge, dead code removal).
5. No rollback needed for frontend; migration rollback would require recreating tables without cascade (low risk, low probability).

## 1. DB Migration — Cascade Constraints

- [x] 1.1 Create migration `048_chat_cascade.ts` that recreates `conversation_messages` with `ON DELETE CASCADE` on `conversation_id` (copy existing rows in transaction)
- [x] 1.2 Extend the same migration to recreate `stream_events` with `ON DELETE CASCADE` on `conversation_id`
- [x] 1.3 Verify migration is registered in `src/bun/db/migrations/runner.ts`

## 2. Backend — Hard-Delete Retention Job

- [x] 2.1 Add a second `setInterval` inside `startChatSessionAutoArchiveJob` in `src/bun/handlers/chat-sessions.ts` that deletes `chat_sessions` rows with `status = 'archived' AND archived_at < datetime('now', '-7 days')` (cascade handles child data)

## 3. Frontend — Dead Code Removal

- [x] 3.1 Remove `chatSession.created` from the push event union in `src/shared/rpc-types.ts`
- [x] 3.2 Remove `onChatSessionCreated` export from `src/mainview/rpc.ts`
- [x] 3.3 Remove the `onChatSessionCreated` import and registration call from `src/mainview/App.vue`

## 4. Frontend — Workspace Filter on WS Push

- [x] 4.1 In `onChatSessionUpdated` in `src/mainview/stores/chat.ts`, import `useWorkspaceStore` and skip processing if `session.workspaceKey !== workspaceStore.activeWorkspaceKey`

## 5. Frontend — `useSessionSyncHandler` Composable

- [x] 5.1 Create `src/mainview/composables/useSessionSyncHandler.ts` with signature `useSessionSyncHandler({ onWsReconnect, loadSessions, watchKey })` — a `watch` on `watchKey` with `immediate: true` handles both initial load and workspace switches; the `onWsReconnect` callback triggers a reload on reconnect
- [x] 5.2 In `src/mainview/App.vue`, replace the explicit `chatStore.loadSessions()` call and the standalone `watch(activeWorkspaceKey, ...)` for sessions with a single `useSessionSyncHandler(...)` call wired to `onWsReconnect`, `chatStore.loadSessions`, and `() => workspaceStore.activeWorkspaceKey`

## 6. Frontend — Re-sync on WebSocket Reconnect

- [x] 6.1 In `src/mainview/rpc.ts`, expose an `onWsReconnect` callback (same pattern as `onTaskUpdated`) that fires when `ws.onopen` triggers after at least one retry (`_wsRetries > 0` checked before reset)

## 7. Frontend — Session Count Badge on Toolbar Button

- [x] 7.1 In `src/mainview/views/BoardView.vue`, compute the non-archived session count from `chatStore.sessions` and render a small badge on the chat toggle button when count > 0

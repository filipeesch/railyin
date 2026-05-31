## Why

Chat sessions exist in SQLite but the sidebar fails to stay in sync across browser tabs, workspace switches, and WebSocket reconnects — making sessions appear missing even though they are persisted. A cleanup job for archived sessions is also absent, letting archived data accumulate indefinitely.

## What Changes

- **Fix**: `App.vue` watch on `activeWorkspaceKey` now calls `chatStore.loadSessions()` so switching workspaces reloads the correct session list.
- **Fix**: `onChatSessionUpdated` in `chat.ts` filters incoming WS push events by the active workspace key, preventing sessions from other workspaces bleeding into the sidebar.
- **Fix**: WS reconnect handler in `rpc.ts` exposes an `onWsReconnect` callback; a new `useSessionSyncHandler` composable wires both the WS reconnect and workspace-switch triggers into a single testable unit — replacing the standalone `loadSessions` call and `watch` in `App.vue`.
- **Fix**: `ChatSidebar` (and toolbar toggle) show a count badge of non-archived sessions so users in a fresh browser window know sessions exist.
- **Feature**: Background job hard-deletes archived sessions (and all linked data) 7 days after archival.
- **Cleanup**: Remove dead `chatSession.created` event type from `rpc-types.ts`, `rpc.ts`, and `App.vue` — backend never emits it, only `chatSession.updated`.

## Capabilities

### New Capabilities

- `chat-session-retention`: Background hard-delete job for archived chat sessions and their linked data (conversations, messages, stream events, executions, decision records) after 7 days.

### Modified Capabilities

- `chat-session`: Session list sync — add workspace filter on WS push, reload on workspace switch, re-sync on reconnect, and count badge on toggle button.

## Impact

- `src/mainview/composables/useSessionSyncHandler.ts` — new composable owning both session reload triggers
- `src/mainview/App.vue` — replace explicit loadSessions + watch with composable; remove dead code
- `src/mainview/stores/chat.ts` — workspace filter in `onChatSessionUpdated`
- `src/mainview/rpc.ts` — expose `onWsReconnect` callback
- `src/mainview/views/BoardView.vue` — count badge on chat toggle button
- `src/bun/handlers/chat-sessions.ts` — add hard-delete job alongside the existing auto-archive job
- `src/bun/db/migrations/` — new migration adding `ON DELETE CASCADE` to `conversation_messages`, `stream_events`, `executions` for chat-owned conversations
- `src/shared/rpc-types.ts` — remove `chatSession.created` event type

## 1. Database

- [x] 1.1 Add migration `031_conversation_pagination_index` adding composite index `(conversation_id, id DESC)` on `conversation_messages`

## 2. Backend & Shared Types

- [x] 2.1 Update `conversations.getMessages` RPC type in `src/shared/rpc-types.ts` — params add `beforeMessageId?: number` and `limit?: number`; response changes from `ConversationMessage[]` to `{ messages: ConversationMessage[], hasMore: boolean }`
- [x] 2.2 Implement paginated query in `src/bun/handlers/conversations.ts` — fetch `limit + 1` rows `ORDER BY id DESC`, reverse, set `hasMore`, default `limit = 50`
- [x] 2.3 Update `chatSessions.getMessages` handler in `src/bun/handlers/chat-sessions.ts` to delegate to the same paginated conversation query (thin wrapper)
- [x] 2.4 Write backend pagination tests in `src/bun/test/conversations-pagination.test.ts` covering empty conversation, ≤50 msgs, 51 msgs, cursor traversal, full paging of 130 messages

## 3. Frontend Store

- [x] 3.1 Add `hasMoreBefore: boolean`, `isLoadingOlder: boolean`, and `oldestLoadedId: number | null` state to `conversationStore`
- [x] 3.2 Update `loadMessages()` to consume `{ messages, hasMore }` wrapped response and set `hasMoreBefore`
- [x] 3.3 Implement `loadOlderMessages()` — guard with `isLoadingOlder`, fetch with `beforeMessageId = oldestLoadedId`, prepend to `messages[]`, update `hasMoreBefore` and `oldestLoadedId`
- [x] 3.4 Implement `refreshLatestPage()` — fetch newest page, merge: keep `messages` older than `newPage[0].id`, append new page, update `hasMoreBefore`
- [x] 3.5 Replace `loadMessages()` call in the stream `done` handler with `refreshLatestPage()`
- [x] 3.6 Update `src/mainview/stores/task.ts` and `src/mainview/stores/chat.ts` — no API change needed (they call `conversationStore.loadMessages()`), but verify no direct `conversations.getMessages` calls that need updating
- [x] 3.7 Extend `src/mainview/stores/conversation.test.ts` — add unit tests for `hasMoreBefore`, `loadOlderMessages` (prepend, guard, cursor), `refreshLatestPage` merge, and backward compat of `appendMessage`

## 4. Frontend Component

- [x] 4.1 Add `load_more_sentinel` display item type to `displayItems` computed in `ConversationBody.vue` — insert at index 0 when `hasMoreBefore` prop is true
- [x] 4.2 Add `IntersectionObserver` in `onMounted`/`onUnmounted` watching the sentinel element — emit `'loadOlderMessages'` on intersection, guarded by `!isLoadingOlder` prop
- [x] 4.3 Implement scroll restoration in `loadOlderMessages` flow — save `scrollHeight` before prepend, restore `scrollTop` delta after two `nextTick` calls
- [x] 4.4 Add props `hasMoreBefore: boolean` and `isLoadingOlder: boolean` to `ConversationBody.vue`; add emit `'loadOlderMessages'`
- [x] 4.5 Wire new props and emit in parent components (`TaskChatView.vue`, `SessionChatView.vue`, `ConversationPanel.vue`) — connect to `conversationStore.hasMoreBefore`, `conversationStore.isLoadingOlder`, and `conversationStore.loadOlderMessages()`

## 5. Fixture & Test Stub Updates

- [x] 5.1 Update `e2e/ui/fixtures/index.ts` baseline stub — `conversations.getMessages` returns `{ messages: [], hasMore: false }` instead of bare `[]`
- [x] 5.2 Update any other test files that stub `conversations.getMessages` with a bare array to use the wrapped shape

## 6. E2E Tests

- [x] 6.1 Write Playwright tests in `e2e/ui/conversation-pagination.spec.ts` covering: long history opens at bottom with sentinel off-screen, upward scroll triggers load, no viewport jump on prepend, sentinel absent for short history, streaming appends correctly while paginated, `refreshLatestPage` preserves older history on stream done, session chat pagination parity

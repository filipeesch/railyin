## Why

Long task chats and session chats grow unboundedly. Opening a drawer currently fetches the entire `conversation_messages` history in one query, causing increasing initial load latency and payload size as conversations grow. The DOM is already virtualized, so the next bottleneck is data payload — paginating `conversation_messages` at the API layer is the fix.

## What Changes

- **BREAKING** `conversations.getMessages` response shape changes from `ConversationMessage[]` to `{ messages: ConversationMessage[], hasMore: boolean }`. All callers must be updated.
- Add `beforeMessageId` and `limit` params to `conversations.getMessages` enabling cursor-based pagination (newest 50 messages on initial open, older pages on demand).
- Add a composite SQLite index `(conversation_id, id DESC)` on `conversation_messages` for efficient cursor queries.
- Extend `conversationStore` with `hasMoreBefore`, `isLoadingOlder`, and `loadOlderMessages()` action, plus a `refreshLatestPage()` merge strategy used when a stream `done` event fires (preserves already-loaded older pages instead of replacing the full message array).
- `ConversationBody.vue` gains a `load_more_sentinel` virtual item at the top of the list (visible when `hasMoreBefore`) watched by an `IntersectionObserver` — entering the viewport triggers `loadOlderMessages()`.
- Prepend scroll position is restored manually: save `scrollHeight`, prepend, then set `scrollTop += newScrollHeight - oldScrollHeight` after `nextTick`.
- `chatSessions.getMessages` is deprecated and unified: the frontend already routes through `conversations.getMessages` via `conversationStore`; the session endpoint becomes a thin delegation stub.
- Initial page size is **50 messages** (fetch 51 to detect `hasMore`).

## Capabilities

### New Capabilities
- `conversation-pagination`: Cursor-based pagination for conversation history. Covers the `beforeMessageId` + `limit` API contract, `hasMore` flag semantics, store-level `loadOlderMessages` and `refreshLatestPage` merge logic, sentinel-driven infinite scroll in `ConversationBody`, and scroll-anchor preservation on prepend.

### Modified Capabilities
- `conversation`: `conversations.getMessages` response shape is a **BREAKING** change — callers receive `{ messages, hasMore }` instead of a flat array; backend query uses cursor semantics.
- `chat-timeline-virtualization`: A new `load_more_sentinel` virtual item type is added at index 0 when `hasMoreBefore` is true; `IntersectionObserver` lifecycle is added to `ConversationBody`.

## Impact

- **Backend**: `src/bun/handlers/conversations.ts` (paginated query), `src/bun/handlers/chat-sessions.ts` (deprecate / delegate), `src/bun/db/migrations.ts` (migration `031_conversation_pagination_index` adds composite index)
- **Shared types**: `src/shared/rpc-types.ts` — `conversations.getMessages` response type, new params shape
- **Frontend store**: `src/mainview/stores/conversation.ts` — new state fields, `loadOlderMessages`, `refreshLatestPage`; `src/mainview/stores/task.ts` and `src/mainview/stores/chat.ts` pass-through callers updated
- **Frontend component**: `src/mainview/components/ConversationBody.vue` — sentinel item, `IntersectionObserver`, scroll restoration; new props `hasMoreBefore`, `isLoadingOlder`; new emit `loadOlderMessages`
- **Tests**: `src/bun/test/conversations-pagination.test.ts` (new, backend pagination semantics), `src/mainview/stores/conversation.test.ts` (extend for `hasMoreBefore`, `loadOlderMessages`, `refreshLatestPage`), `e2e/ui/conversation-pagination.spec.ts` (new, Playwright)
- **E2E fixtures**: `e2e/ui/fixtures/index.ts` baseline stub for `conversations.getMessages` updated to new wrapped shape

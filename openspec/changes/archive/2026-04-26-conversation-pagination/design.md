## Context

`conversation_messages` is an append-only SQLite table. Currently `conversations.getMessages` fetches all rows for a conversation, and `conversationStore.loadMessages()` replaces the entire `messages[]` array. `ConversationBody.vue` already virtualizes the DOM with `@tanstack/vue-virtual`, so the bottleneck is data payload, not rendering. The active stream path is separate: `stream_events` drive a live `streamState` that renders as a `stream_tail` virtual item appended after persisted messages.

The `simplify-stream-pipeline-cleanup` change should land before this one — it removes the legacy `stream.token` broadcast and tightens the stream pipeline, reducing the surface area that this change touches.

## Goals / Non-Goals

**Goals:**
- Initial open fetches only the newest 50 `conversation_messages`
- Upward scroll incrementally loads older pages using a `beforeMessageId` cursor
- No visible viewport jump when older pages are prepended
- Streaming continues to append to the loaded tail without a full reload
- Stream `done` reconciliation preserves already-loaded older pages
- Works identically for task chat and session chat via the shared `conversationId` primitive

**Non-Goals:**
- Paginating `stream_events` — those remain execution-scoped replay only
- Downward pagination or "jump to message" deep-linking
- Real-time sync of older pages (stale older history is acceptable)
- Removing `chatSessions.getMessages` from the RPC type surface (deprecated but not deleted)

## Decisions

### 1. Response shape: wrapped object `{ messages, hasMore }`

`conversations.getMessages` returns `{ messages: ConversationMessage[], hasMore: boolean }` instead of a flat array.

`hasMore` is derived cheaply: fetch `limit + 1` rows, return `limit`, set `hasMore = true` if the extra row exists. This avoids a separate `COUNT(*)` query and gives the UI everything it needs in one round trip.

**Alternative considered:** keep flat array, add a separate `conversations.hasMessagesBefore` endpoint. Rejected: two round trips per open, extra latency on every drawer open.

### 2. Cursor strategy: `beforeMessageId` + `limit=50`

```sql
-- Newest 50 (initial open)
SELECT * FROM conversation_messages
WHERE conversation_id = ?
ORDER BY id DESC LIMIT 51

-- Older page
SELECT * FROM conversation_messages
WHERE conversation_id = ? AND id < ?beforeMessageId
ORDER BY id DESC LIMIT 51
```

Rows are fetched in descending order and reversed before returning, so callers always receive ascending `[oldest … newest]` order within the page.

`id` is `INTEGER PRIMARY KEY AUTOINCREMENT` — monotonically increasing append order — making it a stable, gap-free cursor.

**Alternative considered:** offset pagination (`OFFSET N`). Rejected: O(N) scan for deep pages in SQLite; cursor is O(log N) with the composite index.

### 3. Composite index `(conversation_id, id DESC)`

Migration `031_conversation_pagination_index` adds:
```sql
CREATE INDEX IF NOT EXISTS idx_messages_conv_id
  ON conversation_messages(conversation_id, id DESC);
```

This makes every cursor page an index range scan touching exactly `limit + 1` rows regardless of conversation length. The existing `idx_messages_conv (conversation_id)` remains for non-paginated consumers.

### 4. Upward scroll trigger: `IntersectionObserver` sentinel

A `load_more_sentinel` virtual item is inserted at index 0 in `displayItems` when `hasMoreBefore` is true. An `IntersectionObserver` watches it; entering the viewport emits `loadOlderMessages`. This is more reliable than a scroll threshold — it fires even on programmatic jumps and handles the edge case where the first page doesn't fill the viewport.

Guard: `isLoadingOlder` prevents concurrent fetches.

### 5. Scroll restoration: manual `scrollHeight` delta

`overflow-anchor: none` is already set in `ConversationBody`. When prepending:

```
oldHeight = scrollEl.scrollHeight      // save before prepend
prepend(olderMessages)
await nextTick()
await nextTick()                        // two ticks: first for Vue, second for virtualizer
scrollEl.scrollTop += scrollEl.scrollHeight - oldHeight
```

Two `nextTick` calls are needed: one for Vue's reactive update and one for the virtualizer to recompute `getTotalSize()`.

**Alternative considered:** `virtualizer.scrollToIndex(prependCount, { align: 'start' })`. Rejected: item heights are dynamic/estimated; the index-based approach can land the user at a slightly wrong position before measurement. The `scrollHeight` delta is more reliable for variable-height items.

### 6. Stream `done` reconciliation: `refreshLatestPage()` merge

When a stream `done` event fires, instead of calling `loadMessages()` (which would replace all pages), call `refreshLatestPage()`:

```
1. Fetch newest 50: { messages: newPage, hasMore }
2. pivot = newPage[0].id
3. oldHistory = messages.filter(m => m.id < pivot)
4. messages = [...oldHistory, ...newPage]
5. hasMoreBefore = hasMore || oldHistory.length > 0
```

This preserves older pages the user scrolled to while refreshing the tail with canonical persisted data.

### 7. `chatSessions.getMessages` deprecation

The frontend `chat.ts` already calls `conversationStore.loadMessages({ conversationId })` → `conversations.getMessages`. The session endpoint `chatSessions.getMessages` is bypassed by the main data flow. It becomes a thin delegation stub that calls the same paginated conversation query, keeping the RPC surface stable for any external consumers while removing the code duplication.

## Risks / Trade-offs

**[Risk] Two-tick scroll restoration may produce one-frame jitter on slow devices**
→ Mitigation: `conv-body--positioning` class already hides the component until `initialScrollReady`. The same pattern can be extended to mask prepend operations if jitter is observed in practice.

**[Risk] Sentinel enters viewport immediately after initial load (short conversations)**
→ Mitigation: When `hasMoreBefore` is false (≤50 messages), the sentinel is not rendered. When `hasMoreBefore` is true but the page already has content filling the viewport, the sentinel starts off-screen and won't trigger until the user scrolls up. The guard `isLoadingOlder` prevents double-fetch if the user scrolls to the sentinel repeatedly before the response arrives.

**[Risk] `refreshLatestPage` merge pivot assumes new execution messages have higher IDs than all older history**
→ Since `id` is `AUTOINCREMENT`, this invariant holds for any messages written after older ones. The only failure mode is if messages were manually backfilled with lower IDs — not a scenario in this codebase.

**[Risk] Breaking change to `conversations.getMessages` response type**
→ Mitigation: All callers are inside the monorepo and fully enumerable. The E2E fixture mock and all test stubs are updated as part of this change. No external API consumers exist.

**[Risk] `chatSessions.getMessages` remains in the RPC type surface**
→ Marked as deprecated; not deleted. Can be removed in a future cleanup pass.

## Migration Plan

1. Apply migration `031_conversation_pagination_index` on startup (additive, no data movement, safe on live DB).
2. Deploy backend + shared types change — `conversations.getMessages` now returns wrapped object.
3. Deploy frontend — store and component consume new shape. No intermediate state where old frontend hits new backend (or vice versa) is safe; this is a same-deploy change.
4. Rollback: revert frontend + backend together; drop index via a `032_drop_pagination_index` migration if needed (index is cosmetic, drop is safe).

## Open Questions

- None — all design decisions were made during the explore session.

## Context

The frontend routes all WebSocket stream events through a single shared channel. Streamed content is keyed by `conversationId` in a `Map<conversationId, ConversationStreamState>` inside `conversationStore`. The active conversation view reads from `streamStates.get(activeConversationId)`, so any accidental mutation of `activeConversationId` instantly redirects the entire stream display to a different conversation.

`sendMessage()` and `submitDecisions()` in `taskStore` contain a legacy sync block that unconditionally calls `setActiveConversation(message.conversationId)` when the returned message's `conversationId` doesn't match the currently active one. This was written to handle brand-new tasks whose `conversationId` was `0` before the first message created a real conversation on the backend. The backend now always creates a conversation at task-creation time, so `conversationId` is always set — but the sync block remains.

The problem: `sendMessage` is also called by `drainQueue()`, which fires for **any** task when it transitions to a terminal execution state. When a background task drains its queue, `drainQueue → sendMessage → setActiveConversation(backgroundTask.conversationId)` corrupts the active view with another task's conversation.

A secondary issue: `ConversationInput` holds its draft text in local component state (`ref("")`). The component mounts only when the chat tab is visible (`v-if="activeTab === 'chat'"`). Switching to the info/git/decisions/notes tab — or closing the drawer — unmounts the component and silently discards the draft.

## Goals / Non-Goals

**Goals:**
- Guarantee that background task queue drains never mutate `activeConversationId`
- Remove the now-dead legacy `conversationId 0→N` sync block
- Remove the hollow `onTaskNewMessage` stub and its call site
- Evict `streamStates` entries for non-active conversations when their stream completes, eliminating unbounded Map growth
- Persist conversation input drafts per task and per session to `localStorage`, surviving tab switches, drawer close/reopen, and page reload
- Auto-evict stale draft entries older than 7 days; explicitly clear on send and on entity deletion

**Non-Goals:**
- Persisting attachments or code refs as part of the draft
- Backend changes or API/RPC additions
- New Playwright test coverage (handled separately)

## Decisions

### D1 — Guard `sendMessage` and `submitDecisions` with an active-task check

**Decision**: When `sendMessage` (or `submitDecisions`) fires for a `taskId` that is not the currently active task, skip `setActiveConversation` and `appendMessage` entirely. The `conversationStore.appendMessage` call is also skipped because the message will be fetched from the DB the next time the user opens that task.

**Why not just remove the legacy block and keep `appendMessage`?**  
If the active conversation has changed between the API call and the response, calling `appendMessage(message)` would append a background task's message to the wrong conversation's display. The guard must cover both calls.

**Alternatives considered**: Checking `message.conversationId === conversationStore.activeConversationId` instead of `taskId === activeTaskId.value` — rejected because `activeConversationId` itself could be momentarily stale (the source of the original bug).

---

### D2 — Delete `streamStates` entry on completion for non-active conversations

**Decision**: When a `done` event arrives for a non-active conversation, call `streamStates.delete(conversationId)` instead of clearing the entry's contents and keeping the Map entry.

**Why safe?**: After `done`, the UI reloads from the DB (`loadMessages`) on the next `selectTask`/`selectSession` call. There is no path that reads a non-active `streamStates` entry for display purposes — `activeStreamState` is `streamStates.get(activeConversationId)` and won't resolve a deleted non-active entry.

**Impact on SS-2 test**: SS-2 does not fire `done` while viewing a different task (the stream stays live). The entry remains intact during the switch; deletion only happens on `done`. No test breakage.

**Alternatives considered**: Evicting on `setActiveConversation` (switching away) — rejected because the conversation might still be streaming and the user might switch back before `done`.

---

### D3 — Dedicated `draftStore` backed by `localStorage`

**Decision**: A new `src/mainview/stores/draft.ts` owns all draft lifecycle. Key scheme: `railyn:draft:task:<id>` / `railyn:draft:session:<id>`. `ConversationInput` computes its own key from existing `taskId`/`sessionId` props.

**Why not lift into `taskStore`/`chatStore`?** Both stores would need to duplicate localStorage sync logic and eviction policy. `ConversationInput` would need conditional store imports depending on which prop is set. A dedicated store has single responsibility and a unified key scheme.

**Eviction**: On store init, scan all `railyn:draft:*` keys in `localStorage` and delete any with `savedAt` older than 7 days. On send: `draftStore.clear(key)`. On task/session delete: `draftStore.clear(key)` (explicit clean). The TTL handles deletions that happen in other tabs or before the in-memory store has a chance to clear.

## Risks / Trade-offs

- **[Risk] Background task message silently dropped from conversation view** → Accepted. The message was never reliably displayed before (it would corrupt the view). It will be fetched from DB on next task open. This is the correct behavior per design decision.
- **[Risk] `streamStates.delete` breaks a consumer that reads non-active stream state** → Low. `activeStreamState` is the only public computed; it resolves via `streamStates.get(activeConversationId)` which won't match a deleted non-active entry. Verified by reading all `streamStates` usages.
- **[Risk] localStorage grows if the app is used heavily and tasks are never deleted** → Mitigated by 7-day TTL eviction at init. A user with 1000 tasks would have at most ~1000 draft entries of negligible size (plain text strings).
- **[Trade-off] Draft attachments are not persisted** → Accepted as out of scope. Text draft is the high-value case.

## Migration Plan

No backend changes, no DB migrations, no API changes. Pure frontend refactor. Ships in one PR.

Rollback: revert the PR. No data loss — `localStorage` entries are keyed and will simply not be read if the draftStore code is absent. They will be cleaned by TTL on next load after rollback.

## Open Questions

None — all design decisions were resolved during the exploration session.

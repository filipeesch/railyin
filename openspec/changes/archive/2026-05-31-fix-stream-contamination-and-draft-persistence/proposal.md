## Why

Streaming messages from one task or chat session can appear inside a different session's conversation view — a hard contamination bug. Additionally, text typed in the conversation input is silently lost when the user switches drawer tabs or closes and reopens the drawer, producing a frustrating UX.

## What Changes

- **Bug fix**: Guard `sendMessage()` and `submitDecisions()` in `taskStore` so background task queue drains never mutate `activeConversationId` and corrupt the visible conversation.
- **Cleanup**: Remove the legacy `conversationId 0→N` sync block from `sendMessage()` (backend always creates a conversation at task creation; the guard is dead code).
- **Cleanup**: Remove the hollow `onTaskNewMessage` stub from `taskStore` and its call site in `App.vue`.
- **Memory fix**: On `done` stream event for a non-active conversation, delete the `streamStates` Map entry instead of clearing-and-retaining, eliminating unbounded Map growth.
- **New feature**: Add a `draftStore` that persists conversation input text per task/session to `localStorage`, surviving tab switches, drawer close/reopen, and page reload. Drafts are cleared on send, cleared on entity deletion, and auto-evicted after 7 days.

## Capabilities

### New Capabilities

- `conversation-draft`: Per-task and per-session conversation input draft, persisted to `localStorage` with TTL-based eviction and explicit clear on send/delete.

### Modified Capabilities

- `frontend-reactive-stream`: R3 lifecycle — completed non-active conversations now have their `streamStates` entry fully removed (deleted) rather than cleared-and-retained. This closes a memory leak where one entry per ever-streamed conversation accumulated indefinitely.

## Impact

- `src/mainview/stores/task.ts` — `sendMessage`, `submitDecisions`, `onTaskNewMessage` (removed)
- `src/mainview/stores/conversation.ts` — `onStreamEvent` done branch for non-active conversations
- `src/mainview/stores/draft.ts` — new file
- `src/mainview/components/ConversationInput.vue` — reads/writes draft on mount, change, and send
- `src/mainview/App.vue` — removes `onTaskNewMessage` call
- `src/mainview/stores/task.ts` `deleteTask()` and chat store `archiveSession()` — each adds one `draftStore.clear()` call
- No backend changes, no API or RPC changes, no schema migrations

## Why

The `conversationId`-first model is fully shipped, but the codebase still carries a parallel `stream.token` broadcast path alongside the structured `stream.event` path — the old path is dead code that never renders in practice, yet clutters every layer from the backend broadcast through the store to the view components. Additionally, `stream_events.task_id` is written and indexed but never queried, and `stream_events.conversation_id` is nullable despite all new writes being non-null. Cleaning these up now, while the migration is fresh, avoids them calcifying into permanent complexity.

## What Changes

- **Remove** the `stream.token` WebSocket broadcast, the `StreamToken` RPC type, and all frontend handling (`LegacyStreamState`, `liveStreams`, `streamingToken`, `streamingReasoningToken`, `streamingStatusMessage`, `streamingConversationId` computed refs, `onStreamToken()` in store/chat/task, and the legacy fallback render branches in `ConversationBody`/`ConversationPanel`/`SessionChatView`/`TaskChatView`)
- **Remove** `stream_events.task_id` column via a safe SQLite table-recreation migration; drop the `idx_stream_events_task` index alongside it
- **Tighten** `stream_events.conversation_id` to `NOT NULL` in the same migration (rows with NULL `conversation_id` are pre-backfill legacy data and are dropped)
- **Narrow** `getStreamEventsByConversation()` replay semantics to return only the **latest execution's** events, not all executions for a conversation
- **Add** a Playwright reconnect replay test verifying no ghost blocks from prior executions appear after reconnect

## Capabilities

### New Capabilities
- `stream-reconnect-replay`: Specifies that `conversations.getStreamEvents` returns only the tail of the latest execution for a conversation, used for live-tail reconnect. Full conversation history is served by `conversations.getMessages`.

### Modified Capabilities
- `unified-ai-stream`: Remove the legacy `stream.token` / `StreamToken` wire format from the streaming contract; only `stream.event` remains as the live delivery mechanism.
- `conversation`: `stream_events` schema change — `task_id` column removed, `conversation_id` made NOT NULL.

## Impact

- **Backend**: `src/bun/index.ts` (remove `onToken` fn + broadcast), `src/bun/db/stream-events.ts` (drop `taskId` field, migration), `src/bun/db/migrations.ts` (new migration), `src/bun/handlers/conversations.ts` (replay query narrowed)
- **Shared types**: `src/shared/rpc-types.ts` (`StreamToken` interface and `stream.token` WsMessage case removed)
- **Frontend**: `src/mainview/rpc.ts`, `src/mainview/App.vue`, `src/mainview/stores/conversation.ts`, `src/mainview/stores/chat.ts`, `src/mainview/stores/task.ts`, `src/mainview/components/ConversationBody.vue`, `ConversationPanel.vue`, `SessionChatView.vue`, `TaskChatView.vue`
- **Tests**: `src/mainview/stores/conversation.test.ts` (remove `onStreamToken` test cases), `e2e/ui/timeline-pipeline.spec.ts` (add reconnect replay test)
- **No API surface change** for consumers of `conversations.getMessages` — full history is unaffected

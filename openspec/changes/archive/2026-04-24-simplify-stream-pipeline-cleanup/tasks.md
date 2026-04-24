## 1. Database migration

- [x] 1.1 Add migration `035_stream_events_cleanup` (or next sequential id) to `src/bun/db/migrations.ts`: create `stream_events_new` without `task_id`, with `conversation_id NOT NULL`; insert from old table filtering `WHERE conversation_id IS NOT NULL`; drop old table; rename new table; recreate `idx_stream_events_conversation` and `idx_stream_events_execution` indexes; do NOT recreate `idx_stream_events_task`
- [x] 1.2 Update `PersistedStreamEvent` interface in `src/bun/db/stream-events.ts`: remove `taskId` field
- [x] 1.3 Update `appendStreamEvent()` in `src/bun/db/stream-events.ts`: remove `task_id` param from INSERT statement
- [x] 1.4 Update `appendStreamEventBatch()` in `src/bun/db/stream-events.ts`: remove `task_id` param from INSERT statement
- [x] 1.5 Update `getStreamEventsByConversation()` in `src/bun/db/stream-events.ts`: narrow query to latest execution tail — filter by `execution_id = (SELECT MAX(execution_id) FROM stream_events WHERE conversation_id = ?)` in addition to `conversation_id` and `seq > ?`
- [x] 1.6 Update the row type in `getStreamEventsByConversation()` to remove `task_id` column from the query result shape

## 2. Backend broadcast cleanup

- [x] 2.1 Remove the `onToken()` function from `src/bun/index.ts` (the function that calls `broadcast({ type: "stream.token", ... })`)
- [x] 2.2 Update `Orchestrator` constructor calls in `src/bun/index.ts` to no longer pass `onToken` — pass only the remaining callbacks
- [x] 2.3 Update callers of `appendStreamEvent` / `appendStreamEventBatch` (e.g. `StreamBatcher`) to stop passing `taskId` field
- [x] 2.4 Verify `getOrCreateBatcher()` signature no longer needs to thread `taskId` through to `PersistedStreamEvent`

## 3. Shared types cleanup

- [x] 3.1 Remove `StreamToken` interface from `src/shared/rpc-types.ts`
- [x] 3.2 Remove `{ type: "stream.token"; payload: StreamToken }` case from the `WsMessage` discriminated union in `src/shared/rpc-types.ts`
- [x] 3.3 Remove `isReasoning` and `isStatus` optional fields from any remaining interfaces if they were only used by `StreamToken`

## 4. Frontend RPC layer cleanup

- [x] 4.1 Remove `_onStreamToken` ref and `onStreamToken` export from `src/mainview/rpc.ts`
- [x] 4.2 Remove `case "stream.token"` dispatch from the WebSocket message handler in `src/mainview/rpc.ts`
- [x] 4.3 Remove the `StreamToken` import and `onStreamToken` import from `src/mainview/App.vue`
- [x] 4.4 Remove the `onStreamToken(...)` callback registration in `src/mainview/App.vue`

## 5. Store cleanup

- [x] 5.1 Remove `LegacyStreamState` interface from `src/mainview/stores/conversation.ts`
- [x] 5.2 Remove `liveStreams` ref, `activeLegacyStream` computed, `streamingToken`, `streamingReasoningToken`, `streamingStatusMessage`, `streamingConversationId` computeds from `src/mainview/stores/conversation.ts`
- [x] 5.3 Remove `getOrCreateLiveState()`, `clearLiveState()`, `onStreamToken()` functions from `src/mainview/stores/conversation.ts`
- [x] 5.4 Remove `liveState` cleanup branches in `onNewMessage()` in `src/mainview/stores/conversation.ts`
- [x] 5.5 Remove legacy token exports from `src/mainview/stores/conversation.ts` return object
- [x] 5.6 Remove `streamingToken`, `streamingConversationId`, `isStreaming`, `onStreamToken` from `src/mainview/stores/chat.ts`
- [x] 5.7 Remove `streamingToken`, `streamingReasoningToken`, `streamingStatusMessage`, `streamingConversationId`, `isStreamingReasoning`, `onStreamToken` from `src/mainview/stores/task.ts`

## 6. Component props and template cleanup

- [x] 6.1 Remove `streamingToken`, `streamingReasoningToken`, `streamingStatusMessage` props from `src/mainview/components/ConversationBody.vue`
- [x] 6.2 Remove `isLegacyStreamVisible`, `hasLegacyTail` computed refs and all legacy template branches (`v-if="props.streamingToken && isLegacyStreamVisible"` etc.) from `ConversationBody.vue`
- [x] 6.3 Update `hasLiveContent` computed in `ConversationBody.vue` to only use `streamState` (remove `streamingReasoningToken` / `streamingToken` fallback branch)
- [x] 6.4 Remove `streamingToken`, `streamingReasoningToken`, `streamingStatusMessage` props and pass-through bindings from `src/mainview/components/ConversationPanel.vue`
- [x] 6.5 Remove `:streaming-token`, `:streaming-reasoning-token`, `:streaming-status-message`, `:streaming-active-id` prop bindings from `src/mainview/components/TaskChatView.vue`
- [x] 6.6 Remove `:streaming-token`, `:streaming-reasoning-token`, `:streaming-status-message`, `:streaming-active-id` prop bindings from `src/mainview/components/SessionChatView.vue`

## 7. Test updates

- [x] 7.1 Remove `onStreamToken` test cases from `src/mainview/stores/conversation.test.ts`
- [x] 7.2 Add Playwright reconnect replay test to `e2e/ui/timeline-pipeline.spec.ts`: (a) open task drawer, (b) push `text_chunk` events for execution 101 via WsMock, (c) push `done` for execution 101, (d) verify persisted messages loaded, (e) configure `conversations.getStreamEvents` mock to return `text_chunk` from execution 102, (f) re-navigate, (g) assert only execution 102 tail visible — no ghost blocks from execution 101

## 8. Build and validation

- [x] 8.1 Run `bun run build` and fix any TypeScript errors from removed types/props
- [x] 8.2 Run `bun test src/bun/test --timeout 20000` and verify no regressions
- [x] 8.3 Run `npx playwright test e2e/ui/timeline-pipeline.spec.ts` and verify existing suite + new reconnect test pass

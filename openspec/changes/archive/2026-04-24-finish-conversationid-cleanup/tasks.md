## 1. Conversation-scoped backend cleanup

- [x] 1.1 Remove deprecated `taskId` aliases from conversation read APIs and update RPC/frontend callers to use `conversationId` only
- [x] 1.2 Make all new task and session execution writes persist `executions.conversation_id`
- [x] 1.3 Make persisted stream-event writes populate `stream_events.conversation_id` and read replay primarily by `conversation_id`

## 2. Historical data repair and typing cleanup

- [x] 2.1 Add migration cleanup to repair missing `stream_events.conversation_id` values via executions first and tasks second, pruning unrecoverable rows if necessary
- [x] 2.2 Align DB row and shared event types with nullable task ownership and conversation-first stream routing

## 3. Timeline unification

- [x] 3.1 Refactor shared conversation state to support one merged timeline with persisted history plus a live execution tail
- [x] 3.2 Update task chat rendering to preserve chronological order across persisted messages and active stream blocks
- [x] 3.3 Update standalone session chat rendering to use the same merged timeline and live-tail reconciliation model

## 4. Validation

- [x] 4.1 Add backend tests for canonical conversation reads, execution/stream-event persistence, and historical repair behavior
- [x] 4.2 Add UI tests for chronology, replay-sensitive session behavior, and merged timeline reconciliation in task and session chat
- [x] 4.3 Write and run e2e tests for merged conversation timeline cleanup

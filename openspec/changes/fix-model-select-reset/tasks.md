## 1. Shared Query Helpers

- [ ] 1.1 Create `src/bun/db/task-queries.ts` with `fetchTaskWithModel(db, taskId): Task | null` — SELECT joining tasks, task_git_context, conversations; call mapTask()
- [ ] 1.2 Add `fetchChatSessionWithModel(db, sessionId): ChatSession | null` to the same module — SELECT joining chat_sessions, conversations; call mapChatSession()
- [ ] 1.3 Migrate `handlers/tasks.ts:fetchTaskWithDetail` to call `fetchTaskWithModel` from the shared module (refactor, no behavior change)

## 2. Fix Task Push Sites

- [ ] 2.1 Fix `orchestrator.ts` cancel path — replace bare `SELECT * FROM tasks` with `fetchTaskWithModel`
- [ ] 2.2 Fix `orchestrator.ts` shell approval path — replace bare `SELECT * FROM tasks` with `fetchTaskWithModel`
- [ ] 2.3 Fix `code-review-executor.ts` — replace bare `SELECT * FROM tasks` with `fetchTaskWithModel`
- [ ] 2.4 Fix `transition-executor.ts` `freshTaskRow` bare query — replace with `fetchTaskWithModel`
- [ ] 2.5 Fix `transition-executor.ts` `runningRow` bare query (returned from `execute()`) — replace with `fetchTaskWithModel`

## 3. Fix Session Push Sites

- [ ] 3.1 Fix `chat-sessions.ts:setModel` — replace bare `SELECT * FROM chat_sessions` (both the WebSocket push and the HTTP response row) with `fetchChatSessionWithModel`
- [ ] 3.2 Fix `chat-sessions.ts:create` — replace bare `SELECT * FROM chat_sessions` with `fetchChatSessionWithModel`
- [ ] 3.3 Fix `chat-sessions.ts:rename` — replace bare `SELECT * FROM chat_sessions` with `fetchChatSessionWithModel`
- [ ] 3.4 Fix `chat-sessions.ts:archive` — replace bare `SELECT * FROM chat_sessions` with `fetchChatSessionWithModel`
- [ ] 3.5 Fix `chat-sessions.ts` cancel fallback — replace bare `SELECT * FROM chat_sessions` with `fetchChatSessionWithModel`

## 4. Latent Bug Fix

- [ ] 4.1 Fix `task-repository.ts:findById` — add `LEFT JOIN conversations c ON c.id = t.conversation_id` to the SELECT query

## 5. Frontend Cleanup

- [ ] 5.1 Remove `isUserChangingModel` ref, `previousModelId` ref, and `setTimeout` guard from `SessionChatView.vue` — simplify the `selectedModelId` watcher to a straightforward assignment

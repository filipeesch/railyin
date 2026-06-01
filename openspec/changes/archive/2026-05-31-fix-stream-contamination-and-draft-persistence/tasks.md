## 1. Stream Contamination Fix

- [x] 1.1 In `task.ts` `sendMessage()`: add guard `if (taskId !== activeTaskId.value) return` immediately after the API call resolves, before any `setActiveConversation` or `appendMessage` call
- [x] 1.2 In `task.ts` `submitDecisions()`: apply the same guard (`if (taskId !== activeTaskId.value) return`) after the API call
- [x] 1.3 Remove the legacy `conversationId 0→N` sync block from both `sendMessage()` and `submitDecisions()` (the `if (message.conversationId !== conversationStore.activeConversationId)` block and its comment)

## 2. Hollow Stub Cleanup

- [x] 2.1 Remove the `onTaskNewMessage` function from `task.ts` and its export from the store's return object
- [x] 2.2 Remove the `taskStore.onTaskNewMessage(message)` call from `App.vue`'s `onNewMessage` handler

## 3. streamStates Memory Fix

- [x] 3.1 In `conversation.ts` `onStreamEvent` done branch for non-active conversations: replace `state.blocks.clear(); state.roots = []; streamStates.value.set(...)` with `streamStates.value.delete(conversationId)`

## 4. Draft Store

- [x] 4.1 Create `src/mainview/stores/draft.ts` with: `DraftEntry = { text: string; savedAt: number }`, localStorage key scheme `railyn:draft:task:<id>` / `railyn:draft:session:<id>`, functions `get(key)`, `set(key, text)`, `clear(key)`, and `_evictStale()` (removes entries older than 7 days, called at store init)
- [x] 4.2 In `ConversationInput.vue`: on `mounted`, read draft from `draftStore` using key derived from `props.taskId` / `props.sessionId` and set `inputText.value` if a draft exists
- [x] 4.3 In `ConversationInput.vue`: on `@text-change` (already wired), call `draftStore.set(key, text)` to persist the current draft on every change
- [x] 4.4 In `ConversationInput.vue` send handler: call `draftStore.clear(key)` after the message is successfully sent (after the `onSend` emit or the API call resolves)
- [x] 4.5 In `task.ts` `deleteTask()`: call `draftStore.clear('task:${taskId}')` when the task is deleted
- [x] 4.6 In `chat.ts` `archiveSession()`: call `draftStore.clear('session:${sessionId}')` when the session is archived/deleted

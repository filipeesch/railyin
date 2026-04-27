# Tasks: Fix UI Reactivity Performance

## Wave 1 — Remove streamVersion bomb

- [x] **conversation.ts**: Delete `streamVersion = ref(0)` and all 5 `streamVersion.value++` sites
- [x] **conversation.ts**: Delete all 6 `streamStates.value = new Map(streamStates.value)` clone sites (mutate in place)
- [x] **conversation.ts**: Delete `streamVersion` from the `return {}` export
- [x] **conversation.ts**: Replace `contextUsageByConversation` clone-and-replace with direct `.set()` / `.delete()` mutations (2 sites in `fetchContextUsage`)
- [x] **StreamBlockNode.vue**: Delete `version: number` prop, `void props.version` line, and `{ ...b }` spread in the `block` computed
- [x] **ConversationBody.vue**: Delete `streamVersion` prop, `:version` binding on `<StreamBlockNode>`, replace `watch(streamVersion)` scroll trigger with `watch(roots.length)`
- [x] **ConversationPanel.vue**: Delete `streamVersion` prop and `:stream-version` passthrough to `ConversationBody`
- [x] **TaskChatView.vue**: Delete `:stream-version="taskStore.streamVersion"` from `<ConversationPanel>`
- [x] **SessionChatView.vue**: Delete `:stream-version="conversationStore.streamVersion"` from `<ConversationPanel>`

## Wave 2 — Memory cleanup

- [x] **conversation.ts** `onStreamEvent`: After `done` branch, clear `state.blocks` and `state.roots` for non-active conversations
- [x] **conversation.ts** `setActiveConversation`: Delete previous conversation's entry from `contextUsageByConversation` when switching away
- [x] **task.ts** `deleteTask`: Delete `changedFileCounts[taskId]` entry after successful API call

## Wave 3 — Store structural cleanup

- [x] **task.ts**: Remove passthrough computed re-exports (`streamStates`, `streamVersion`, `activeStreamState`, `contextUsage`, `messages`, `messagesLoading`, `hasMoreBefore`, `isLoadingOlder`, `availableModels`, `allProviderModels`)
- [x] **task.ts**: Remove thin-wrapper functions (`onStreamEvent`, `onStreamError`, `onNewMessage`)
- [x] **task.ts**: Extract `onTaskStreamEvent(event)` and `onTaskNewMessage(message)` functions from the hooks closure; remove `conversationStore.registerHooks("task-store", ...)` call
- [x] **chat.ts**: Remove passthrough re-exports (`messages`, `messagesLoading`) and wrapper functions (`onStreamError`, `onStreamEvent`)
- [x] **chat.ts**: Extract `onChatStreamEvent(event)` and `onChatNewMessage(message)` functions; remove `conversationStore.registerHooks("chat-store", ...)` call
- [x] **conversation.ts**: Remove `hooks` ref, `registerHooks()`, `notifyStreamEvent()`, `notifyNewMessage()` and all their call sites
- [x] **App.vue**: Update `onStreamEventMessage` and `onNewMessage` handlers to call all three stores in order (`conversationStore` first, then `taskStore`, then `chatStore`)
- [x] **TaskChatView.vue** and **SessionChatView.vue**: Import `useConversationStore` and `useWorkspaceStore` directly for any state previously accessed via `taskStore.*` / `chatStore.*` passthroughs
- [x] **review.ts**: Remove `selectedFile`, `filter`, `mode`, `optimisticUpdates`, `reviewVersion`, `bumpVersion()`, `selectFile()` — keep only `isOpen`, `taskId`, `files`, `openReview()`, `closeReview()`, `resetSession()`
- [x] **CodeReviewOverlay.vue**: Declare `selectedFile`, `filter`, `mode`, `optimisticUpdates`, `reviewVersion` as component-local refs; add watcher on `reviewStore.isOpen` to reset state on open
- [x] **Create `src/mainview/api/launch.ts`**: Export `getLaunchConfig(taskId)` and `runLaunch(taskId, command, mode)` as plain async functions
- [x] **TaskChatView.vue**: Replace `useLaunchStore()` with imports from `../api/launch`
- [x] **Delete `src/mainview/stores/launch.ts`**
- [x] **task.ts** `_replaceTask`: Replace O(n) board scan with direct `tasksByBoard.value[updated.boardId]` lookup using `Task.boardId`
- [x] **task.ts** `markTaskUnread` / `clearTaskUnread`: Replace `new Set([...])` spread with `.add()` / `.delete()` on the existing ref
- [x] **chat.ts** `markUnread` / `clearUnread`: Same fix for `unreadSessionIds`

## Wave 4 — Board rendering optimizations

- [x] **BoardView.vue**: Replace `columnTasks(columnId)` plain function with a `columnTasksMap` computed that groups and sorts once; keep `columnTasks()` as a thin accessor
- [x] **BoardView.vue**: Add `v-memo="[task, taskStore.hasUnread(task.id), taskStore.changedFileCounts[task.id]]"` to both `<TaskCard>` usages (standalone columns and group columns)

## Verification

- [x] Run `bun test src/bun/test --timeout 20000` — should remain green (no backend changes)
- [x] Run `bun test src/mainview/stores/conversation.test.ts` — verify stream state handling (SB suite from `test-ui-reactivity-performance`)
- [x] Run `bun test src/mainview/stores/task.test.ts` — verify O(1) lookup and reactive Set behavior (T suite from `test-ui-reactivity-performance`)
- [x] Run `bun test src/mainview/stores/chat.test.ts` — verify unread Set identity (C suite)
- [x] Run `bun test src/mainview/stores/dispatch.test.ts` — verify dispatch ordering (D suite)
- [x] Run `bun run build && npx playwright test e2e/ui/stream-reactivity.spec.ts` — Suites A–E green
- [x] Run `bun run build && npx playwright test e2e/ui` — full UI suite green

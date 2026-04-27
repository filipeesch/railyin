# Design: Fix UI Reactivity Performance

## Overview

All changes are scoped to `src/mainview/`. No backend changes, no API contract changes, no DB migrations. The work is organized into four waves, each independently deployable.

---

## Wave 1 — Remove the streamVersion bomb (highest impact, pure deletions)

### The misconception

`conversation.ts` held a `streamVersion = ref(0)` counter incremented on every stream event from any conversation. `StreamBlockNode.vue` read this via `void props.version` to force its computed to re-run. The developer comment read: *"in-place mutation is invisible to Vue"* — this is false. Vue 3 wraps `ref(new Map())` in its collection-aware Proxy and tracks `map.set(key)` / `map.get(key)` per-key natively.

### Changes

**`src/mainview/stores/conversation.ts`**
- Delete `const streamVersion = ref(0)` (line 108)
- Delete all `streamVersion.value++` calls — 5 sites (lines 278, 307, 317, 358, 418)
- Delete all `streamStates.value = new Map(streamStates.value)` replacements — 6 sites — mutations are already tracked natively
- Delete `streamVersion` from the `return {}` object
- Replace `contextUsageByConversation` clone-and-replace pattern with direct `.set()` / `.delete()` on `.value`

**`src/mainview/components/StreamBlockNode.vue`**
- Delete `version: number` from props
- Delete `void props.version` from the `block` computed
- Change `return b ? { ...b } : undefined` to `return b ?? undefined` (drop spread so Vue 3.4 computed stability works)

**`src/mainview/components/ConversationBody.vue`**
- Delete `:version="props.streamVersion"` from `<StreamBlockNode>` usage
- Delete `streamVersion` prop
- Replace `watch(() => props.streamVersion, ...)` scroll watcher with `watch(() => props.streamState?.roots.length, ...)`

**`src/mainview/components/ConversationPanel.vue`**
- Delete `streamVersion?: number` prop and `:stream-version` passthrough

**`src/mainview/components/TaskChatView.vue`**
- Delete `:stream-version="taskStore.streamVersion"`

**`src/mainview/components/SessionChatView.vue`**
- Delete `:stream-version="conversationStore.streamVersion"`

---

## Wave 2 — Memory cleanup

### `streamStates` block cleanup

In `onStreamEvent`, after the `done` branch sets `state.isDone = true`, for non-active conversations:

```ts
if (event.conversationId !== activeConversationId.value) {
  state.blocks.clear()
  state.roots = []
  // executionId, isDone, statusMessage preserved
}
```

### `contextUsageByConversation` cleanup

In `setActiveConversation(conversationId)`, delete the previous entry when switching away:

```ts
const previous = activeConversationId.value
activeConversationId.value = conversationId
if (previous != null) contextUsageByConversation.value.delete(previous)
```

### `changedFileCounts` cleanup

In `deleteTask(taskId)` inside `task.ts`, after the API call succeeds:

```ts
delete changedFileCounts.value[taskId]
```

---

## Wave 3 — Store structural cleanup

### 3a. Remove passthrough re-exports from `task.ts` and `chat.ts`

**`task.ts` passthroughs to remove:** `streamStates`, `streamVersion`, `activeStreamState`, `contextUsage`, `messages`, `messagesLoading`, `hasMoreBefore`, `isLoadingOlder`, `availableModels`, `allProviderModels`, `onStreamEvent`, `onStreamError`, `onNewMessage`

**`chat.ts` passthroughs to remove:** `messages`, `messagesLoading`, `onStreamError`, `onStreamEvent`

Components needing conversation data import `useConversationStore` directly. Components needing models import `useWorkspaceStore` directly.

### 3b. Replace `hooks` event bus with direct dispatch

**Remove from `conversation.ts`:** `hooks` ref, `registerHooks()`, `notifyStreamEvent()`, `notifyNewMessage()`, all call sites.

**`task.ts`:** Replace `conversationStore.registerHooks("task-store", { ... })` with exported `onTaskStreamEvent(event)` and `onTaskNewMessage(message)`.

**`chat.ts`:** Same pattern — `onChatStreamEvent(event)` and `onChatNewMessage(message)`.

**`App.vue`:**
```ts
onStreamEventMessage((event) => {
  conversationStore.onStreamEvent(event)   // first — updates stream state
  taskStore.onTaskStreamEvent(event)        // reacts to task events
  chatStore.onChatStreamEvent(event)        // reacts to chat events
})
onNewMessage((message) => {
  conversationStore.onNewMessage(message)
  taskStore.onTaskNewMessage(message)
  chatStore.onChatNewMessage(message)
})
```
Order matters: `conversationStore` must dispatch first so downstream handlers read updated state.

### 3c. Move `review.ts` local state into `CodeReviewOverlay.vue`

**Remove from `review.ts`:** `selectedFile`, `filter`, `mode`, `optimisticUpdates`, `reviewVersion`, `bumpVersion()`, `selectFile()`

**Keep in `review.ts`:** `isOpen`, `taskId`, `files`, `openReview()`, `closeReview()`, `resetSession()`

**`CodeReviewOverlay.vue`:** Declare removed fields as component-local `ref`s. Watch `reviewStore.isOpen` to reset them when review opens.

### 3d. Convert `launch.ts` to a plain module

Create `src/mainview/api/launch.ts` with two exported async functions (`getLaunchConfig`, `runLaunch`). Delete `src/mainview/stores/launch.ts`. Update `TaskChatView.vue` to import from the module.

### 3e. Fix `_replaceTask` O(n) board scan

`Task.boardId` is directly available on the task object. Use it:

```ts
function _replaceTask(updated: Task) {
  const board = tasksByBoard.value[updated.boardId]
  if (board) {
    const idx = board.findIndex((t) => t.id === updated.id)
    if (idx !== -1) {
      tasksByBoard.value[updated.boardId] = board.map((t) =>
        t.id === updated.id ? updated : t
      )
    }
  }
  taskIndex.value[updated.id] = updated
}
```

### 3f. Fix `unreadTaskIds` and `unreadSessionIds` O(n) spread

```ts
// task.ts — markTaskUnread / clearTaskUnread
unreadTaskIds.value.add(taskId)
unreadTaskIds.value.delete(taskId)

// chat.ts — same for unreadSessionIds
unreadSessionIds.value.add(sessionId)
unreadSessionIds.value.delete(sessionId)
```

---

## Wave 4 — Board rendering optimizations

### 4a. `columnTasks` as a computed Map

Replace the plain template function (called twice per column on every render) with a computed that groups tasks once per board change:

```ts
const columnTasksMap = computed(() => {
  const boardId = boardStore.activeBoardId
  if (!boardId) return new Map<string, Task[]>()
  const tasks = taskStore.tasksByBoard[boardId] ?? []
  const map = new Map<string, Task[]>()
  for (const task of tasks) {
    const col = map.get(task.workflowState) ?? []
    col.push(task)
    map.set(task.workflowState, col)
  }
  for (const [key, col] of map) {
    map.set(key, col.slice().sort((a, b) => a.position - b.position))
  }
  return map
})
function columnTasks(columnId: string): Task[] {
  return columnTasksMap.value.get(columnId) ?? []
}
```

### 4b. `v-memo` on `TaskCard`

```html
<TaskCard
  v-for="task in columnTasks(slot.column.id)"
  :key="task.id"
  v-memo="[task, taskStore.hasUnread(task.id), taskStore.changedFileCounts[task.id]]"
  ...
/>
```

Prevents VDOM diff for cards whose deps haven't changed. With 50 tasks and a background stream event changing only one unread state, only that one card diffs.

---

## Risk Matrix

| Wave | Risk | Verification |
|---|---|---|
| 1 | Low — deletions only | `conversation.test.ts`, Playwright UI suite |
| 2 | Low — additive guards | Re-open conversation after done; verify reload |
| 3a, 3b | Medium — import changes + dispatch order | conversationStore must dispatch before task/chat |
| 3c | Low — component-local state | Review overlay Playwright tests |
| 3d | Low — no state | Single consumer (TaskChatView) |
| 3e, 3f | Low — O(1) correctness | Existing task mutation tests |
| 4 | Low — rendering only | Verify v-memo dep list is complete |

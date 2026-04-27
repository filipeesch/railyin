## 1. Store — Queue Data Types and Actions

- [x] 1.1 Add `QueuedMessage` and `QueueState` TypeScript interfaces to a shared location (e.g. `src/mainview/stores/queue-types.ts`)
- [x] 1.2 Add `taskQueues: ref(new Map<number, QueueState>())` to `task.ts` and expose `getTaskQueue(taskId)` computed
- [x] 1.3 Add `sessionQueues: ref(new Map<number, QueueState>())` to `chat.ts` and expose `getSessionQueue(sessionId)` computed
- [x] 1.4 Implement `enqueueMessage(id, msg)`, `dequeueMessage(id, msgId)`, `takeQueue(id)` actions in `task.ts`
- [x] 1.5 Implement same `enqueueMessage`, `dequeueMessage`, `takeQueue` actions in `chat.ts`
- [x] 1.6 Implement `startEdit(id, msgId)`, `confirmEdit(id, msgId, updated)`, `cancelEdit(id)` actions in `task.ts`
- [x] 1.7 Implement same edit actions in `chat.ts`
- [x] 1.8 Implement `drainQueue(taskId)` in `task.ts`: atomically take queue, join with `"\n\n---\n\n"`, call `sendMessage`
- [x] 1.9 Implement `drainQueue(sessionId)` in `chat.ts`: same batch join and send

## 2. Store — Drain Triggers

- [x] 2.1 In `task.ts` `registerHooks("task-store")` `onStreamEvent`: on `event.type === "done"` and `event.taskId != null`, check `taskIndex[taskId].executionState` not `failed`/`cancelled`, then call `drainQueue(taskId)`
- [x] 2.2 In `chat.ts` `registerHooks("chat-store")` `onStreamEvent`: on `event.type === "done"` and `event.taskId == null` and `event.conversationId != null`, resolve `sessionId` via `sessionIdForConversation` and call `drainQueue(sessionId)`

## 3. Interview Answer — Queue Append

- [x] 3.1 In `MessageBubble.vue` `onAskSubmit`: call `taskStore.takeQueue(taskId)` or `chatStore.takeQueue(sessionId)`, append to answer text and engineText with `"\n\n---\n\n"` separator before `sendMessage`
- [x] 3.2 In `MessageBubble.vue` `onInterviewSubmit`: same queue-append logic as 3.1

## 4. ConversationInput — UI Changes

- [x] 4.1 Add `queueState: QueueState | null` prop to `ConversationInput.vue`
- [x] 4.2 Add `onEnqueue`, `onDequeue`, `onStartEdit` emit events to `ConversationInput.vue`
- [x] 4.3 Change `isDisabled` computed: remove `isRunning` from the disabled condition (editor stays enabled while running)
- [x] 4.4 Replace send button with queue button (icon `pi-clock`) when `isRunning && !editingItem`; show "Update #N" when `editingItem` exists
- [x] 4.5 Keep stop button visible alongside queue button when running
- [x] 4.6 Add queue badge chip area above the editor row: render one chip per `queueState.items`
- [x] 4.7 Each chip: show truncated `item.text` (~60 chars), `#N` label, ✏ edit button, ✕ remove button
- [x] 4.8 Ghost chip: when `queueState.editingId != null`, show a ghost placeholder at `editingIndex` with "editing #N..." label and ✕ cancel-edit button
- [x] 4.9 Frozen indicator: when `executionState === "waiting_user"`, show lock icon on all chips (queue frozen)
- [x] 4.10 Wire ✏ click: emit `onStartEdit(item.id)` — parent calls `store.startEdit` then loads `item.text` into editor via `chatEditorRef.clear()` + `chatEditorRef.insert(item.text)`
- [x] 4.11 Wire ✕ chip click: emit `onDequeue(item.id)` — parent calls `store.dequeueMessage`
- [x] 4.12 Wire ✕ ghost click: emit cancel-edit — parent calls `store.cancelEdit`
- [x] 4.13 Add `data-testid` attributes: `queued-msg-{id}`, `queued-msg-edit-{id}`, `queued-msg-remove-{id}`, `queue-btn`, `queue-ghost-cancel`

## 5. TaskChatView and SessionChatView — Wire Queue Props

- [x] 5.1 In `TaskChatView.vue`: pass `queueState` from `taskStore.getTaskQueue(task.id)` to `ConversationInput`; handle `onEnqueue`, `onDequeue`, `onStartEdit` events calling store actions; on `startEdit` load text into `chatEditorRef`
- [x] 5.2 In `SessionChatView.vue`: same wiring using `chatStore.getSessionQueue(session.id)`
- [x] 5.3 On `onSend` in both views: when `isRunning`, call `store.enqueueMessage` instead of sending directly; when editing, call `store.confirmEdit` then send normally

## 6. Queue Button Send Path

- [x] 6.1 In `ConversationInput.vue` `onSend`/`onQueue` handler: if `isRunning` and not editing → emit `enqueue` with `{ text, engineText, attachments }`; if `isRunning` and editing → emit `confirmEdit` with updated content
- [x] 6.2 Ensure `Enter` key press while running queues the message (same as clicking queue button)

## 7. Cleanup

- [x] 7.1 In `task.ts` `deleteTask`: delete `taskQueues[taskId]` after deletion
- [x] 7.2 In `chat.ts` `archiveSession`: delete `sessionQueues[sessionId]`

## 8. E2E Tests

- [x] 8.1 Create `e2e/ui/queue-messages.spec.ts` with Suite Q (task context) tests Q-1 through Q-17
- [x] 8.2 Add Suite QS (chat session context) tests QS-1 through QS-6 to the same file or `chat-session-drawer.spec.ts`
- [x] 8.3 Q-1: editor is enabled when task is running
- [x] 8.4 Q-2: queue button (pi-clock) visible when running; stop button still present
- [x] 8.5 Q-3: typing + Enter while running creates a chip in the badge area
- [x] 8.6 Q-4: chip shows truncated raw text (including slash prompt tokens as-typed)
- [x] 8.7 Q-5: ✕ on chip removes it
- [x] 8.8 Q-6: ✏ on chip loads text into CM6 editor (verify `cm-content` value); CM6 chip tokens re-rendered as `.chat-editor__chip` pills
- [x] 8.9 Q-7: ghost chip appears at original position during edit; cancel restores original item
- [x] 8.10 Q-8: re-queuing edited message restores it to original queue position
- [x] 8.11 Q-9: task completes (`ws.pushDone` + `ws.push task.updated idle`) → exactly ONE `tasks.sendMessage` API call containing all queued items joined with separator
- [x] 8.12 Q-10: queue fires even when drawer is closed (use `api.capture` to verify call)
- [x] 8.13 Q-11: queue does NOT drain when task transitions to `failed`
- [x] 8.14 Q-12: queue does NOT drain when task is cancelled
- [x] 8.15 Q-13: queue isolated between task A and task B
- [x] 8.16 Q-14: queue persists after drawer close and reopen
- [x] 8.17 Q-15: interview answer + 2 queued items → single `sendMessage` call with all 3 parts joined
- [x] 8.18 Q-16: `waiting_user` state → chips show frozen indicator; no auto-drain
- [x] 8.19 QS-1 through QS-6: same scenarios for chat session context using `chatSessions.sendMessage` mock

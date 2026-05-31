## 1. Update Broken Existing Tests

- [x] 1.1 In `conversation.test.ts` SB-5: change assertion from `expect(state).toBeDefined()` to `expect(store.streamStates.get(1)).toBeUndefined()` — non-active done event must delete the entry, not retain a cleared shell
- [x] 1.2 In `conversation.test.ts` SB-9: apply the same assertion inversion — `expect(store.streamStates.get(1)).toBeUndefined()`

## 2. Unit Tests — conversationStore

- [x] 2.1 Add SB-NEW-3 in `conversation.test.ts`: trigger `done` stream events for 10 different non-active conversation IDs (1–10), then assert `store.streamStates.size === 0` — memory-leak regression guard

## 3. Unit Tests — taskStore (stream contamination)

- [x] 3.1 Add T-SC-1 in `task.test.ts`: call `taskStore.sendMessage(bgTaskId, "hi")` after `selectTask(activeTaskId)`; mock `api("tasks.sendMessage")` to return a message with `bgTask.conversationId`; assert `conversationStore.activeConversationId` unchanged and `conversationStore.messages.length === 0`
- [x] 3.2 Add T-SC-2 in `task.test.ts`: same setup but call `sendMessage(activeTaskId, "hi")`; assert message is appended and `activeConversationId` is still the active task's conversation ID — regression guard that the guard doesn't over-block
- [x] 3.3 Add T-SC-3 in `task.test.ts`: call `enqueueMessage(bgTaskId, { text: "hi", ... })` then `onTaskUpdated({ ...bgTask, executionState: "completed" })`; await microtask flush; assert `conversationStore.activeConversationId` unchanged and no messages appended

## 4. Unit Tests — draftStore (new file)

- [x] 4.1 Create `src/mainview/stores/draft.test.ts` with `beforeEach(() => localStorage.clear())` and `createPinia()` setup
- [x] 4.2 Add DR-1: `draftStore.get('task:1')` returns `null` when key absent
- [x] 4.3 Add DR-2: `draftStore.set('task:1', 'hello')` then `draftStore.get('task:1').text === 'hello'`
- [x] 4.4 Add DR-3: `set` then `clear` then `get` returns `null`
- [x] 4.5 Add DR-4: manually insert a localStorage entry with `savedAt = Date.now() - 8 * 24 * 60 * 60 * 1000`, call `draftStore._evictStale()`, assert `draftStore.get(key)` returns `null`
- [x] 4.6 Add DR-5: same but `savedAt = now - 6 days`; assert entry is retained
- [x] 4.7 Add DR-6: set `'task:1'` and `'session:1'` to different values; assert each `get` returns its own value without interference

## 5. Playwright — Stream Contamination (E2E)

- [x] 5.1 Add SS-3 in `e2e/ui/conversation-stream-state.spec.ts`: set up `taskA` (active, idle) and `taskB` (running); `enqueueMessage` via pre-populated queue; `openTaskDrawer(page, taskA.id)`; push `task.updated` for taskB with `executionState: "completed"`; mock `api.handle("tasks.sendMessage")` returning a message for taskB's conversationId; assert `.task-chat-view .msg--assistant` has count 0 and no streaming content visible

## 6. Playwright — Draft Persistence (new file)

- [x] 6.1 Create `e2e/ui/conversation-draft.spec.ts` with fixture imports (`makeTask`, `openTaskDrawer`, `makeChatSession`, `openSessionDrawer`) and a `typeInEditor` helper reused from the queue-messages pattern
- [x] 6.2 Add DR-E2E-1: type text in task input → click Info tab → click Chat tab → assert `.task-detail__input .cm-content` contains the typed text
- [x] 6.3 Add DR-E2E-2: type text → press Escape (close drawer) → `openTaskDrawer(page, task.id)` again → assert text is restored in editor
- [x] 6.4 Add DR-E2E-3: type text → `page.reload()` → open task drawer → assert text is restored (localStorage survives reload)
- [x] 6.5 Add DR-E2E-4: type text → click send button → assert editor is empty
- [x] 6.6 Add DR-E2E-5: type text in Task A → close drawer → open Task B → type different text → close → reopen Task A → assert Task A's original draft text is present
- [x] 6.7 Add DR-E2E-6: open session drawer → type text in `.session-chat-view .cm-content` → switch to Decisions tab → switch back to Chat tab → assert text is preserved

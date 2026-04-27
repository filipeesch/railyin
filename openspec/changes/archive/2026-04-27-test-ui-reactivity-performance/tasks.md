# Tasks: Test UI Reactivity Performance

## 1. Unit tests — conversation store stream block suite

- [x] 1.1 **`conversation.test.ts` SB-1**: `onStreamEvent` with first `text_chunk` creates stream state entry and Map identity is preserved (`store.streamStates.value` toBe same instance before and after)
- [x] 1.2 **`conversation.test.ts` SB-2**: `onStreamEvent` with second `text_chunk` appends text to the existing block (concatenation check)
- [x] 1.3 **`conversation.test.ts` SB-3**: Map identity regression sentinel — call `onStreamEvent` twice, assert `store.streamStates.value` is the same Map instance both times (fails against current code, passes after fix)
- [x] 1.4 **`conversation.test.ts` SB-4**: `tool_start` event creates a new block with correct `blockId` and `toolName`
- [x] 1.5 **`conversation.test.ts` SB-5**: `done` event for NON-active conversation clears `blocks` and `roots` but retains the state shell with `isDone: true` and `executionId`
- [x] 1.6 **`conversation.test.ts` SB-6**: `done` event for the ACTIVE conversation does NOT clear `blocks` — all streamed blocks remain
- [x] 1.7 **`conversation.test.ts` SB-7**: `contextUsageByConversation` is mutated in place (no clone) — same Map instance after `fetchContextUsage` resolves
- [x] 1.8 **`conversation.test.ts` SB-8**: Switching active conversation via `setActiveConversation` deletes the previous conversation's entry from `contextUsageByConversation`
- [x] 1.9 **`conversation.test.ts` SB-9**: Stream state is removed when cleanup is triggered — verify `streamStates.value.get(conversationId)` returns the expected shell only
- [x] 1.10 **`conversation.test.ts` SB-10**: Multiple conversations stream simultaneously — events for conversation A do not affect stream state for conversation B

## 2. Unit tests — task store

- [x] 2.1 **Create `src/mainview/stores/task.test.ts`**: Set up `vi.mock("../rpc")` DI pattern and `setActivePinia(createPinia())` in `beforeEach` — mirror the pattern from `conversation.test.ts`
- [x] 2.2 **T1**: `loadTasks(boardId)` populates `tasksByBoard[boardId]` and `taskIndex[task.id]` via mocked API
- [x] 2.3 **T2**: `loadTasks` for two boards — each board's entries are independent
- [x] 2.4 **T3**: `onTaskUpdated` replaces the correct task in `tasksByBoard` using `task.boardId` (O(1) path — verify no other board is mutated)
- [x] 2.5 **T4**: `onTaskUpdated` updates `taskIndex[task.id]` to the new task object
- [x] 2.6 **T5**: `_replaceTask` regression — seed via `loadTasks`, call `onTaskUpdated`, assert `tasksByBoard[boardId][0]` and `taskIndex[id]` are updated (DI via apiMock, no class extraction)
- [x] 2.7 **T6**: `markTaskUnread` — same Set instance before and after `.add()`, taskId present in Set
- [x] 2.8 **T7**: `clearTaskUnread` — same Set instance before and after `.delete()`, taskId absent from Set
- [x] 2.9 **T8**: `deleteTask` removes `changedFileCounts[taskId]` entry after successful API call

## 3. Unit tests — chat store

- [x] 3.1 **Create `src/mainview/stores/chat.test.ts`**: Set up `vi.mock("../rpc")` DI pattern and `setActivePinia(createPinia())` in `beforeEach`
- [x] 3.2 **C1**: `markUnread(sessionId)` — same `unreadSessionIds` Set instance before and after, sessionId present
- [x] 3.3 **C2**: `clearUnread(sessionId)` — same Set instance before and after, sessionId absent
- [x] 3.4 **C3**: Messages are only appended for the active session (mirrors existing conversation test)
- [x] 3.5 **C4**: `onChatStreamEvent` updates stream state for the correct session
- [x] 3.6 **C5**: `onChatNewMessage` appends message to active session messages
- [x] 3.7 **C6**: `unreadSessionIds` Set identity is preserved across multiple mark/clear cycles

## 4. Unit tests — multi-store dispatch ordering

- [x] 4.1 **Create `src/mainview/stores/dispatch.test.ts`**: Instantiate all three stores (conversation, task, chat) from a shared Pinia
- [x] 4.2 **D1**: When dispatch sequence runs a stream event — `conversationStore.streamStates` is populated BEFORE `onTaskStreamEvent` executes (dispatch order: conversation first)
- [x] 4.3 **D2**: All three stores receive the event — verify `conversationStore`, `taskStore`, and `chatStore` each reflect the event after the full dispatch
- [x] 4.4 **D3**: `onNewMessage` dispatch — conversation store appends message before task store reacts
- [x] 4.5 **D4**: No event is lost when all three stores dispatch in sequence (idempotency under repeated dispatch)
- [x] 4.6 **D5**: Dispatch with an unknown conversation ID does not throw in any store

## 5. Playwright E2E — stream reactivity spec

- [x] 5.1 **Create `e2e/ui/stream-reactivity.spec.ts`**: Set up extended test fixture with `ApiMock` + `WsMock` — mirror the pattern from `e2e/ui/fixtures/index.ts`
- [x] 5.2 **Suite A — live streaming**: Push 5 `text_chunk` events via `WsMock`; assert each chunk appears in the conversation body within 2s; assert no full-page reload occurs
- [x] 5.3 **Suite A — tool rendering**: Push `tool_start` → `tool_result` sequence; assert tool block appears with correct tool name
- [x] 5.4 **Suite B-1 — rendering isolation**: Open drawer for task 1; attach `MutationObserver` to `.conv-body`; push 5 events for task 2; assert mutation count === 0 on task 1's body AND unread dot visible on task 2's card
- [x] 5.5 **Suite B-2 — streamVersion removal**: Verify no `data-stream-version` attribute or equivalent exists in rendered DOM after streaming
- [x] 5.6 **Suite C-1 — memory cleanup**: Open task drawer; push stream events; push `done`; close drawer; re-open drawer; assert conversation reloads from API (no stale blocks visible)
- [x] 5.7 **Suite C-2 — stale stream guard**: After `done` event for background task, opening its drawer should show a fresh load (stream blocks cleared, messages loaded from API)
- [x] 5.8 **Suite D-1 — unread dot on background stream**: Push stream events for task 2 while task 1 drawer is open; assert task 2's card shows unread dot; open task 2; assert unread dot disappears
- [x] 5.9 **Suite E-1 — auto-scroll**: Open drawer; push enough chunks to overflow the conversation body; assert scroll position is at the bottom after last chunk (within 500ms)
- [x] 5.10 **Suite E-2 — no scroll for background**: Push stream events for task 2 while task 1 drawer is open; assert task 1's scroll position does not change

## 6. Verification

- [x] 6.1 Run `bun test src/mainview/stores/conversation.test.ts` — all SB tests pass
- [x] 6.2 Run `bun test src/mainview/stores/task.test.ts` — all T tests pass
- [x] 6.3 Run `bun test src/mainview/stores/chat.test.ts` — all C tests pass
- [x] 6.4 Run `bun test src/mainview/stores/dispatch.test.ts` — all D tests pass
- [x] 6.5 Run `bun run build && npx playwright test e2e/ui/stream-reactivity.spec.ts` — all Playwright suites A–E pass
- [x] 6.6 Run full backend suite `bun test src/bun/test --timeout 20000` — no regressions (no backend changes expected)

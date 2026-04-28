## 1. Extract Shared Helpers

- [x] 1.1 Create `e2e/ui/fixtures/helpers.ts` exporting `openTaskDrawer(page, taskId)`, `sendMessage(page, text)`, `openSessionDrawer(page, sessionId)`, `openSidebar(page)`, and `typeInSessionEditor(page, text, submitKey?)`
- [x] 1.2 Re-export helpers from `e2e/ui/fixtures/index.ts` alongside existing `test` and `expect`
- [x] 1.3 Update `e2e/ui/chat.spec.ts` to import `openTaskDrawer` and `sendMessage` from fixtures instead of re-declaring them
- [x] 1.4 Update `e2e/ui/extended-chat.spec.ts` to import `openTaskDrawer` and `sendMessage` from fixtures instead of re-declaring them
- [x] 1.5 Update `e2e/ui/task-drawer.spec.ts` to import `openTaskDrawer` from fixtures instead of re-declaring it
- [x] 1.6 Update `e2e/ui/chat-session-drawer.spec.ts` to import `openSessionDrawer`, `openSidebar`, and `typeInSessionEditor` from fixtures instead of re-declaring them

## 2. Task Toolbar Tests

- [x] 2.1 Create `e2e/ui/task-toolbar.spec.ts` with suite "TT — toolbar action guards"
- [x] 2.2 Add test: workflow select shows current column (`makeTask({ workflowState: "in-progress" })` → assert `.workflow-select` value)
- [x] 2.3 Add test: changing workflow select triggers `tasks.transition` API call (use `api.capture`)
- [x] 2.4 Add test: terminal button hidden when `worktreePath: null`, visible when set (two separate tests)
- [x] 2.5 Add test: code editor button hidden when `worktreePath: null`, visible when set (two separate tests)
- [x] 2.6 Add test: retry button hidden when `executionState: "idle"`, visible when `executionState: "failed"` (two separate tests)
- [x] 2.7 Add test: delete dialog opens on `.pi-trash` click, shows "Delete task" header
- [x] 2.8 Add test: delete dialog Cancel button dismisses dialog without calling `tasks.delete`
- [x] 2.9 Add test: delete dialog Delete button calls `tasks.delete` with the correct task id

## 3. Session Sidebar Edge Case Tests

- [x] 3.1 Create `e2e/ui/session-sidebar-edge.spec.ts` with suite "SE — session sidebar edge cases"
- [x] 3.2 Add test: auto-title format — session with title "Chat – Apr 21" appears as "Chat – Apr 21" in sidebar
- [x] 3.3 Add test: blur commits rename — type new title, click away, assert `chatSessions.rename` called (without pressing Enter)
- [x] 3.4 Add test: session moves to top — set up two sessions, push WS update to lower session with newer `lastActivityAt`, assert it moves to top of list

## 4. Attachment History Tests

- [x] 4.1 Create `e2e/ui/attachment-history.spec.ts` with suite "AH — attachment history rendering"
- [x] 4.2 Add test: user message with `[#ref|label]` chip syntax in content renders one `.inline-chip-text__chip--file` chip
- [x] 4.3 Add test: user message with two `[#ref|label]` tokens renders two chips
- [x] 4.4 Add test: user message with plain text content (no chip syntax) renders no `.inline-chip-text__chip--file` chips

## 5. Stream State Isolation Tests

- [x] 5.1 Create `e2e/ui/conversation-stream-state.spec.ts` with suite "SS — stream state isolation"
- [x] 5.2 Add test: task A's streamed content not visible in task B's conversation body (two tasks, open A → stream → switch to B)
- [x] 5.3 Add test: stream state survives drawer switch — stream to task A, open session drawer, return to task A, assert content still present

## 6. Legacy Transition Row Coexistence Tests

- [x] 6.1 Create `e2e/ui/transition-card-legacy.spec.ts` with suite "LC — legacy prompt row coexistence"
- [x] 6.2 Add test: timeline with `{ type: "user", role: "prompt" }` message renders `.msg--prompt` element
- [x] 6.3 Add test: timeline with both legacy prompt row and `transition_event` message renders both `.msg--prompt` and the transition card without error

## 7. Verification

- [x] 7.1 Run `bun run build && npx playwright test e2e/ui/` and confirm all new tests pass with no existing regressions

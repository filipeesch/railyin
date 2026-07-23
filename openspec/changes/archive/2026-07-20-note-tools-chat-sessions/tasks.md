## 1. Frontend: Notes Tab in SessionChatView

- [x] 1.1 Import `NotesPanel` component in `SessionChatView.vue`
- [x] 1.2 Add "Notes" tab button to the tab switcher after "Decisions" tab
- [x] 1.3 Add `activeTab` union type to include `"notes"` alongside `"chat"` and `"decisions"`
- [x] 1.4 Render `NotesPanel` component with `:conversation-id="session.conversationId"` when Notes tab is active
- [x] 1.5 Add `notesRefreshTrigger` ref that increments when session status changes from `running` to non-running
- [x] 1.6 Pass `:refresh-trigger="notesRefreshTrigger"` to `NotesPanel`

## 2. Backend: TODO_TOOL_NAMES constant and filtering helper

- [x] 2.1 Define `TODO_TOOL_NAMES` constant set in `src/bun/engine/common-tools.ts` with all 6 todo tool names
- [x] 2.2 Export `TODO_TOOL_NAMES` from `common-tools.ts`

## 3. Engine: Pi engine tool filtering

- [x] 3.1 Update `buildCommonTools()` in `src/bun/engine/pi/tools/common.ts` to filter out tools in `TODO_TOOL_NAMES` when `ctx.task.id === null`

## 4. Engine: Copilot engine tool filtering

- [x] 4.1 Update `buildCopilotTools()` in `src/bun/engine/copilot/tools.ts` to filter out tools in `TODO_TOOL_NAMES` when `context.task.id === null`

## 5. Engine: Claude engine tool filtering

- [x] 5.1 Update `buildTools()` in `src/bun/engine/claude/tools.ts` to filter out tools in `TODO_TOOL_NAMES` when `context.task.id === null`

## 6. Engine: Cursor engine tool filtering

- [x] 6.1 Update `buildCursorTools()` in `src/bun/engine/cursor/tools.ts` to filter out tools in `TODO_TOOL_NAMES` when `context.task.id === null`

## 7. Engine: OpenCode MCP server tool filtering

- [x] 7.1 Update `tools/list` endpoint in `src/bun/engine/opencode/mcp-server.ts` to filter out task-scoped tools when active context entry has `taskId: null`
- [x] 7.2 Ensure filter falls back to full tool set if no active context exists (conservative default)

## 8. Tests: Playwright infrastructure

- [x] 8.1 Add `session: ChatSession` fixture to `e2e/ui/fixtures/index.ts` (mirrors existing `task` fixture)
- [x] 8.2 Add `openSessionNotesTab()` helper to `e2e/ui/fixtures/helpers.ts`
- [x] 8.3 Add `notes.list` baseline handler to fixture defaults

## 9. Tests: Unit tests for tool filtering

- [x] 9.1 Create `src/bun/test/tool-context-filtering.test.ts` with TCF-1 through TCF-9 scenarios
- [x] 9.2 Verify `TODO_TOOL_NAMES` contains all 6 task-scoped tool names
- [x] 9.3 Verify Pi engine excludes/includes todo tools based on `taskId`
- [x] 9.4 Verify Copilot engine excludes/includes todo tools based on `taskId`
- [x] 9.5 Verify Claude engine excludes todo tools when `taskId` is null
- [x] 9.6 Verify Cursor engine excludes todo tools when `taskId` is null
- [x] 9.7 Verify OpenCode MCP server excludes todo tools when `taskId` is null
- [x] 9.8 Verify note/decision/board tools remain available in chat sessions

## 10. Tests: Playwright tests for Notes tab in session

- [x] 10.1 Create `e2e/ui/session-chat-notes.spec.ts`
- [x] 10.2 CSN-1: Notes tab button is visible in session chat view
- [x] 10.3 CSN-2: Notes panel renders with session conversationId
- [x] 10.4 CSN-3: Notes panel shows notes after AI execution creates them
- [x] 10.5 CSN-4: Notes panel refreshes on status change (running → idle)

## Why

The rolling chat conversation view has accumulated 9 distinct UX regressions affecting readability and usability: tool calls incorrectly appear nested inside the reasoning bubble and disappear when it collapses, Copilot subagent tool calls are invisible during streaming, Claude tool results don't show at all (array content format unhandled), common tools show raw JSON, the ReasoningBubble label is inconsistent, decision answer messages render raw markdown asterisks, and a horizontal scrollbar appears in the chat panel due to missing CSS. These compound into a degraded experience that makes it hard to follow what the agent is doing.

## What Changes

- **ReasoningBubble**: Fix tool calls being nested inside it during streaming; change to fully manual open/close (no auto-expand/collapse); rename "Thinking…" label to "Reasoning…"
- **Copilot subagent tools**: Show subagent tool calls in the live stream when their parent block exists (currently suppressed as isInternal); add pulse animation on spawning tool while running
- **Claude tool results**: Normalize `block.content` array format → `formattedContent` string in `claude/events.ts` so results display correctly
- **Copilot edit `startLine`**: Extract and pass `startLine` from edit tool args so ReadView shows correct line numbers (currently always 1)
- **Common tool results** (`create_todo`, `list_tasks`, etc.): Return `detailedContent` envelope from backend instead of raw JSON
- **Shell command subjects**: Strip worktree root prefix from bash/terminal tool subjects so the actual command is visible (not truncated absolute path)
- **Horizontal scrollbar**: Add `overflow-x: hidden` to `.conv-body` in `ConversationBody.vue`
- **Decision answer messages**: Render user messages with markdown (`renderMd()` + `.prose`); remove redundant broken answered-view block from `DecisionRequest`
- **Frontend decomposition**: Extract `ToolCallBlock.vue` shared component with `ToolCallProps` normalized interface, used by both `StreamBlockNode` (live) and `ToolCallGroup` (persisted); extract `useToolResultDisplay` composable; reduce `StreamBlockNode` to a pure router

## Capabilities

### New Capabilities
- `chat-tool-call-rendering`: Unified tool call rendering via `ToolCallBlock.vue` shared component covering both live stream and persisted paths, with normalized `ToolCallProps` interface, subagent nesting, pulse animation, and correct result display

### Modified Capabilities
- `conversation`: User messages now render with markdown; decision answer messages display correctly
- `decision-request-ui`: Remove broken answered-view block; answered state shown via user message bubble below
- `engine-stream-processor`: Tool calls no longer inherit `reasoningBlockId` as parent; fixes nesting regression
- `frontend-reactive-stream`: Subagent tool calls visible in stream when `parentBlockId` exists; decomposed `StreamBlockNode` becomes router component

## Impact

- **Backend**: `stream-processor.ts`, `copilot/events.ts`, `claude/events.ts`, `common-tools.ts`
- **Frontend**: `StreamBlockNode.vue`, `ToolCallGroup.vue`, `ReasoningBubble.vue`, `MessageBubble.vue`, `DecisionRequest.vue`, `ConversationBody.vue`
- **New files**: `src/mainview/components/ToolCallBlock.vue`, `src/mainview/composables/useToolResultDisplay.ts`
- **No API/DB changes**: All fixes are within existing message types and event shapes; `formattedContent` field already exists on `tool_result` message format

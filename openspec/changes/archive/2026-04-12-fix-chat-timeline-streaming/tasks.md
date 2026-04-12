## 1. Filter and truncate status events in events.ts

- [x] 1.1 Parse `toolCallId` from `tool.execution_partial_result` and `tool.execution_progress` SDK events and look up `toolMetaByCallId` to check `isInternal`
- [x] 1.2 Return `null` from `translateEvent()` for partial_result/progress events when the originating tool is internal
- [x] 1.3 For non-internal tools, truncate status message to last non-empty line, prefix with tool name, cap at 120 chars

## 2. Associate tool calls with preceding reasoning in orchestrator

- [x] 2.1 Add `reasoningBlockId` tracking variable in `consumeStream()` — set it to the persisted reasoning block's ID when reasoning is flushed due to `tool_start`
- [x] 2.2 Set `parentBlockId = reasoningBlockId` on tool_call StreamEvents when `reasoningBlockId` is active (and `event.parentCallId` is not already set)
- [x] 2.3 Clear `reasoningBlockId` when token events arrive (reasoning phase ended)

## 3. Render tool calls inside reasoning bubbles

- [x] 3.1 Update `ReasoningBubble.vue` to accept and render child slot content (tool call blocks nested inside the bubble body)
- [x] 3.2 Update `StreamBlockNode.vue` to render reasoning block children (tool_call blocks with `parentBlockId` pointing to a reasoning block) inside the reasoning bubble instead of at root level

## 4. Fix ReadView line number offset

- [x] 4.1 Add optional `startLine` prop to `ReadView.vue` and use it as gutter offset (default to 1 when not provided)
- [x] 4.2 In `ToolCallGroup.vue`, parse `startLine` from the `read_file` tool call arguments and pass it as prop to `ReadView`

## 5. Suppress toast for active task

- [x] 5.1 Add guard in `App.vue` `toastForActivity()` to skip toast when `activity.task.id === taskStore.activeTaskId`

## 6. Update tests

- [x] 6.1 Update UI tests in `chat-timeline-pipeline.test.ts` to reflect new tool-call-under-reasoning block nesting
- [x] 6.2 Verify status bar tests still pass with truncated/filtered status messages

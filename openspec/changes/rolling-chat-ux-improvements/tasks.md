## 1. Backend Bug Fixes (stream-processor + engine)

- [ ] 1.1 Fix `stream-processor.ts`: remove `?? reasoningBlockId` fallback from `toolParentBlockId` assignment for both `tool_call` (~L265) and `tool_result` (~L300) events
- [ ] 1.2 Fix `copilot/events.ts` `isInternalCopilotEvent()`: remove `if (parentToolCallId) return true` guard (L365); retain guards for `skill-*`, `report_intent`, `internal_*`, `copilot_*`
- [ ] 1.3 Fix `claude/events.ts`: normalize `block.content` array format to a plain string stored in `formattedContent` — `Array.isArray(content) ? content.filter(b=>b.type==='text').map(b=>b.text).join('\n') : content`
- [ ] 1.4 Fix `copilot/events.ts` `buildCopilotNativeDisplay("edit")`: extract `startLine` from edit tool args and include in `ToolCallDisplay`
- [ ] 1.5 Fix `common-tools.ts` `executeCommonToolText`: wrap results in `{ detailedContent: "...", data: {...} }` envelope for all common tools (`create_todo`, `list_tasks`, `update_todo_status`, `get_task`, etc.)
- [ ] 1.6 Add optional `worktreePath?: string` param to `buildCopilotNativeDisplay` and `buildClaudeBuiltinDisplay`; for bash/terminal subjects, replace any leading absolute path segment matching `worktreePath` with the relative path using `path.relative()`
- [ ] 1.7 Refactor `translateCopilotStream` optional params into a single options bag `{ signal?, sendPromise?, worktreePath?, onWatchdogFire?, onRawEvent?, onHeartbeat?, idleTimeoutMs?, maxSilenceCount? }`; apply same options-bag pattern to `translateClaudeMessage`; update all callers in `stream-processor.ts` and test helpers

## 2. ReasoningBubble Fixes

- [ ] 2.1 Remove the `watch(() => props.streaming, ...)` auto-expand/auto-collapse watcher in `ReasoningBubble.vue`; initialize `open` ref to `false` (starts collapsed always)
- [ ] 2.2 Change label text from `"Thinking…"` to `"Reasoning…"` in `ReasoningBubble.vue` (line 7)

## 3. CSS / Layout Fix

- [ ] 3.1 Add `overflow-x: hidden` to `.conv-body` in `ConversationBody.vue` to suppress horizontal scrollbar from wide child content (ReadView, FileDiff, pre blocks)

## 4. Decision Answer Message Rendering

- [ ] 4.1 Change `MessageBubble.vue` user message branch to render with `v-html="renderMd(displayContent)"` and `.prose` class instead of `<InlineChipText>`
- [ ] 4.2 Remove the `v-if="answered"` branch from `DecisionRequest.vue` (the entire dark answered-view block); remove `answeredText` prop, `answered` computed, and `answeredSummary` computed; when answered, the component renders nothing

## 5. Shared ToolCallBlock Component + Decomposition

- [ ] 5.1 Create `src/mainview/composables/useToolResultDisplay.ts`: extract result text resolution logic (priority: `detailedContent → contents[].text → content → raw`) from `conversation.ts`
- [ ] 5.2 Create `src/mainview/components/ToolCallBlock.vue` with the `ToolCallProps` interface; implement collapsible header (label, subject, status icon, children badge), body with ReadView/pre/FileDiff rendering, and recursive children rendering
- [ ] 5.3 Add pulse animation to `ToolCallBlock.vue` sitemap icon: apply `pi-sitemap--pulse` class when `status === 'pending'` and `children.length > 0`; reuse the `pulse` keyframe from `ReasoningBubble`
- [ ] 5.4 Refactor `ToolCallGroup.vue`: add `ToolEntry → ToolCallProps` adapter computed and render via `<ToolCallBlock>` instead of inline template
- [ ] 5.5 Refactor `StreamBlockNode.vue`: add `StreamBlock → ToolCallProps` adapter computed for `tool_call` blocks; render via `<ToolCallBlock>` for `type === 'tool_call'`; keep other block types (reasoning, assistant, file_diff, etc.) as-is initially

## 6. Verification

- [ ] 6.1 Manually verify: tool calls appear as siblings of reasoning bubble (not children), before and after stream completes
- [ ] 6.2 Manually verify: Copilot subagent tool calls appear nested under spawning tool in live stream
- [ ] 6.3 Manually verify: Claude tool results display content (not blank/JSON)
- [ ] 6.4 Manually verify: decision answer user messages render as formatted markdown (no raw asterisks)
- [ ] 6.5 Manually verify: no horizontal scrollbar in chat window when ReadView or file diffs are present
- [ ] 6.6 Run backend test suite: `bun test src/bun/test --timeout 20000`

## Why

The chat timeline in `TaskDetailDrawer.vue` renders every conversation message and tool call unconditionally in the DOM. In long agent sessions (50+ messages, hundreds of tool calls), this causes noticeable lag when opening the task, sluggish typing in the chat input, and slow re-renders — because the browser must recalculate layout for all DOM nodes even for unrelated interactions.

## What Changes

- The `v-for` loop over `displayItems` in the conversation timeline is replaced with a `@tanstack/vue-virtual` virtualizer that only renders ~15 items at a time (the visible window + overscan)
- Each virtual item wrapper uses `ref` + `measureElement` for dynamic height tracking via `ResizeObserver`
- The absolutely-positioned spacer div replaces `.conversation-inner` as the scroll-height anchor
- The live streaming tail (ReasoningBubble, streaming token div, status spinner) remains in normal document flow after the virtual list — unchanged
- Auto-scroll-to-bottom logic is preserved exactly; `scrollToBottom()` continues to set `scrollEl.scrollTop = scrollEl.scrollHeight`
- `@tanstack/vue-virtual` is added as a production dependency

## Capabilities

### New Capabilities
- `chat-timeline-virtualization`: Windowed rendering of conversation timeline items; only the visible window of messages is mounted in the DOM at any time, with dynamic height measurement and scroll anchoring

### Modified Capabilities
<!-- No existing spec requirements are changing — the visible UX is identical -->

## Impact

- `src/mainview/components/TaskDetailDrawer.vue` — template and script changes (surgical, ~30 lines)
- `package.json` / `bun.lock` — new dependency: `@tanstack/vue-virtual`
- No changes to `ToolCallGroup.vue`, `MessageBubble.vue`, `CodeReviewCard.vue`, `pairToolMessages.ts`, or any store

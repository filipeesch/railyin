## Why

The task chat timeline currently mixes persisted messages with separate live rendering paths for reasoning, assistant output, and status/tool activity. That split causes visible UX problems: the reasoning bubble does not respect anchored auto-scroll, fast message sequences can appear out of chronological order, custom slash prompts can render their resolved body instead of the command the user typed, and Copilot tool activity is rendered with incomplete or noisy UI details.

The result is a chat view that feels unstable during streaming and hides important execution context while also surfacing internal details that should stay out of the user-facing conversation.

## What Changes

- **Stable chat chronology**: make conversation loading and rendering use a single canonical append order so reasoning, tool calls, tool results, diffs, and assistant messages remain in the order they were received.
- **Anchored auto-scroll for all live chat content**: apply bottom-lock scrolling to streaming reasoning, assistant output, and other live timeline items, pausing when the user scrolls away and resuming once they return to the bottom threshold.
- **Prompt display separation**: preserve the user-visible prompt invocation (for example `/my-prompt`) separately from the resolved prompt body sent to the engine.
- **Richer tool result rendering**: show an explicit empty-state message when a tool produced no output, and render line-level added/removed changes for Copilot-driven file edits when the SDK provides enough detail.
- **Filter hidden/internal Copilot activity**: suppress SDK events and tool activity that are marked or inferred as non-user-facing so the timeline only shows meaningful user-visible actions.
- **Compact message typography**: slightly reduce the font size of normal chat messages to improve density and readability.

## Capabilities

### Modified Capabilities
- `conversation`
- `task-detail`
- `model-reasoning`
- `slash-prompt-resolution`
- `file-diff-visualization`
- `copilot-engine`

## Impact

- `src/mainview/components/TaskDetailDrawer.vue`
- `src/mainview/components/MessageBubble.vue`
- `src/mainview/components/ReasoningBubble.vue`
- `src/mainview/components/ToolCallGroup.vue`
- `src/mainview/components/FileDiff.vue`
- `src/mainview/stores/task.ts`
- `src/bun/handlers/conversations.ts`
- `src/bun/workflow/engine.ts`
- `src/bun/engine/orchestrator.ts`
- `src/bun/workflow/slash-prompt.ts`
- `src/bun/engine/copilot/session.ts`
- `src/bun/engine/copilot/events.ts`
- `src/shared/rpc-types.ts`
- `src/ui-tests/chat.test.ts`
- `src/ui-tests/extended-chat.test.ts`

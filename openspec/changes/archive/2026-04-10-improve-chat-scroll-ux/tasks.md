## 1. Conversation ordering and timeline assembly

- [x] 1.1 Update conversation reads and related history assembly paths to use stable append ordering instead of `created_at ASC`
- [x] 1.2 Audit all timeline/grouping code so `reasoning`, `tool_call`, `tool_result`, `file_diff`, and `assistant` messages preserve received order
- [ ] 1.3 Ensure live timeline items do not render in a separate order from their persisted counterparts during active streaming

## 2. Anchored auto-scroll behavior

- [x] 2.1 Refactor the task drawer scroll logic to react to live reasoning, live assistant output, and other timeline growth, not only persisted message count
- [x] 2.2 Keep auto-scroll paused while the user is away from the bottom and resume it when they return within the bottom threshold
- [x] 2.3 Confirm reasoning streaming stays anchored like the rest of the conversation

## 3. Prompt display separation

- [x] 3.1 Preserve original slash/custom prompt invocations as the user-visible chat content
- [x] 3.2 Keep resolved prompt bodies out of normal chat bubbles while still passing them to the engine
- [x] 3.3 Define how workflow/internal prompt entries should render when they have a visible label versus when they should stay hidden

## 4. Tool result UX

- [x] 4.1 Add an explicit empty-state message for tool rows that have no user-visible output
- [x] 4.2 Preserve and render richer Copilot tool result payloads so file edits can show added/removed lines
- [x] 4.3 Keep existing write-tool `file_diff` behavior intact while extending Copilot-specific rendering

## 5. Copilot event filtering

- [x] 5.1 Expand Copilot SDK event/result typing to preserve metadata needed for filtering and richer rendering
- [x] 5.2 Filter hidden/internal Copilot timeline activity before it reaches the visible conversation
- [x] 5.3 Avoid filtering user-visible tool activity that should still appear in the chat timeline

## 6. Chat presentation polish

- [x] 6.1 Slightly reduce the font size of standard user and assistant message bubbles
- [x] 6.2 Keep specialized surfaces such as reasoning bubbles, diffs, and tool rows readable and visually consistent

## 7. Validation

- [ ] 7.1 Extend UI tests to cover anchored scrolling, chronological ordering, prompt display separation, and empty tool outputs
- [x] 7.2 Add backend or adapter tests for stable ordering and Copilot event/result filtering where appropriate
- [ ] 7.3 Add coverage for Copilot file-edit rendering so line-level changes remain visible

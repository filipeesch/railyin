## 1. Orphan Detection Helper

- [ ] 1.1 Add `isEmptyAssistantMessage(m: AIMessage): boolean` helper in `anthropic.ts`: returns `true` when `m.role === "assistant"` and `content` is null/undefined/whitespace-only and `tool_calls` is absent or empty

## 2. Pre-flight Filter in adaptMessages

- [ ] 2.1 Apply the orphan filter as the first step of `adaptMessages()`: remove all messages where `isEmptyAssistantMessage` returns `true` from a working copy of the input array before any other adaptation logic runs
- [ ] 2.2 Emit a warn-level log entry for each removed message, including the message index and any available context (e.g. role, content preview)

## 3. Tests

- [ ] 3.1 Write unit tests for `isEmptyAssistantMessage`: null content + no tool_calls (true), empty-string content + no tool_calls (true), non-empty content (false), tool_calls present with no content (false)
- [ ] 3.2 Write unit tests for `adaptMessages()` verifying that orphaned messages are removed from the wire payload and that the warn log is called
- [ ] 3.3 Write unit tests verifying that valid assistant messages (with text or with tool_calls) survive the orphan filter unchanged

## 1. Orphan Detection Helper

- [x] 1.1 Add `isEmptyAssistantMessage(m: AIMessage): boolean` helper in `anthropic.ts`: returns `true` when `m.role === "assistant"` and `content` is null/undefined/whitespace-only and `tool_calls` is absent or empty

## 2. Pre-flight Filter in adaptMessages

- [x] 2.1 Apply the orphan filter as the first step of `adaptMessages()`: remove all messages where `isEmptyAssistantMessage` returns `true` from a working copy of the input array before any other adaptation logic runs
- [x] 2.2 Emit a warn-level log entry for each removed message, including the message index and any available context (e.g. role, content preview)

## 3. Tests

- [x] 3.1 Write unit tests for `isEmptyAssistantMessage`: null content + no tool_calls (true), empty-string content + no tool_calls (true), non-empty content (false), tool_calls present with no content (false)
- [x] 3.2 Write unit tests for `adaptMessages()` verifying that orphaned messages are removed from the wire payload and that the warn log is called
- [x] 3.3 Write unit tests verifying that valid assistant messages (with text or with tool_calls) survive the orphan filter unchanged

## 4. Orphaned tool_call in compactMessages (extended scope)

- [x] 4.1 In `compactMessages()`, before emitting an assistant+tool_calls message for a `tool_call` row, check that a `tool_result` row immediately follows. If not, skip the entire tool_call row (emit nothing) and log at warn level with the message ID.
- [x] 4.2 Write unit tests verifying that an orphaned tool_call at end-of-history is dropped from compactMessages output (no assistant message emitted).
- [x] 4.3 Write unit tests verifying that an orphaned tool_call in the middle is skipped while subsequent valid pairs and messages remain.

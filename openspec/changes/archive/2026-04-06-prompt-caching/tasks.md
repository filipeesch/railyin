## 1. Return Type Extension

- [x] 1.1 Add `AnthropicSystemBlock` type to `anthropic.ts` (`{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }`)
- [x] 1.2 Update `adaptMessages()` return type to `{ system?: AnthropicSystemBlock[]; messages: AnthropicMessage[] }` (replaces `system?: string`)

## 2. System Prompt Cache Breakpoint

- [x] 2.1 Build `systemBlocks` as `AnthropicSystemBlock[]` from the system prompt string inside `adaptMessages()`
- [x] 2.2 Set `cache_control: { type: "ephemeral" }` on the last element of `systemBlocks`
- [x] 2.3 Update `stream()` request body to pass `system: systemBlocks` (block array) instead of the string form
- [x] 2.4 Update `turn()` request body to pass `system: systemBlocks` (block array) instead of the string form

## 3. Conversation History Cache Breakpoint

- [x] 3.1 Identify the 5th-from-last `user` role message in the adapted messages array
- [x] 3.2 Upgrade that user message's `content` from string to a `TextBlock` array if it is not already in block form
- [x] 3.3 Append `cache_control: { type: "ephemeral" }` to the last content block of that user message

## 4. Tests

- [x] 4.1 Write unit tests for `adaptMessages()` verifying `systemBlocks` is an array and the last block carries `cache_control`
- [x] 4.2 Write unit tests verifying the conversation breakpoint is placed at the correct message for conversations shorter than and longer than 5 user messages
- [x] 4.3 Write a unit test verifying that a system with no messages produces a single-block `systemBlocks` array with `cache_control` on it

## 1. Return Type Extension

- [ ] 1.1 Add `AnthropicSystemBlock` type to `anthropic.ts` (`{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }`)
- [ ] 1.2 Update `adaptMessages()` return type to `{ system?: AnthropicSystemBlock[]; messages: AnthropicMessage[] }` (replaces `system?: string`)

## 2. System Prompt Cache Breakpoint

- [ ] 2.1 Build `systemBlocks` as `AnthropicSystemBlock[]` from the system prompt string inside `adaptMessages()`
- [ ] 2.2 Set `cache_control: { type: "ephemeral" }` on the last element of `systemBlocks`
- [ ] 2.3 Update `stream()` request body to pass `system: systemBlocks` (block array) instead of the string form
- [ ] 2.4 Update `turn()` request body to pass `system: systemBlocks` (block array) instead of the string form

## 3. Conversation History Cache Breakpoint

- [ ] 3.1 Identify the 5th-from-last `user` role message in the adapted messages array
- [ ] 3.2 Upgrade that user message's `content` from string to a `TextBlock` array if it is not already in block form
- [ ] 3.3 Append `cache_control: { type: "ephemeral" }` to the last content block of that user message

## 4. Tests

- [ ] 4.1 Write unit tests for `adaptMessages()` verifying `systemBlocks` is an array and the last block carries `cache_control`
- [ ] 4.2 Write unit tests verifying the conversation breakpoint is placed at the correct message for conversations shorter than and longer than 5 user messages
- [ ] 4.3 Write a unit test verifying that a system with no messages produces a single-block `systemBlocks` array with `cache_control` on it

## 1. Anthropic Provider Normalization

- [x] 1.1 Add `mergeConsecutiveSameRole(messages: AnthropicMessage[]): AnthropicMessage[]` helper in `anthropic.ts`: single scan, merges consecutive same-role entries (string+string content joined with `"\n\n"`; block arrays concatenated; assistant tool_calls arrays combined)
- [x] 1.2 Apply `mergeConsecutiveSameRole` as a post-processing pass at the end of `adaptMessages()`, just before the return statement
- [x] 1.3 Handle the mixed content case: when one user message has string content and the other has a content block array, normalize both to block arrays before concatenating

## 2. OpenAI-Compatible Provider Normalization

- [x] 2.1 Add `normalizeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[]` helper in `openai-compatible.ts`: merges consecutive same-role entries using string content concatenation
- [x] 2.2 Apply `normalizeMessages` in `stream()` before building the request body
- [x] 2.3 Apply `normalizeMessages` in `turn()` before building the request body

## 3. Engine Cleanup

- [x] 3.1 Remove or simplify the Qwen3-specific consecutive-user-message guard in `assembleMessages()` in `engine.ts` now that provider-level normalization covers this case for all providers

## 4. Tests

- [x] 4.1 Write unit tests for `mergeConsecutiveSameRole` (Anthropic): pair of user messages merged, pair of assistant messages merged, run of three merged, alternating messages unchanged, mixed content-type user merge
- [x] 4.2 Write unit tests for `normalizeMessages` (OpenAI-compatible): consecutive user messages merged, consecutive assistant messages merged, alternating unchanged
- [x] 4.3 Write an integration test verifying that an `assembleMessages()` output with injected consecutive user messages is correctly normalized before the wire request is built

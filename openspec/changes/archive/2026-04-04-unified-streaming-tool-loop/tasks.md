## 1. AIProvider Interface

- [x] 1.1 Add `StreamEvent` discriminated union type to `src/bun/ai/types.ts` (`token | tool_calls | done`)
- [x] 1.2 Add `stream(messages, options?)` signature to `AIProvider` interface in `src/bun/ai/types.ts`
- [x] 1.3 Remove `chat()` signature from `AIProvider` interface

## 2. OpenAI-Compatible Provider

- [x] 2.1 Implement `stream()` in `OpenAICompatibleProvider` (`src/bun/ai/openai-compatible.ts`): open SSE connection with `stream: true` and tool definitions
- [x] 2.2 Accumulate `delta.tool_calls` chunks across SSE events (index-keyed merge of `name` + `arguments` strings)
- [x] 2.3 On `finish_reason: "tool_calls"` yield `{ type: "tool_calls", calls: merged }` then `{ type: "done" }`
- [x] 2.4 On `finish_reason: "stop"` yield final `{ type: "done" }` (tokens already streamed)
- [x] 2.5 Remove the `chat()` method from `OpenAICompatibleProvider`

## 3. FakeAIProvider

- [x] 3.1 Define `FakeStep = { type: "tool_calls"; calls: AIToolCall[] } | { type: "text"; tokens: string[] }` in `src/bun/ai/fake.ts`
- [x] 3.2 Implement `stream()` in `FakeAIProvider` as an async generator that iterates the scripted step sequence, yielding `StreamEvent`s
- [x] 3.3 Remove the `turn()` and `chat()` methods from `FakeAIProvider`

## 4. Engine Tool Loop

- [x] 4.1 Rewrite the inner loop of `runExecution` in `src/bun/workflow/engine.ts` to use `provider.stream()` instead of `provider.turn()` + `provider.chat()`
- [x] 4.2 Ensure `onToken` is called for every `token` event and tokens are accumulated into `fullResponse`
- [x] 4.3 Ensure `tool_calls` events trigger tool execution and push results to `liveMessages` before the next stream iteration
- [x] 4.4 Ensure the loop exits on `done` with no pending tool calls (i.e., the last stream had no `tool_calls` event)
- [x] 4.5 Remove all calls to `provider.chat()` from `runExecution`

## 5. Cleanup

- [x] 5.1 Remove `chat()` from `AIProvider` interface if not already removed in task 1.3 (verify no remaining usages)
- [x] 5.2 Remove the `isBadAssistantResponse` guard for text tool-call blobs — unified streaming eliminates that failure mode (or keep as a safety net with a warning log, per team preference)

## 6. Tests

- [x] 6.1 Update `src/bun/test/engine.test.ts` to script `FakeAIProvider` using the new `FakeStep` format
- [x] 6.2 Add a test for a session that does tool calls in round 1 and returns text in round 2 (verifying no second top-level API call)
- [x] 6.3 Add a unit test for `OpenAICompatibleProvider.stream()` delta accumulation logic (partial `arguments` JSON merging)
- [x] 6.4 Run the full test suite and confirm all tests pass

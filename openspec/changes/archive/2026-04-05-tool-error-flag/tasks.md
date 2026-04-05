## 1. Types

- [x] 1.1 Add `isError?: boolean` field to the `AIMessage` interface in `types.ts`

## 2. Engine Detection

- [x] 2.1 After `executeTool()` returns in the engine's tool-call loop, check whether `llmContent.startsWith("Error:")` and set `isError: true` on the `AIMessage` pushed to `liveMessages`
- [x] 2.2 Apply the same detection to the `spawn_agent` tool path where the agent result string is assembled as `llmContent`

## 3. Provider Wire Format

- [x] 3.1 In `adaptMessages()` in `anthropic.ts`, when adapting a `tool_result` user message, include `is_error: true` on the tool result block when the source `AIMessage.isError` is `true`
- [x] 3.2 Verify that `toWireMessage()` in `openai-compatible.ts` does not propagate `isError` (OpenAI format has no equivalent field — confirm it is silently ignored and add a comment)

## 4. Tests

- [x] 4.1 Write unit tests for `adaptMessages()` with an error-flagged tool result message verifying the wire payload includes `is_error: true`
- [x] 4.2 Write a unit test verifying that non-error tool result messages do not carry `is_error`
- [x] 4.3 Write a unit test for the engine detection logic: a tool returning `"Error: ..."` sets `isError` on the resulting `AIMessage`

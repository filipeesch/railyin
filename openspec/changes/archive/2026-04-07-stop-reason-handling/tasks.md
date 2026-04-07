## 1. Types

- [x] 1.1 Add `stop_reason` to the `StreamEvent` union in `src/bun/ai/types.ts`: `{ type: "stop_reason"; reason: string }`
- [x] 1.2 Add optional `stopReason?: string` field to the `{ type: "text" }` variant of `AITurnResult` in `src/bun/ai/types.ts`

## 2. Anthropic Provider — stream()

- [x] 2.1 In `stream()` in `src/bun/ai/anthropic.ts`, detect when `message_delta` contains a non-standard `stop_reason` (not `end_turn`, `tool_use`, or `max_tokens`)
- [x] 2.2 When a non-standard stop reason is detected, yield `{ type: "stop_reason", reason }` before `{ type: "done" }`

## 3. Anthropic Provider — turn()

- [x] 3.1 In `turn()` in `src/bun/ai/anthropic.ts`, check the top-level `stop_reason` in the response JSON
- [x] 3.2 When the stop reason is non-standard, include `stopReason` in the returned `AITurnResult` text object

## 4. Engine — Stop Reason Handling

- [x] 4.1 In `src/bun/workflow/engine.ts`, handle `stop_reason` StreamEvent in the agentic loop stream consumer
- [x] 4.2 Branch on `reason === "refusal"`: log a warn, append a system message, and terminate the execution with an error (no nudge)
- [x] 4.3 Branch on `reason === "model_context_window_exceeded"`: trigger `compactConversation()` and retry the round
- [x] 4.4 Branch on unknown reasons: log a warn with the stop reason value and continue normally

## 5. Tests

- [x] 5.1 Add unit test: `stream()` yields `stop_reason` event when Anthropic returns `refusal`
- [x] 5.2 Add unit test: `stream()` yields `stop_reason` event when Anthropic returns `model_context_window_exceeded`
- [x] 5.3 Add unit test: `stream()` does NOT yield `stop_reason` event for `end_turn`
- [x] 5.4 Add unit test: `turn()` includes `stopReason` in result when API returns `refusal`

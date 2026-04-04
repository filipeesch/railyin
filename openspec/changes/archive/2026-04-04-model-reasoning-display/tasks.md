## 1. Stream Layer — reasoning event type

- [x] 1.1 Add `{ type: "reasoning"; content: string }` to the `StreamEvent` union in `src/bun/ai/types.ts`
- [x] 1.2 Add `isReasoning?: boolean` to the stream token RPC payload in `src/shared/rpc-types.ts`
- [x] 1.3 In `openai-compatible.ts` stream loop: detect `delta.reasoning_content`, yield `{ type: "reasoning", content }` events (parallel to the existing `delta.content` handling)

## 2. Engine — accumulate reasoning, persist to DB, fix nudge budget

- [x] 2.1 In the engine `mainLoop`: accumulate reasoning tokens per round into a `reasoningAccum` string and set a `hadReasoning` boolean flag when any `reasoning` event is received
- [x] 2.2 Forward reasoning tokens to the frontend via `onToken(taskId, executionId, content, false, true)` — pass `isReasoning: true` in the payload (requires updating `OnToken` signature and all callers in tests)
- [x] 2.3 At round end (before appending `tool_call` or `assistant` messages): if `reasoningAccum` is non-empty, call `appendMessage` with `type: "reasoning"` and clear `reasoningAccum` and `hadReasoning`
- [x] 2.4 In the empty-response check: if `hadReasoning` is true, reset `hadReasoning = false` and skip nudge increment (do not `continue` the loop — let the existing `break mainLoop` handle final state)
- [x] 2.5 In `compactMessages`: add `"reasoning"` to the exclusion list (alongside `system`, `transition_event`, etc.)

## 3. RPC — wire reasoning tokens to frontend

- [x] 3.1 Update `StreamTokenPayload` in `src/shared/rpc-types.ts` to include `isReasoning?: boolean`
- [x] 3.2 Update the `onToken` handler in `src/bun/handlers/tasks.ts` (or wherever it's defined) to pass through `isReasoning`
- [x] 3.3 Update `onStreamToken` subscriber in `src/mainview/App.vue` to pass `isReasoning` to `taskStore.onStreamToken`

## 4. Store — transient reasoning state

- [x] 4.1 In `src/mainview/stores/task.ts`: add `streamingReasoningToken: ref("")` and `isStreamingReasoning: ref(false)` to track live reasoning for the active streaming task
- [x] 4.2 Update `onStreamToken` in the store: when `isReasoning` is true, route the token to `streamingReasoningToken` and set `isStreamingReasoning = true`; when a regular token arrives while `isStreamingReasoning` is true, set `isStreamingReasoning = false` (auto-collapse)
- [x] 4.3 On `done`: clear `streamingReasoningToken` and `isStreamingReasoning`; also reset them in `onTaskUpdated` when a new execution starts; expose both via the store return

## 5. ReasoningBubble component

- [x] 5.1 Create `src/mainview/components/ReasoningBubble.vue` — collapsible card matching the tool call card visual pattern
- [x] 5.2 Props: `content: string`, `streaming: boolean`
- [x] 5.3 Header: when `streaming`, show pulsing animation + "Thinking…"; when done, show "Reasoning" label
- [x] 5.4 Body: scrollable container with `max-height: 320px` and `overflow-y: auto`; auto-expands when `streaming`, auto-collapses when `streaming` transitions to false
- [x] 5.5 Chevron toggle so user can manually expand/collapse at any time

## 6. Task detail drawer — wire up bubbles

- [x] 6.1 In `MessageBubble.vue`: add a branch for `type === "reasoning"` that renders `ReasoningBubble` with the DB message content (`streaming: false`)
- [x] 6.2 In `TaskDetailDrawer.vue`: render live streaming `ReasoningBubble` above the text streaming bubble when `streamingReasoningToken` is non-empty and `streamingTaskId === task.id`
- [x] 6.3 Use `key="live-reasoning"` for the live bubble and the existing `key="s-${msg.id}"` for persisted messages — no recreations on token arrival

## 7. Tests

- [x] 7.1 Update `src/bun/test/message-assembly.test.ts`: add a test that `compactMessages` excludes `reasoning` type messages
- [x] 7.2 Update engine tests in `src/bun/test/engine.test.ts` (if any touch `onToken` signature) to pass the new `isReasoning` parameter — no callers found, no changes needed
- [x] 7.3 Run full test suite and confirm 118 pass (117 + 1 new reasoning exclusion test)

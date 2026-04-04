## Context

The engine currently uses two separate AI provider methods:

- **`turn()`** — non-streaming, called in a loop for each tool-call round. Returns a structured `AITurnResult`: either a list of `tool_calls` or final text.
- **`chat()`** — streaming, called once after the tool loop exits to deliver the final answer progressively to the UI.

This split was introduced to get streaming tokens to the UI while still handling tool calls structurally. The problem: `chat()` is called without tools, so the model exits "tool mode". Some models nonetheless emit tool-call syntax as raw text in their final response (XML blobs, JSON fences), which are silently dropped — the user gets no output and the history gets poisoned.

The OpenAI streaming API supports *both* `delta.content` and `delta.tool_calls` in the same SSE stream, so the split is unnecessary. Every modern OpenAI-compatible endpoint supports this.

## Goals / Non-Goals

**Goals:**
- Replace `turn()` + `chat()` with a single `stream()` method on `AIProvider` that always passes tool definitions and handles both text tokens and structured tool calls in the same stream
- The engine tool loop uses `stream()` for every round — the final response is the text streamed when the model emits no tool calls
- `FakeAIProvider` implements the same interface for tests
- All existing tests pass unchanged

**Non-Goals:**
- Supporting providers that don't implement the streaming tool_calls SSE format (those continue to work by never emitting tool_calls chunks — the stream degrades to text-only, which is fine)
- Changing the conversation history schema, message types, or RPC interface
- Changing the sub-agent (`runSubExecution`) at this stage — it can be migrated in a follow-up

## Decisions

### D1 — Single `stream()` replaces both `turn()` and `chat()`

`stream()` accepts the same inputs as both (`messages`, `AICallOptions`) and yields typed events:

```ts
type StreamEvent =
  | { type: "token";      content: string }
  | { type: "tool_calls"; calls: AIToolCall[] }
  | { type: "done" }
```

The caller loops over events:
- `token` → forward to `onToken` (stream to UI)
- `tool_calls` → execute tools, extend `liveMessages`, continue the outer loop
- `done` → outer loop exits

**Alternative considered:** keep `turn()` for tool rounds, only add streaming to it. Rejected — it still requires a second `chat()` call for the final response, which reintroduces the problem.

### D2 — Accumulate tool_calls deltas across SSE chunks

The OpenAI streaming format sends `delta.tool_calls` as partial chunks (the `arguments` JSON string arrives in pieces). `stream()` must buffer and merge these before yielding a `tool_calls` event. Accumulation logic:

```
for each SSE chunk:
  if delta.content → yield token immediately
  if delta.tool_calls → merge into accumulator (index-keyed)
on finish_reason === "tool_calls" → yield { type: "tool_calls", calls: merged }
on finish_reason === "stop" → yield { type: "done" }
```

### D3 — Engine loop structure becomes symmetric

Before (two phases):
```
while hasToolCalls:
  turn() → tool_calls | text
  if text → break
execute tools
chat() → stream text  ← SECOND CALL, no tools
```

After (single phase):
```
while true:
  for await event of stream(liveMessages, { tools }):
    if token → forward to UI
    if tool_calls → execute, push to liveMessages, break inner loop
    if done → persist fullResponse, exit outer loop
```

The model naturally transitions from tool use to text without a mode switch.

### D4 — `turn()` retained for sub-agents only (short-term)

`runSubExecution` doesn't need streaming (results are collected as a string). Keeping `turn()` there avoids scope creep. It can be migrated later. Both `turn()` and `stream()` on `OpenAICompatibleProvider` share the same wire format — `turn()` just uses `stream: false`.

### D5 — `FakeAIProvider` yields scripted events

`FakeAIProvider.stream()` replaces both `turn()` + `chat()`. It reads from a scripted sequence of `FakeStep` objects:
```ts
type FakeStep =
  | { type: "tool_calls"; calls: AIToolCall[] }
  | { type: "text";       tokens: string[] }
```
This is simpler than the current dual-method fake.

## Risks / Trade-offs

- **Provider compatibility** — providers that don't support streaming tool_calls will send `finish_reason: "stop"` with only text content, never `"tool_calls"`. The engine treats this as a final response. Existing text-only providers continue to work. Providers that require `stream: false` for tool calls (rare, some local models) would break — mitigated by the `turn()` fallback kept for sub-agents.
- **Error surface during streaming** — with `turn()`, errors were atomic (the whole call failed). With streaming, an error mid-stream means partial tokens were already sent to the UI. The engine must handle mid-stream errors by noting what was streamed so far and surfacing an error message.
- **Slightly more complex `stream()` implementation** — the delta-accumulation logic for tool_calls is non-trivial. Well-tested with unit tests.

## Migration Plan

1. Add `stream()` to `AIProvider` interface — `turn()` and `chat()` remain (no breakage)
2. Implement `stream()` in `OpenAICompatibleProvider`
3. Update `FakeAIProvider` to implement `stream()`
4. Rewrite the `runExecution` tool loop to use `stream()`
5. Remove `chat()` from `AIProvider` and all implementations
6. Update tests
7. `turn()` stays for `runSubExecution` — remove in a follow-up PR

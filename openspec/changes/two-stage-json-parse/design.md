## Context

Anthropic's streaming API sends tool call `input` as a sequence of `input_json_delta` events. The `anthropic.ts` streaming parser accumulates these, then calls `JSON.parse(entry.inputJson)` to produce the `input` object for the assembled `AIToolCall`. In the non-streaming path, `turn()` calls `JSON.parse(tc.function.arguments)` (the Anthropic response `input` field is already parsed, wrapped with `JSON.stringify`, then re-parsed in the engine — effectively a no-op round-trip currently).

The double-encoding issue: Anthropic's streaming layer occasionally wraps the final JSON string in an outer string literal. `JSON.parse('"{\"a\":1}"')` returns the string `'{"a":1}'` rather than `{ a: 1 }`. The engine then passes this string as the tool `input`, and the tool receives a string where it expects an object. `JSON.parse` succeeds both times, so no exception is thrown — the failure is completely silent.

## Goals / Non-Goals

**Goals:**
- Detect and unwrap double-encoded JSON in tool call inputs from Anthropic streaming
- Log a warning when double-encoding is detected so we can monitor frequency
- Zero impact on correctly-encoded inputs — the happy path remains a single `JSON.parse()`

**Non-Goals:**
- Fixing the root cause in the provider (it's a server-side Anthropic behavior)
- Applying this to OpenAI-compatible providers — double-encoding is specific to Anthropic's streaming implementation
- Recursive unwrapping (two levels is the documented maximum; infinite recursion is out)

## Decisions

### D1: `safeParseJSON()` function — two-stage, log on second parse

```typescript
function safeParseJSON(raw: string, context: string): unknown {
  let result: unknown;
  try {
    result = JSON.parse(raw);
  } catch {
    log("warn", `safeParseJSON: initial parse failed for ${context}`, {});
    return {};
  }
  if (typeof result === "string") {
    log("warn", `safeParseJSON: double-encoded JSON detected for ${context}, trying second parse`, {});
    try {
      return JSON.parse(result);
    } catch {
      log("warn", `safeParseJSON: second parse also failed for ${context}, returning empty object`, {});
      return {};
    }
  }
  return result;
}
```

This function lives in `anthropic.ts` (file-private) since it's only needed there.

### D2: Applied at tool input finalisation in both streaming and non-streaming paths

- **Streaming**: `stream()` — when `message_stop` fires and tool calls are assembled, `entry.inputJson` is passed through `safeParseJSON(entry.inputJson, entry.name)` instead of `JSON.parse(entry.inputJson)`.
- **Non-streaming**: `turn()` — the response `block.input` from Anthropic is already an object from the JSON response body, so no parsing is needed there. The only `JSON.parse()` call in the Anthropic non-streaming path is in the `assistant` message `tool_calls` builder in `adaptMessages()` — that also uses `JSON.parse(tc.function.arguments)` but that input comes from our own `JSON.stringify(b.input)` call, so it can't be double-encoded. No change needed there.

## Risks / Trade-offs

- **Performance**: negligible — `typeof result === "string"` is a single type check; only the warning path calls `JSON.parse` twice.
- **Correctness on legitimate string inputs**: if a tool intentionally expects a JSON-encoded string as its sole argument (not an object), `safeParseJSON` would unwrap it. Reviewing our tool definitions: all tools expect objects (`type: "object"` parameters). No tool takes a bare string `input`. This edge case can't occur in practice.

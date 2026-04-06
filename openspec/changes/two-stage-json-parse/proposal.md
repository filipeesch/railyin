## Why

Anthropic's streaming API occasionally double-encodes tool call `input` JSON. The `input_json_delta` SSE events send the JSON incrementally as a string. After accumulation, `JSON.parse()` sometimes produces a string value (e.g. `'{"key":"val"}'`) rather than the expected object — meaning the JSON was wrapped in an outer string encoding. The current code silently accepts this: `JSON.parse('"{\"key\":\"val\"}"')` returns the string `'{"key":"val"}'`, which is then passed to the tool as its `input`. The tool receives a string where it expects an object, causing silent failures with no error in the conversation log.

## What Changes

- **`safeParseJSON()` helper**: a two-stage parser that:
  1. Calls `JSON.parse(raw)`.
  2. If the result is a string, calls `JSON.parse()` on that string again.
  3. Returns the final result, or `{}` with a warning log if both attempts fail.
- **Applied in `anthropic.ts`** at the point where accumulated `inputJson` is parsed for each tool use block — both in the streaming path (`stream()`) and the non-streaming path (`turn()`).
- **OpenAI-compatible provider**: not affected (tool arguments in OpenAI-compatible streaming arrive as a single JSON string fragment and are parsed correctly; double-encoding is an Anthropic streaming artifact).

## Capabilities

### New Capabilities

### Modified Capabilities

## Impact

- `src/bun/ai/anthropic.ts` — replace direct `JSON.parse(entry.inputJson)` (streaming) and `JSON.parse(tc.function.arguments)` (non-streaming) with `safeParseJSON()`; add `safeParseJSON()` helper function in same file or shared utility
- `src/bun/workflow/engine.ts` — no changes (tool parsing happens at the provider boundary)
- No DB, frontend, or type changes

## 1. Implementation

- [x] 1.1 Add `safeParseJSON(raw: string, context: string): unknown` helper to `anthropic.ts`: attempt `JSON.parse(raw)`; if the result is a string, attempt `JSON.parse(result)` and log a warning with `context`; return the final parsed value (or rethrow on unrecoverable parse failure)
- [x] 1.2 Replace `JSON.parse(entry.inputJson)` in the `stream()` tool-input finalization path in `anthropic.ts` with `safeParseJSON(entry.inputJson, entry.name)`
- [x] 1.3 Confirm that the `turn()` non-streaming path in `anthropic.ts` does not need `safeParseJSON` (Anthropic parses `block.input` into an object during JSON body deserialization — add a comment confirming this)

## 2. Tests

- [x] 2.1 Write unit tests for `safeParseJSON`: single-encoded JSON object (normal path), double-encoded JSON string (second-parse path), and malformed JSON (error path)
- [x] 2.2 Write an integration test that feeds a double-encoded tool input through the Anthropic `stream()` path and verifies the tool receives the correctly decoded arguments

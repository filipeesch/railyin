## Why

Our `adaptTools()` function sends tool schemas to Anthropic without `strict: true`, meaning the model can return incorrectly-typed arguments (e.g., `"2"` instead of `2`, missing required fields). We already compensate with defensive JSON parsing and XML-format nudges. Enabling strict mode eliminates the entire class of malformed tool-call bugs via grammar-constrained sampling — a cleaner fix than defensive retries.

## What Changes

- Add `strict?: boolean` to the `AnthropicTool` wire type
- Add `additionalProperties: false` to `AnthropicTool.input_schema`
- Set `strict: true` in `adaptTools()` for all tools sent to Anthropic
- Add `additionalProperties?: boolean` to `AIToolDefinition.parameters` so the internal type can carry the constraint
- All 26 tool definitions in `tools.ts` pick up strict mode automatically through `adaptTools()`

## Capabilities

### New Capabilities

- `strict-tool-use`: Grammar-constrained sampling on all Anthropic tool calls, guaranteeing that `input` fields match the declared JSON Schema exactly (correct types, no extra properties, all required fields present).

### Modified Capabilities

*(none — this is an implementation improvement; no spec-level behavior requirements change)*

## Impact

- `src/bun/ai/anthropic.ts` — `AnthropicTool` type and `adaptTools()` function
- `src/bun/ai/types.ts` — `AIToolDefinition.parameters` type (add `additionalProperties`)
- `src/bun/workflow/tools.ts` — all tool definitions gain `additionalProperties: false` in their parameter schemas
- No API-level breaking changes; strict mode is additive and silently accepted by all supported models

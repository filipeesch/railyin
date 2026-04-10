## 1. Update Wire Types

- [x] 1.1 Add `strict: true` field to `AnthropicTool` interface in `anthropic.ts`
- [x] 1.2 Add `additionalProperties?: boolean` to `AnthropicTool.input_schema` type

## 2. Update adaptTools()

- [x] 2.1 Set `strict: true` on every mapped tool in `adaptTools()`
- [x] 2.2 Add `additionalProperties: false` to every `input_schema` in `adaptTools()`

## 3. Tests

- [x] 3.1 Add unit test asserting `adaptTools()` sets `strict: true` on all output tools
- [x] 3.2 Add unit test asserting `adaptTools()` sets `additionalProperties: false` on all `input_schema` objects

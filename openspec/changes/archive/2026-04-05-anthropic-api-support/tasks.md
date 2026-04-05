## 1. Config: Multi-Provider Support

- [ ] 1.1 Update `AIProviderConfig` and `WorkspaceYaml` types in `src/bun/config/index.ts` to support a `providers:` array, where each entry has `id`, `type`, and type-specific fields (`base_url?`, `api_key?`, `context_window_tokens?`)
- [ ] 1.2 Implement auto-migration in config loader: if `workspace.yaml` has `ai:` and no `providers:`, wrap it into `providers: [{id: "default", ...ai fields}]` in-memory
- [ ] 1.3 If both `ai:` and `providers:` are present, use `providers:` and ignore `ai:`; log a warning
- [ ] 1.4 Detect duplicate provider `id` values on load, log a warning, and use only the first occurrence
- [ ] 1.5 Update `config/workspace.yaml` example and default template to use `providers:` format with commented-out examples for `anthropic`, `lmstudio`, and `openrouter`

## 2. Provider Registry and Resolution

- [ ] 2.1 Add `ProviderRegistry` to `src/bun/ai/index.ts`: a `Map<string, AIProvider>` keyed by provider `id`, instantiated lazily from the providers config list and cached for reuse
- [ ] 2.2 Implement `resolveProvider(qualifiedModel: string | null, providers: ProviderConfig[]): { provider: AIProvider; model: string }` — splits on first `/`, finds provider by `id`, returns provider instance and un-prefixed model string
- [ ] 2.3 Define and export `UnresolvableProviderError` (extends `Error`) thrown when provider id is not found or model is null/empty
- [ ] 2.4 Update `src/bun/workflow/engine.ts` to call `resolveProvider()` instead of `createProvider()` at execution start; pass config providers array
- [ ] 2.5 Catch `UnresolvableProviderError` in the engine: set task `execution_state` to `awaiting_user`, append a system message `"No provider configured for model '...'. Please select a model to continue."`, and return without crashing

## 3. AnthropicProvider Implementation

- [ ] 3.1 Create `src/bun/ai/anthropic.ts` with `AnthropicProvider` class implementing `AIProvider`. Constructor takes `apiKey: string`. Base URL hardcoded to `https://api.anthropic.com`.
- [ ] 3.2 Implement `adaptMessages(messages: AIMessage[]): { system: string | undefined; messages: AnthropicMessage[] }` — extracts system messages into top-level `system` field; maps `role: "tool"` to `role: "user"` with `content: [{type: "tool_result", tool_use_id, content}]`
- [ ] 3.3 Implement `adaptTools(tools: AIToolDefinition[]): AnthropicTool[]` — maps `parameters` → `input_schema`
- [ ] 3.4 Implement `turn(messages, options)`: POST to `/v1/messages` (non-streaming), map `content[].type === "tool_use"` → `AIToolCall[]` result, `content[].type === "text"` → text result
- [ ] 3.5 Implement `stream(messages, options)`: POST to `/v1/messages` with `stream: true`, parse Anthropic SSE events:
  - `content_block_delta` + `text_delta` → `{ type: "token" }`
  - `content_block_delta` + `thinking_delta` → `{ type: "reasoning" }`
  - `content_block_start` (tool_use) + `input_json_delta` → accumulate; emit `{ type: "tool_calls" }` on `message_stop`
  - `message_stop` → `{ type: "done" }`
- [ ] 3.6 Implement `listModels(): Promise<{id: string, contextWindow: number | null}[]>`: GET `/v1/models` with `x-api-key` header, map response to prefixed model list
- [ ] 3.7 Update `src/bun/ai/index.ts` `ProviderRegistry` to instantiate `AnthropicProvider` when `type === "anthropic"`

## 4. models.list RPC: Multi-Provider Aggregation

- [ ] 4.1 Update `models.list` handler in `src/bun/handlers/tasks.ts` to iterate over all configured providers via `Promise.allSettled`, calling each provider's model discovery logic
- [ ] 4.2 Add model discovery method/function per provider type: Anthropic uses `AnthropicProvider.listModels()`; OpenAI-compatible providers use existing LM Studio native API + `/v1/models` fallback logic, now as a standalone function
- [ ] 4.3 Prefix each model's `id` with the provider's `id` (e.g., `anthropic/claude-opus-4-5`) before merging
- [ ] 4.4 Sort the merged list: primary sort by provider `id`, secondary sort by model `id`
- [ ] 4.5 Return empty array (no throw) when all providers fail; skip failed providers silently

## 5. Integration Tests

- [ ] 5.1 Create `src/bun/test/providers.test.ts` — test `resolveProvider` correctly identifies and returns the right provider + un-prefixed model for various qualified model strings
- [ ] 5.2 Test `resolveProvider` throws `UnresolvableProviderError` for unknown provider prefix, null model, and empty string
- [ ] 5.3 Create a local HTTP mock server in the test (using `Bun.serve`) to simulate Anthropic SSE streaming; test `AnthropicProvider.stream()` yields correct `StreamEvent` sequence for a text-only response
- [ ] 5.4 Test `AnthropicProvider.stream()` with a tool-call response: mock Anthropic SSE emitting `content_block_start` (tool_use) + `input_json_delta` events; assert a single `{ type: "tool_calls" }` event is yielded
- [ ] 5.5 Test `AnthropicProvider.stream()` with extended thinking: mock `thinking_delta` events; assert `{ type: "reasoning" }` events are yielded before text tokens
- [ ] 5.6 Test `AnthropicProvider.turn()` with a mock non-streaming Anthropic response containing a `tool_use` block; assert correct `AITurnResult`
- [ ] 5.7 Test system message extraction: assert `adaptMessages` moves system messages to `system` field and omits them from the messages array
- [ ] 5.8 Test tool result mapping: assert `adaptMessages` converts `role: "tool"` messages to `role: "user"` with `tool_result` content block
- [ ] 5.9 Test `models.list` handler with two mock providers: one Anthropic (mock `/v1/models`), one LM Studio (mock native API); assert results are merged, prefixed, and sorted
- [ ] 5.10 Write engine integration test (in `engine.test.ts`) using `setupTestConfig` with a multi-provider config: assert that a task with `model: null` ends up with `execution_state: "awaiting_user"` and a system message explaining the issue
- [ ] 5.11 Write engine integration test: task with `model: "unknownprovider/some-model"` → `execution_state: "awaiting_user"`

## 6. Update Existing Tests and Helpers

- [ ] 6.1 Update `setupTestConfig` in `src/bun/test/helpers.ts` to write the new `providers:` format in the test workspace YAML (keep using `type: fake`)
- [ ] 6.2 Verify all existing tests in `engine.test.ts`, `tools.test.ts`, `message-assembly.test.ts`, etc. still pass with the new config shape; fix any breakage
- [ ] 6.3 Update `src/bun/test/handlers.test.ts` `models.list` handler tests to reflect multi-provider aggregation behavior

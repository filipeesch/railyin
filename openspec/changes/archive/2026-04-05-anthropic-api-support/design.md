## Context

The app currently has a single `AIProvider` abstraction with two concrete implementations: `OpenAICompatibleProvider` (handles OpenRouter, LM Studio, Ollama, etc.) and `FakeAIProvider` (for tests). A `createProvider(config)` factory selects one at startup. The config is a flat `ai:` block in `workspace.yaml` with a single `base_url`, `api_key`, and optional `model`.

Anthropic's `/v1/messages` API is materially different from OpenAI's `/v1/chat/completions`:
- Auth header: `x-api-key` + `anthropic-version` instead of `Authorization: Bearer`
- System messages: extracted into a top-level `system` field, not a message in the array
- Tool results: sent as `user` messages with `content: [{type: "tool_result"}]` not `role: "tool"`
- Streaming: uses SSE events `content_block_start`, `content_block_delta`, `message_delta` instead of `choices[0].delta`
- Extended thinking: `thinking_delta` events → maps to existing `{ type: "reasoning" }` stream event

The `compactMessages()` function in `engine.ts` currently assembles an OpenAI-format message array. It will need to remain format-agnostic (producing `AIMessage[]`) since each provider receives the same internal type and adapts it to their own wire format.

## Goals / Non-Goals

**Goals:**
- Support multiple providers configured simultaneously in `workspace.yaml`
- Implement `AnthropicProvider` with native Anthropic API (including streaming tool calls and extended thinking)
- Fully-qualified model IDs (`providerId/modelId`) across config, task DB, workflow YAML
- `models.list` RPC aggregates models from all configured providers
- Tasks with unresolvable provider fall back to `awaiting_user` instead of crashing
- Backward compatibility: old single `ai:` block auto-migrates on load
- Integration tests covering real provider resolution, Anthropic wire format, model aggregation, and awaiting_user fallback

**Non-Goals:**
- UI changes for extended thinking display (existing `ReasoningBubble` already handles it)
- Parallel provider calls (one model per task execution)
- Provider-specific UI configuration
- Anthropic prompt caching (can be added later)
- Streaming progress for `models.list` (synchronous aggregation is fine)

## Decisions

### Decision 1: `providers:` list replaces `ai:` block in config

**Chosen:** YAML shape changes from a single `ai:` object to a `providers:` array. Each entry has `id`, `type`, and type-specific fields.

```yaml
providers:
  - id: anthropic
    type: anthropic
    api_key: sk-ant-...

  - id: lmstudio
    type: lmstudio             # synonym for openai-compatible
    base_url: http://localhost:1234/
    api_key: ""
```

**Alternative considered:** Keep `ai:` as the primary provider + add `extra_providers:` list. Rejected — creates two code paths for the same thing.

**Backward compat:** On config load, if `ai:` exists and `providers:` does not, auto-wrap into `providers: [{id: "default", type: ..., ...ai fields}]`. No filesystem migration required.

### Decision 2: Fully-qualified model IDs — `{providerId}/{modelId}`

**Chosen:** The provider prefix is the same as the `id` field in the providers list. Examples: `anthropic/claude-3-5-sonnet-20241022`, `lmstudio/qwen3-8b`, `openrouter/meta-llama/llama-3-70b-instruct`.

Resolution: split on the first `/` to get `providerId`, then find the matching provider in the list. The remainder (after first `/`) is passed to the API as the model name.

**Alternative considered:** Separate `provider` + `model` fields on tasks. Rejected — requires DB column addition and more complex UI. A prefixed string is simpler and already has precedent (OpenRouter does this).

**No DB migration:** Existing tasks with unprefixed model strings (e.g., `qwen3-8b`) will fail resolution and move to `awaiting_user`. Users re-select the model from the dropdown. This is acceptable for the current user base.

### Decision 3: `resolveProvider(qualifiedModel, providers)` replaces `createProvider(config)`

**Chosen:** A new `resolveProvider` function takes the task's qualified model string and the providers array, finds the right provider instance (cached), and returns an `{ provider: AIProvider, model: string }` tuple where `model` is the un-prefixed model ID ready to pass to the API.

Provider instances are cached in a `Map<string, AIProvider>` keyed by provider `id` to avoid re-instantiation per execution.

**If resolution fails:** The engine catches the `UnresolvableProviderError` and sets the task status to `awaiting_user` (same status used when the user must supply input). A system message is appended to the conversation explaining the issue.

### Decision 4: `AnthropicProvider` does format adaptation internally

**Chosen:** `AnthropicProvider` implements the same `AIProvider` interface (`stream()` and `turn()`). Internally it:
1. Extracts system messages from the `AIMessage[]` array into the top-level `system` field
2. Re-maps `role: "tool"` messages to `role: "user"` with `content: [{type: "tool_result", ...}]`
3. Maps `thinking_delta` SSE events → `{ type: "reasoning" }` stream events (reusing existing `ReasoningBubble` display)
4. Maps `input_json_delta` SSE events → accumulates tool call arguments
5. Sends `x-api-key` + `anthropic-version: 2023-06-01` headers

`compactMessages()` continues to produce `AIMessage[]` in OpenAI format — the adaptation happens inside `AnthropicProvider`, not in the engine. This keeps the engine and message-assembly code provider-agnostic.

### Decision 5: `models.list` RPC fans out to all providers in parallel

**Chosen:** The handler fires `Promise.allSettled` across all configured providers, each fetching their own model list with their own discovery logic (LM Studio native API, Anthropic `/v1/models`, standard `/v1/models`). Results are merged, each model ID prefixed with the provider's `id`. Failures from individual providers are silently skipped (same behavior as today for a single failed provider).

**Model list shape:** Same as current — `{ id: string, contextWindow: number | null }[]`. The `id` is now fully-qualified.

### Decision 6: Integration tests use real HTTP mocking, not just FakeAIProvider

A new test file (`src/bun/test/providers.test.ts`) tests:
- `resolveProvider` correctly selects the right provider
- `AnthropicProvider.stream()` correctly maps Anthropic SSE events to internal stream events (using a local HTTP mock server)
- `AnthropicProvider.turn()` correctly maps non-streaming Anthropic response
- `models.list` handler aggregates from multiple providers
- Engine sets task to `awaiting_user` when model is unresolvable
- Engine sets task to `awaiting_user` when model is `null`

The existing `engine.test.ts` continues to use `FakeAIProvider`.

## Risks / Trade-offs

- **[Risk] Existing tasks break on first run** → Mitigation: on resolution failure the task goes to `awaiting_user` with a clear message, not a hard error. User re-selects model from the now-richer dropdown.
- **[Risk] Anthropic SSE format changes** → Mitigation: version-pinned via `anthropic-version: 2023-06-01` header; upgrade is a single provider class change.
- **[Risk] Provider instance cache invalidated by config reload** → Mitigation: config reload (already a concern today) clears the provider cache; simple to implement alongside the `resetConfig()` call.
- **[Risk] `models.list` fan-out is slow when many providers configured** → `Promise.allSettled` runs all in parallel; individual provider timeouts are bounded by the existing `fetch` timeout behavior.
- **[Trade-off] OpenRouter model IDs already have slashes** (e.g., `meta-llama/llama-3-70b-instruct`) → The `openrouter/` prefix adds another slash level: `openrouter/meta-llama/llama-3-70b-instruct`. Resolution splits on first `/` only, so this works correctly. The model name passed to the API is `meta-llama/llama-3-70b-instruct` as OpenRouter expects.

## Migration Plan

1. Deploy: config auto-migration on load means no user action needed for existing single-provider setups.
2. Users with existing tasks: tasks move to `awaiting_user` on first execution attempt with an unresolvable model. They re-select from the dropdown once.
3. Rollback: revert to old config shape; old code reads `ai:` block and ignores `providers:`. Since tasks' `model` field is just a string, old code will simply not find a model if it's qualified — tasks fail — but nothing is corrupted.

## Open Questions

- Should the model dropdown in the UI group models visually by provider, or remain flat? (Currently decided: flat, sorted by provider id then model id — simple first pass.)
- Should `AnthropicProvider` support prompt caching headers for long system prompts? (Out of scope for now.)

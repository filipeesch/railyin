## MODIFIED Requirements

### Requirement: AI provider uses OpenAI-compatible chat completions format
The system SHALL communicate with OpenAI-compatible providers using the OpenAI chat completions API format (`POST /v1/chat/completions`). The provider endpoint is configured per-provider entry in the `providers:` list, each with `base_url`, `api_key`, and optional `model`. A new `AnthropicProvider` communicates with Anthropic's native `/v1/messages` API instead. The `createProvider(config)` factory is replaced by `resolveProvider(qualifiedModel, providers)` which selects the correct provider instance from the configured list. Both providers SHALL throw `ProviderError` (with a numeric `status` field and optional `retryAfter`) for any non-2xx HTTP response instead of a plain `Error`.

#### Scenario: OpenRouter configured as provider
- **WHEN** `workspace.yaml` has a provider entry with `type: openrouter` and `base_url: https://openrouter.ai/api/v1` with a valid API key
- **THEN** all AI calls for models prefixed `openrouter/` are sent to OpenRouter using the OpenAI format

#### Scenario: Ollama used as local provider
- **WHEN** `workspace.yaml` has a provider entry with `type: openai-compatible` and `base_url: http://localhost:11434/v1` with no API key
- **THEN** all AI calls for models prefixed with that provider's `id` are sent to the local Ollama instance with no authentication header

#### Scenario: Anthropic configured as provider
- **WHEN** `workspace.yaml` has a provider entry with `type: anthropic` and a valid `api_key`
- **THEN** all AI calls for models prefixed `anthropic/` are sent to `https://api.anthropic.com/v1/messages`

#### Scenario: Provider throws ProviderError on non-2xx response
- **WHEN** the upstream API returns a non-2xx HTTP status (e.g., 429, 529, 500)
- **THEN** the provider throws `ProviderError` with the numeric `status` and optional `retryAfter` parsed from the `retry-after` response header; never a plain `Error`

### Requirement: AI responses are streamed and appended in real time
The system SHALL use server-sent events (SSE) streaming for AI responses. Tokens SHALL be appended to the conversation timeline as they arrive, providing real-time feedback in the task detail view. Streaming SHALL also handle structured tool call deltas in the same SSE stream — the engine does not require a separate non-streaming call for tool rounds. The engine SHALL call `retryStream()` rather than `provider.stream()` directly, so retry and watchdog protection is applied automatically. When streaming repeatedly fails and non-streaming fallback is active, the frontend SHALL surface ephemeral status messages during the wait and clear them when the response arrives.

#### Scenario: Tokens appear incrementally in task chat
- **WHEN** an execution is running and the AI is responding
- **THEN** the task detail view shows each token as it arrives without waiting for the full response

#### Scenario: Stream error triggers retry, then fallback, then failure
- **WHEN** the SSE stream drops or returns a retryable error before completion
- **THEN** `retryStream()` retries up to `maxStreamRetries` times, falls back to non-streaming if exhausted, and only sets the task to `failed` if both retry loops are exhausted; any tokens already streamed before the first failure are discarded and re-streamed from the retried call

#### Scenario: Non-retryable stream error marks execution as failed
- **WHEN** the SSE stream returns a non-retryable HTTP status (e.g., 400, 401, 403)
- **THEN** the execution state is set to `failed`, any tokens already streamed are retained in the conversation, and a system message records the error

#### Scenario: Tool call deltas are accumulated across SSE chunks
- **WHEN** the SSE stream contains `delta.tool_calls` chunks with partial `arguments` JSON
- **THEN** the provider accumulates all chunks for each tool call index and yields a single `tool_calls` event only after `finish_reason` is received

### Requirement: Non-streaming turn is used for tool-call rounds
The system SHALL use a non-streaming request for each tool-call round and switch to streaming only for the final text response to the user. The engine SHALL call `retryTurn()` rather than `provider.turn()` directly for all non-streaming rounds, so the same exponential-backoff retry logic applies.

#### Scenario: Tool rounds are non-streaming
- **WHEN** the model issues a tool call
- **THEN** the system awaits the full response via `retryTurn()` before executing tools and looping

#### Scenario: Final response is streamed
- **WHEN** the model produces its final text answer after tool rounds
- **THEN** tokens are streamed to the frontend via `retryStream()` as usual

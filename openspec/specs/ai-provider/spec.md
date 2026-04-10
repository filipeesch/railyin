## Purpose
The AI provider abstraction decouples execution logic from any specific AI backend. Multiple named providers can be configured simultaneously via `workspace.yaml`. Tool calling allows the model to read project files during execution.

## Requirements

### Requirement: AI provider uses OpenAI-compatible chat completions format
The system SHALL communicate with OpenAI-compatible providers using the OpenAI chat completions API format (`POST /v1/chat/completions`). The provider endpoint is configured per-provider entry in the `providers:` list, each with `base_url`, `api_key`, optional `model`, and optional `provider_args`. A new `AnthropicProvider` communicates with Anthropic's native `/v1/messages` API instead. The `createProvider(config)` factory is replaced by `resolveProvider(qualifiedModel, providers)` which selects the correct provider instance from the configured list. Both providers SHALL throw `ProviderError` (with a numeric `status` field and optional `retryAfter`) for any non-2xx HTTP response instead of a plain `Error`. When `provider_args` is set on a provider entry, `OpenAICompatibleProvider` SHALL merge it as the `provider` key in every request body; `AnthropicProvider` SHALL ignore it.

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

#### Scenario: OpenRouter provider_args routing preferences applied
- **WHEN** `workspace.yaml` has a provider entry with `type: openrouter` and `provider_args: { ignore: ["google-vertex", "azure"] }`
- **THEN** every request to OpenRouter includes `"provider": { "ignore": ["google-vertex", "azure"] }` in the body, preventing routing to those backends

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

### Requirement: AI provider abstraction supports multiple named providers simultaneously
The system SHALL maintain a registry of named `AIProvider` instances, one per configured provider entry. Provider instances SHALL be cached and reused across executions. The registry is keyed by provider `id`. `resolveProvider(qualifiedModel)` returns `{ provider: AIProvider, model: string }` where `model` is the un-prefixed model ID.

#### Scenario: Provider resolved from qualified model string
- **WHEN** a task has `model: "anthropic/claude-3-5-sonnet-20241022"`
- **THEN** `resolveProvider` returns the `AnthropicProvider` instance and model string `claude-3-5-sonnet-20241022`

#### Scenario: Unknown provider prefix causes resolution failure
- **WHEN** a task has `model: "unknownprovider/some-model"` and no provider with `id: "unknownprovider"` is configured
- **THEN** `resolveProvider` throws `UnresolvableProviderError`

#### Scenario: Null or missing model causes resolution failure
- **WHEN** a task has `model: null`
- **THEN** `resolveProvider` throws `UnresolvableProviderError`

### Requirement: AI call assembles full execution context with provider-agnostic messages
The system SHALL continue to assemble `AIMessage[]` in the internal OpenAI-like format inside `compactMessages()` and `assembleMessages()`. Each `AIProvider` concrete implementation is responsible for adapting that format to its own wire format. The engine and message-assembly code SHALL have no provider-specific branching.

#### Scenario: Engine passes same AIMessage[] regardless of provider type
- **WHEN** the engine calls `provider.stream(messages, options)`
- **THEN** `messages` is always the internal `AIMessage[]` format and the provider handles any required wire format transformation

### Requirement: Task moves to awaiting_user when model cannot be resolved
The system SHALL catch `UnresolvableProviderError` in the workflow engine and set the task status to `awaiting_user`. A system message SHALL be appended to the task's conversation explaining that the user must select a valid model from the dropdown before execution can proceed.

#### Scenario: Unresolvable model triggers awaiting_user status
- **WHEN** the engine attempts to execute a task with a model prefix that matches no configured provider
- **THEN** the task status is set to `awaiting_user` and a system message is appended: "No provider found for model '...'. Please select a model to continue."

#### Scenario: Null model triggers awaiting_user status
- **WHEN** the engine attempts to execute a task with `model: null`
- **THEN** the task status is set to `awaiting_user` and a system message is appended prompting the user to select a model

### Requirement: models.list RPC aggregates models from all configured providers
The system SHALL fan out `models.list` to all configured providers in parallel using `Promise.allSettled`. Each provider's model IDs SHALL be prefixed with its `id`. Failures from individual providers SHALL be silently skipped. The result is a flat list sorted by provider id then model id.

#### Scenario: Models from multiple providers merged in flat list
- **WHEN** two providers are configured and both respond to their model list endpoints
- **THEN** `models.list` returns a flat array with models from both, each prefixed with their provider's id

#### Scenario: Failed provider skipped without error
- **WHEN** one provider's model list endpoint returns an error or times out
- **THEN** `models.list` still returns models from the remaining providers without throwing

#### Scenario: Empty list when all providers fail
- **WHEN** all configured providers fail to return a model list
- **THEN** `models.list` returns an empty array

### Requirement: AI model can read project files via tool calling
The system SHALL provide the AI model with tools to read files, list directories, and run read-only shell commands in the task's git worktree. Tool calls are executed server-side and results are fed back into the conversation context.

#### Scenario: Model lists project files
- **WHEN** the model calls `list_dir` with a path relative to the worktree root
- **THEN** the system returns the directory listing and appends both the tool call and result to the conversation

#### Scenario: Model reads a source file
- **WHEN** the model calls `read_file` with a valid relative path
- **THEN** the file contents are returned (up to 500 KB); larger files return an error suggesting `grep`/`head`

#### Scenario: Model runs a read-only command
- **WHEN** the model calls `run_command` with a command such as `git diff` or `grep -r ...`
- **THEN** the command runs in the worktree directory and stdout (up to 8 KB) is returned

#### Scenario: Destructive commands are blocked
- **WHEN** the model calls `run_command` with a write or destructive command (e.g., `rm`, `git push`, `mv`)
- **THEN** the system returns an error without executing the command

#### Scenario: Tools are only available when worktree is ready
- **WHEN** a task does not have a worktree in `ready` status
- **THEN** no tools are offered to the model during execution

#### Scenario: Tool call loop is bounded
- **WHEN** the model issues tool calls repeatedly
- **THEN** the loop terminates after 10 rounds and the model is instructed to summarise its findings

### Requirement: Non-streaming turn is used for tool-call rounds
The system SHALL use a non-streaming request for each tool-call round and switch to streaming only for the final text response to the user. The engine SHALL call `retryTurn()` rather than `provider.turn()` directly for all non-streaming rounds, so the same exponential-backoff retry logic applies.

#### Scenario: Tool rounds are non-streaming
- **WHEN** the model issues a tool call
- **THEN** the system awaits the full response via `retryTurn()` before executing tools and looping

#### Scenario: Final response is streamed
- **WHEN** the model produces its final text answer after tool rounds
- **THEN** tokens are streamed to the frontend via `retryStream()` as usual

### Requirement: Anthropic provider sends system content as structured blocks with cache hints
The system SHALL send the Anthropic `system` field as a `ContentBlock[]` array rather than a plain string when prompt caching is enabled. Each block contains `{ type: "text", text: string, cache_control?: { type: "ephemeral" } }`. The last block always carries the cache breakpoint marker.

#### Scenario: System content block array accepted by Anthropic API
- **WHEN** `adaptMessages()` is called for an Anthropic API call with system messages present
- **THEN** the request body contains `system: [{ type: "text", text: "...", cache_control: { type: "ephemeral" } }]` as an array rather than `system: "..."`

#### Scenario: Anthropic non-streaming turn also sends system block array
- **WHEN** `provider.turn()` is called for a compaction or sub-agent call using AnthropicProvider
- **THEN** the same block array form is used for the `system` field, consistent with streaming calls

### Requirement: AI provider exposes a unified streaming method
The system SHALL provide an `AIProvider.stream()` method that accepts messages and tool definitions and yields typed stream events covering both text tokens and structured tool calls in a single call. The separate `chat()` method SHALL be removed.

#### Scenario: Model returns text in a single stream
- **WHEN** `stream()` is called and the model produces a text response with no tool calls
- **THEN** the stream yields one or more `token` events followed by a `done` event

#### Scenario: Model returns tool calls in a single stream
- **WHEN** `stream()` is called with tools and the model decides to call one or more tools
- **THEN** the stream yields a single `tool_calls` event containing all calls, then a `done` event; no `token` events are emitted for that round

#### Scenario: stream() always receives tool definitions
- **WHEN** `stream()` is called during any round of the tool loop, including the final round
- **THEN** tool definitions are included in the request so the model is never switched out of tool-aware mode

### Requirement: Engine tool loop uses unified stream for every round
The system SHALL drive the entire execution — tool rounds and final text response — from a single `stream()` call per round. The engine SHALL NOT make a separate second call to retrieve the final answer.

#### Scenario: Final response arrives in first stream with no tool calls
- **WHEN** the model produces a text response without calling any tools
- **THEN** that text is the final response, streamed live to the UI; no second call is made

#### Scenario: Tool call followed by final text in same session
- **WHEN** the model calls a tool in round N and then produces text in round N+1
- **THEN** the text from round N+1 is the final response, streamed live; total API calls equal number of rounds

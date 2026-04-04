## Purpose
The AI provider abstraction decouples execution logic from any specific AI backend. Any OpenAI-compatible endpoint can be used. Tool calling allows the model to read project files during execution.

## Requirements

### Requirement: AI provider uses OpenAI-compatible chat completions format
The system SHALL communicate with AI providers using the OpenAI chat completions API format (`POST /v1/chat/completions`). The provider endpoint is configured via `base_url`, `api_key`, and `model` in `workspace.yaml`.

#### Scenario: OpenRouter configured as provider
- **WHEN** `workspace.yaml` specifies `base_url: https://openrouter.ai/api/v1` with a valid API key and model
- **THEN** all AI calls are sent to OpenRouter using the OpenAI format

#### Scenario: Ollama used as local provider
- **WHEN** `workspace.yaml` specifies `base_url: http://localhost:11434/v1` with no API key
- **THEN** all AI calls are sent to the local Ollama instance with no authentication header

#### Scenario: LM Studio used as local provider
- **WHEN** `workspace.yaml` specifies `base_url: http://localhost:1234/v1`
- **THEN** all AI calls are sent to LM Studio using the same OpenAI-compatible format

### Requirement: AI responses are streamed and appended in real time
The system SHALL use server-sent events (SSE) streaming for AI responses. Tokens SHALL be appended to the conversation timeline as they arrive, providing real-time feedback in the task detail view. Streaming SHALL also handle structured tool call deltas in the same SSE stream — the engine does not require a separate non-streaming call for tool rounds.

#### Scenario: Tokens appear incrementally in task chat
- **WHEN** an execution is running and the AI is responding
- **THEN** the task detail view shows each token as it arrives without waiting for the full response

#### Scenario: Stream error marks execution as failed
- **WHEN** the SSE stream drops or returns an error before completion
- **THEN** the execution state is set to `failed`, any tokens already streamed are retained in the conversation, and a system message records the error

#### Scenario: Tool call deltas are accumulated across SSE chunks
- **WHEN** the SSE stream contains `delta.tool_calls` chunks with partial `arguments` JSON
- **THEN** the provider accumulates all chunks for each tool call index and yields a single `tool_calls` event only after `finish_reason` is received

### Requirement: AI provider abstraction supports future non-OpenAI providers
The system SHALL implement AI calls through an `AIProvider` interface with a single `stream()` method. The OpenAI-compatible implementation is the only concrete provider required for MVP.

#### Scenario: Provider interface is encapsulated
- **WHEN** the AI provider configuration changes
- **THEN** only the provider configuration and concrete implementation need updating — no changes to execution, conversation, or workflow engine code

#### Scenario: Provider that does not support streaming tool calls degrades gracefully
- **WHEN** a provider's SSE stream never emits `delta.tool_calls` chunks and responds with `finish_reason: "stop"`
- **THEN** the engine treats the response as a text-only final answer; tool calling still works if the provider supports it via its own SSE format

### Requirement: AI call assembles full execution context as messages
The system SHALL assemble the AI request payload from structured task, board, project, workflow, worktree, and execution metadata. This payload is formatted as a series of messages including system context, conversation history, and the triggering prompt.

#### Scenario: Execution payload includes task and project context
- **WHEN** an on_enter_prompt is triggered
- **THEN** the assembled messages include task title, description, project path, git root, branch name, worktree path, and current workflow transition metadata

#### Scenario: Empty api_key is sent without Authorization header
- **WHEN** `api_key` is empty or absent in configuration
- **THEN** the HTTP request is made without an `Authorization` header (for local providers that do not require auth)

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
The system SHALL use a non-streaming request for each tool-call round and switch to streaming only for the final text response to the user.

#### Scenario: Tool rounds are non-streaming
- **WHEN** the model issues a tool call
- **THEN** the system awaits the full response before executing tools and looping

#### Scenario: Final response is streamed
- **WHEN** the model produces its final text answer after tool rounds
- **THEN** tokens are streamed to the frontend as usual

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

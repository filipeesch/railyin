## ADDED Requirements

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
The system SHALL use server-sent events (SSE) streaming for AI responses. Tokens SHALL be appended to the conversation timeline as they arrive, providing real-time feedback in the task detail view.

#### Scenario: Tokens appear incrementally in task chat
- **WHEN** an execution is running and the AI is responding
- **THEN** the task detail view shows each token as it arrives without waiting for the full response

#### Scenario: Stream error marks execution as failed
- **WHEN** the SSE stream drops or returns an error before completion
- **THEN** the execution state is set to `failed`, the partial response up to that point is retained in the conversation, and a system message records the error

### Requirement: AI provider abstraction supports future non-OpenAI providers
The system SHALL implement AI calls through an `AIProvider` interface that accepts messages and returns an async iterable of tokens. The OpenAI-compatible implementation is the only concrete provider required for MVP.

#### Scenario: Provider interface is encapsulated
- **WHEN** the AI provider configuration changes
- **THEN** only the provider configuration and concrete implementation need updating — no changes to execution, conversation, or workflow engine code

### Requirement: AI call assembles full execution context as messages
The system SHALL assemble the AI request payload from structured task, board, project, workflow, worktree, and execution metadata. This payload is formatted as a series of messages including system context, conversation history, and the triggering prompt.

#### Scenario: Execution payload includes task and project context
- **WHEN** an on_enter_prompt is triggered
- **THEN** the assembled messages include task title, description, project path, git root, branch name, worktree path, and current workflow transition metadata

#### Scenario: Empty api_key is sent without Authorization header
- **WHEN** `api_key` is empty or absent in configuration
- **THEN** the HTTP request is made without an `Authorization` header (for local providers that do not require auth)

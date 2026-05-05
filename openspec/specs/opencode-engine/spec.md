## Purpose
Defines the OpenCodeEngine implementation that wraps the `@opencode-ai/sdk` as an `ExecutionEngine`. Manages server lifecycle, session mapping, event translation, MCP tool injection, multi-provider config, attachment mapping, model listing, skills-as-commands, compaction, and graceful shutdown for the `opencode` engine type.

## Requirements

### Requirement: OpenCodeEngine wraps the OpenCode SDK as an ExecutionEngine

The system SHALL implement `OpenCodeEngine` conforming to the `ExecutionEngine` interface. It SHALL use `@opencode-ai/sdk` to manage a persistent HTTP server process, create and resume OpenCode sessions per conversation, translate SSE events to `EngineEvent` types, and manage execution lifecycle.

#### Scenario: OpenCodeEngine instantiates from config

- **WHEN** `workspace.yaml` has `engine.type: opencode`
- **THEN** an `OpenCodeEngine` instance is created and a shared `@opencode-ai/sdk` server process is started (or reused if already running)

#### Scenario: execute() creates an OpenCode session for a new conversation

- **WHEN** `OpenCodeEngine.execute(params)` is called with a `conversationId` not previously seen
- **THEN** a new OpenCode session is created with the `workingDirectory` as the session directory, and the session ID is stored under `conversationId`

#### Scenario: execute() resumes an existing OpenCode session for a known conversation

- **WHEN** `OpenCodeEngine.execute(params)` is called with a `conversationId` that already has a session
- **THEN** the existing OpenCode session is reused, preserving conversation history

#### Scenario: cancel() aborts an in-flight execution

- **WHEN** `OpenCodeEngine.cancel(executionId)` is called during an active execution
- **THEN** the execution's `AbortSignal` is triggered and the SSE stream stops yielding events

### Requirement: One OpenCode server process shared across all workspaces

The system SHALL start at most one `@opencode-ai/sdk` server process per Railyin instance. All workspace directories SHALL be routed to this server via the `directory` query parameter on every API call.

#### Scenario: First workspace triggers server startup

- **WHEN** the first `OpenCodeEngine.execute()` call is made across any workspace
- **THEN** a single OpenCode server process is started and its URL is stored for reuse

#### Scenario: Second workspace reuses the existing server

- **WHEN** a second workspace's `OpenCodeEngine.execute()` is called after the server is already running
- **THEN** no new server process is started; the existing client connection is reused with the new `directory` parameter

#### Scenario: Server shutdown on engine teardown

- **WHEN** `OpenCodeEngine.shutdown()` is called
- **THEN** the OpenCode server process is stopped and all in-memory session/context maps are cleared

### Requirement: OpenCode SSE events are translated to EngineEvent types

The system SHALL translate OpenCode SSE part events to the `EngineEvent` discriminated union:

- `EventMessagePartUpdated` with `TextPart` → `{ type: "token", content }`
- `EventMessagePartUpdated` with `ReasoningPart` → `{ type: "reasoning", content }`
- `EventMessagePartUpdated` with `ToolPart` (state: `running`) → `{ type: "tool_start", name, arguments }`
- `EventMessagePartUpdated` with `ToolPart` (state: `completed`) → `{ type: "tool_result", name, result }`
- `EventMessagePartUpdated` with `ToolPart` (state: `error`) → `{ type: "tool_result", name, result, isError: true }`
- `EventPermissionUpdated` → `{ type: "shell_approval", command, executionId }`
- `EventSessionIdle` → `{ type: "done" }`
- `EventSessionStatus` with type `"retry"` → `{ type: "status", message }`
- `EventMessageUpdated` with token counts → `{ type: "usage", inputTokens, outputTokens }`
- Server or client error → `{ type: "error", message, fatal: true }`

#### Scenario: Token streaming from TextPart

- **WHEN** an `EventMessagePartUpdated` event with a `TextPart` is received from the SSE stream
- **THEN** a `{ type: "token", content }` event is yielded with the part's text content

#### Scenario: Tool call lifecycle from ToolPart

- **WHEN** an `EventMessagePartUpdated` with a `ToolPart` transitions from `running` to `completed`
- **THEN** a `{ type: "tool_start" }` event is yielded on `running` and a `{ type: "tool_result" }` event is yielded on `completed`

#### Scenario: Session idle signals execution completion

- **WHEN** an `EventSessionIdle` event is received
- **THEN** a `{ type: "done" }` event is yielded and the execution stream closes

### Requirement: Railyin task-management tools are injected via MCP

The system SHALL register a Railyin-controlled MCP HTTP server with the OpenCode server at startup via `POST /mcp`. The MCP server SHALL expose Railyin's common task-management tools (task transitions, human-turn, etc.) and dispatch tool calls using execution context looked up by `conversationId`.

#### Scenario: MCP server registered once at startup

- **WHEN** the OpenCode server process starts
- **THEN** a `POST /mcp` call registers the Railyin MCP server URL exactly once

#### Scenario: Tool call dispatches to the correct execution context

- **WHEN** the AI calls a Railyin task-management tool during an execution
- **THEN** the MCP server resolves the `conversationId` from the system prompt context and dispatches to the correct `{ taskId, boardId, callbacks }`

#### Scenario: Execution context cleaned up after execution ends

- **WHEN** an execution completes or errors
- **THEN** the `conversationId` entry is removed from the context map

### Requirement: OpenCode engine config supports a named multi-provider map

The system SHALL accept an optional `providers` map under `engine:` when `engine.type: opencode`. Each key is a provider ID and the value supports `api_key`, `base_url`, `npm`, and `models` fields. The map SHALL be injected verbatim into the OpenCode `Config.provider` at server startup.

#### Scenario: Anthropic provider configured

- **WHEN** `workspace.yaml` has `engine.type: opencode` with `providers.anthropic.api_key` set
- **THEN** the OpenCode server is started with `config.provider.anthropic.options.apiKey` set to that value

#### Scenario: Local LLM provider via OpenAI-compatible npm package

- **WHEN** a provider entry has `npm: "@ai-sdk/openai-compatible"` and `base_url: http://localhost:11434/v1`
- **THEN** the OpenCode server is started with the provider configured to use that npm package and base URL, enabling Ollama or LM Studio connectivity

#### Scenario: Multiple providers configured simultaneously

- **WHEN** `providers` map contains entries for `anthropic`, `openai`, and a local LLM provider
- **THEN** all three are injected into the OpenCode server config and available for model selection

### Requirement: Railyin attachments are mapped to OpenCode FilePartInput

The system SHALL map Railyin `Attachment[]` from `ExecutionParams` to `FilePartInput[]` when sending a prompt to an OpenCode session. File-type attachments SHALL be mapped to `{ type: "file", source: { type: "file", path } }`.

#### Scenario: File attachment passed to OpenCode session

- **WHEN** `ExecutionParams.attachments` contains a file attachment
- **THEN** the OpenCode session chat call includes a corresponding `FilePartInput` in the `parts` array

### Requirement: OpenCodeEngine lists available models via the OpenCode provider API

The system SHALL implement `listModels()` by querying the OpenCode server's provider and model endpoints. The returned `EngineModelInfo[]` SHALL use `providerID/modelID` as the `qualifiedId`.

#### Scenario: listModels returns provider-qualified model IDs

- **WHEN** `OpenCodeEngine.listModels()` is called
- **THEN** the returned models have `qualifiedId` in `providerID/modelID` format matching what OpenCode expects in `engine.model`

### Requirement: OpenCodeEngine lists available skills as slash commands

The system SHALL implement `listCommands()` by calling `GET /skill` on the OpenCode server. Each skill's `name` and `description` SHALL be mapped to a `CommandInfo` entry.

#### Scenario: listCommands returns skill names and descriptions

- **WHEN** `OpenCodeEngine.listCommands(taskId)` is called
- **THEN** the returned array contains entries with `name` and `description` sourced from OpenCode's skill API

### Requirement: OpenCodeEngine supports context compaction

The system SHALL implement `compact()` by calling the OpenCode session summarize endpoint for the session mapped to the given `conversationId`. Compaction lifecycle SHALL be signalled via `compaction_start` and `compaction_done` engine events.

#### Scenario: compact() triggers session summarization

- **WHEN** `OpenCodeEngine.compact(taskId, conversationId, workingDirectory)` is called
- **THEN** the OpenCode session associated with `conversationId` is summarized via the server API, and `compaction_start` followed by `compaction_done` events are emitted

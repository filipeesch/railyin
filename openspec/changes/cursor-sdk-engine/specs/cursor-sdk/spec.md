## ADDED Requirements

### Requirement: Cursor SDK engine support

The system SHALL support the Cursor SDK as an engine type, providing agent execution capabilities through the @cursor/sdk package.

#### Scenario: Cursor engine selection

- **WHEN** user selects `cursor` as their engine in model selection
- **THEN** Railyin creates a `CursorEngine` instance
- **AND** the engine uses Cursor SDK's `createAgentPlatform()` for agent management
- **AND** agent IDs are derived from `cursor-${conversationId}`

### Requirement: Agent creation and resumption

The system SHALL support creating new agents and resuming existing agents by conversation ID.

#### Scenario: Create new agent

- **WHEN** a conversation has no existing agent
- **THEN** Railyin creates a new agent via `Agent.create()` with model selection
- **AND** agent ID is `cursor-${conversationId}`

#### Scenario: Resume existing agent

- **WHEN** a conversation has an existing agent
- **THEN** Railyin resumes the agent via `Agent.resume(agentId)` 
- **AND** the agent continues from its previous conversation state

### Requirement: Streaming event translation

The system SHALL translate Cursor SDK's SDKMessage events to Railyin's EngineEvent stream format.

#### Scenario: Token streaming

- **WHEN** the agent generates response tokens
- **THEN** SDKMessage with type "assistant" is emitted
- **AND** token events are broadcast to the UI in real-time

#### Scenario: Tool execution

- **WHEN** the agent executes a tool (read_file, write_file, edit, etc.)
- **THEN** SDKMessage with type "tool_call" is emitted
- **AND** tool_start and tool_result events are created in the EngineEvent stream

#### Scenario: Reasoning

- **WHEN** the agent produces reasoning content
- **THEN** SDKMessage with type "thinking" is emitted
- **AND** reasoning chunks are streamed to the UI

### Requirement: Built-in tools integration

The system SHALL expose Cursor's built-in tools (read_file, write_file, edit, glob, grep, shell, task, etc.) to agents.

#### Scenario: Built-in tools available

- **WHEN** an agent is created
- **THEN** all Cursor built-in tools are available to the agent
- **AND** tool results include detailed file diffs for edit/apply operations

### Requirement: Common tool support

The system SHALL support Railyin's common task-management tools (tasks_read, tasks_write) in Cursor engine.

#### Scenario: Common tools via MCP

- **WHEN** Cursor SDK's `mcpServers` option is configured
- **THEN** Railyin's common tools (get_task, list_tasks, create_task, etc.) are available
- **AND** tool calls execute via the standard tool registry

### Requirement: Model selection

The system SHALL support optional model configuration for the Cursor engine.

#### Scenario: Model configuration

- **WHEN** engine config includes `model: "cursor/latest"`
- **THEN** the Cursor SDK uses the specified model
- **AND** if no model is configured, Cursor uses its default model

### Requirement: Platform store path handling

The system SHALL use Cursor SDK's default platform store for agent persistence.

#### Scenario: Default store paths

- **WHEN** creating or resuming an agent
- **THEN** Cursor SDK uses default store locations (e.g., `~/.cursor/`)
- **AND** no manual path configuration is required

## Purpose
Defines the CopilotEngine implementation that wraps the GitHub Copilot SDK as an ExecutionEngine. Manages session lifecycle, event translation, authentication, tool registration, and model listing for the Copilot engine type.

## Requirements

### Requirement: CopilotEngine wraps the Copilot SDK as an ExecutionEngine
The system SHALL implement `CopilotEngine` conforming to the `ExecutionEngine` interface. It SHALL use `@github/copilot-sdk` to create agentic sessions, translate SDK events to `EngineEvent` types, and manage session lifecycle.

#### Scenario: CopilotEngine instantiates from config
- **WHEN** `workspace.yaml` has `engine.type: copilot`
- **THEN** a `CopilotEngine` instance is created and ready to accept `execute()` calls

#### Scenario: execute() creates a Copilot session and yields events
- **WHEN** `CopilotEngine.execute(params)` is called
- **THEN** a new `CopilotSession` is created, the prompt is sent via `session.send()`, and SDK events are translated to `EngineEvent` and yielded to the caller

#### Scenario: cancel() disconnects the active session
- **WHEN** `CopilotEngine.cancel(executionId)` is called
- **THEN** the session associated with that execution is disconnected and the engine yields an error or done event

### Requirement: Copilot SDK events are translated to EngineEvent types
The system SHALL translate Copilot SDK streaming events to the `EngineEvent` discriminated union. The Copilot adapter SHALL preserve enough SDK metadata for the conversation layer to render rich user-facing tool activity and suppress non-user-facing internal activity:
- `assistant.message_delta` → `{ type: "token" }`
- `assistant.thinking_delta` → `{ type: "reasoning" }`
- `tool.execution_start` → `{ type: "tool_start" }`
- `tool.execution_complete` → `{ type: "tool_result" }`
- `session.complete` → `{ type: "done" }`
- `session.error` → `{ type: "error" }`

#### Scenario: Message delta translated to token event
- **WHEN** the SDK emits an `assistant.message_delta` event with content "Hello"
- **THEN** the engine yields `{ type: "token", content: "Hello" }`

#### Scenario: Tool execution events translated to tool events
- **WHEN** the SDK emits `tool.execution_start` for `editFile` then `tool.execution_complete`
- **THEN** the engine yields `{ type: "tool_start", name: "editFile", arguments: ... }` followed by `{ type: "tool_result", name: "editFile", result: ... }`

#### Scenario: Tool result translation preserves rich display content
- **WHEN** the SDK emits a `tool.execution_complete` event containing detailed or structured result content in addition to the concise LLM-facing text
- **THEN** the translated event keeps that richer content available to the conversation/UI layer

#### Scenario: Non-user-facing Copilot activity is not surfaced in the chat timeline
- **WHEN** the SDK identifies a message or tool-related event as hidden, internal, or otherwise non-user-facing through preserved metadata
- **THEN** that activity is not rendered as a visible conversation item

#### Scenario: User-facing tool execution still appears in order
- **WHEN** the SDK emits user-visible tool activity for a Copilot execution
- **THEN** the translated conversation items preserve the execution order needed by the timeline and remain visible in the chat UI

#### Scenario: Session completion translated to done event
- **WHEN** the SDK emits `session.complete`
- **THEN** the engine yields `{ type: "done" }`

#### Scenario: Session error translated to error event
- **WHEN** the SDK emits `session.error` with message "Rate limited"
- **THEN** the engine yields `{ type: "error", message: "Rate limited" }`

### Requirement: Copilot engine authenticates via environment or CLI credentials
The system SHALL NOT require any authentication token in `workspace.yaml`. Authentication SHALL be handled entirely by the Copilot SDK's built-in auth chain: `COPILOT_GITHUB_TOKEN` env var, `GH_TOKEN` env var, `GITHUB_TOKEN` env var, stored OAuth from `copilot` CLI login, or `gh auth` credentials.

#### Scenario: Auth succeeds via environment variable
- **WHEN** `GITHUB_TOKEN` is set in the environment
- **THEN** the Copilot SDK authenticates using that token and the engine starts successfully

#### Scenario: Auth succeeds via CLI login
- **WHEN** no env vars are set but `copilot` CLI has stored OAuth credentials
- **THEN** the SDK authenticates using stored credentials and the engine starts successfully

#### Scenario: Auth failure reports error event
- **WHEN** no valid credentials are found by the SDK
- **THEN** the engine yields `{ type: "error", message: "...", fatal: true }` describing the auth failure

### Requirement: Copilot engine registers common tools as custom tools
The system SHALL register Railyin's common tools (task management) with the Copilot SDK using `defineTool()`. Each common tool's metadata (name, description, input schema) SHALL be converted to the SDK's Zod-based format.

#### Scenario: Common tools registered on session creation
- **WHEN** a new CopilotSession is created
- **THEN** all common tools are registered via `defineTool()` and available for the model to call

#### Scenario: Custom tool call executed by Railyin
- **WHEN** the Copilot model calls `create_task` (a custom tool)
- **THEN** the Copilot engine delegates to the common tool handler and returns the result to the SDK

#### Scenario: Built-in Copilot tools handled by SDK
- **WHEN** the Copilot model calls `editFile` or `runInTerminal` (built-in SDK tools)
- **THEN** the SDK executes them directly; the engine translates the resulting events to `EngineEvent`

### Requirement: Copilot engine passes stage_instructions as system message customization
The system SHALL pass column `stage_instructions` to the Copilot SDK via `systemMessage` configuration with `mode: "customize"`. The instructions SHALL be injected as a section override so they complement (not replace) Copilot's default system prompt.

#### Scenario: Stage instructions injected into Copilot session
- **WHEN** `ExecutionParams.systemInstructions` is "You are reviewing code for security issues"
- **THEN** the CopilotSession is configured with a system message section containing those instructions

#### Scenario: No stage instructions results in default Copilot system prompt
- **WHEN** `ExecutionParams.systemInstructions` is undefined
- **THEN** the CopilotSession uses the default Copilot system prompt without modification

### Requirement: Copilot engine session lifecycle is one session per execution
The system SHALL create a new `CopilotSession` for each `execute()` call. The session SHALL be disconnected when the execution completes, fails, or is cancelled. Copilot's `infiniteSessions` feature handles compaction within the session. Railyin SHALL NOT perform any compaction for the Copilot engine.

#### Scenario: New session created per execution
- **WHEN** `execute()` is called twice for the same task
- **THEN** each call creates a separate CopilotSession

#### Scenario: Session disconnected on completion
- **WHEN** the execution completes normally
- **THEN** the CopilotSession is disconnected and resources are released

#### Scenario: Session disconnected on cancellation
- **WHEN** `cancel(executionId)` is called
- **THEN** the CopilotSession for that execution is disconnected

### Requirement: Copilot engine handles permission requests via events
The system SHALL handle Copilot SDK's `onPermissionRequest` callback by translating permission requests into `shell_approval` EngineEvents for shell commands. The orchestrator handles the approval flow — the engine resumes the session when approval is granted.

#### Scenario: Shell permission request translated to shell_approval event
- **WHEN** the SDK triggers `onPermissionRequest` for a shell command
- **THEN** the engine yields `{ type: "shell_approval", command: "npm test", executionId: ... }`

#### Scenario: Approved permission resumes execution
- **WHEN** the user approves a shell permission request
- **THEN** the engine signals the SDK to proceed and execution continues

#### Scenario: Denied permission returns tool error
- **WHEN** the user denies a shell permission request
- **THEN** the engine signals the SDK to deny and the SDK returns a tool error to the model

### Requirement: Copilot engine lists models available through GitHub Copilot
The `CopilotEngine.listModels()` method SHALL return the list of models available through the user's Copilot subscription. If the SDK provides a model listing API, it SHALL be used. Otherwise, a static list of known Copilot models SHALL be returned.

#### Scenario: Models returned from Copilot engine
- **WHEN** `listModels()` is called on the Copilot engine
- **THEN** it returns an array of `EngineModelInfo` with at least one model entry

#### Scenario: Model list includes model ID and display name
- **WHEN** `listModels()` returns results
- **THEN** each entry includes at minimum an `id` field and a `name` field

### Requirement: Copilot engine config is minimal
The `engine.type: copilot` config block SHALL support an optional `model` field (string) for the default model to use. No other fields are required. The config SHALL NOT include API keys, base URLs, or provider lists.

#### Scenario: Minimal copilot config is valid
- **WHEN** `workspace.yaml` has `engine: { type: copilot }`
- **THEN** the engine starts with default settings

#### Scenario: Copilot config with model override
- **WHEN** `workspace.yaml` has `engine: { type: copilot, model: gpt-5 }`
- **THEN** the engine uses `gpt-5` as the default model for executions

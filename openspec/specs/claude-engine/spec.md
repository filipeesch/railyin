## Purpose
Defines the Claude-backed execution engine, including Claude Code mode behavior, shared tool registration, resumable interactive pauses, and Claude model discovery.
## Requirements
### Requirement: ClaudeEngine wraps the Claude Agent SDK as an ExecutionEngine
The system SHALL implement `ClaudeEngine` conforming to the shared `ExecutionEngine` contract. It SHALL use `@anthropic-ai/claude-agent-sdk` through an engine-specific adapter that can be replaced in tests. The engine SHALL create or resume Claude sessions, translate SDK messages into `EngineEvent` values (including tool calls and results), and manage task-scoped runtime lease lifecycle for Claude-backed executions.

The message translator SHALL handle all content block types emitted by the Claude SDK:
- **text blocks** → `{ type: "token", content: block.text }`
- **thinking blocks** → `{ type: "reasoning", content: block.thinking }`
- **tool_use blocks** (in assistant messages) → `{ type: "tool_start", callId: block.id, name: block.name, arguments: JSON.stringify(block.input) }`
- **tool_result blocks** (in user messages) → `{ type: "tool_result", callId: block.tool_use_id, name: <paired from tool_use>, result: block.content }`
- **rate_limit events** → `{ type: "status", message: "Claude API rate limited..." }`
- **compaction_summary messages** → `{ type: "status", message: "Context window compacted..." }`

#### Scenario: ClaudeEngine instantiates from config
- **WHEN** `workspace.yaml` has `engine.type: claude`
- **THEN** a `ClaudeEngine` instance is created and ready to accept executions

#### Scenario: ClaudeEngine resumes a task session on later turns
- **WHEN** a later execution starts for the same task and worktree
- **THEN** the engine resumes the task's deterministic Claude session instead of starting from empty context

#### Scenario: ClaudeEngine disconnects active work on cancellation
- **WHEN** `cancel(executionId)` is called for a running Claude execution
- **THEN** the active Claude query/session is interrupted and the engine stops yielding additional events for that execution

#### Scenario: Tool call is translated to tool_start event
- **WHEN** Claude emits an assistant message with a `tool_use` content block (id="call_xyz", name="search", input={...})
- **THEN** the engine yields a `tool_start` event containing callId, name, and JSON arguments, making the tool invocation visible in the conversation timeline

#### Scenario: Tool result is paired with preceding tool call
- **WHEN** Claude emits a user message with a `tool_result` content block (tool_use_id="call_xyz", content="Found 3 results")
- **THEN** the engine yields a `tool_result` event with the tool name (looked up from the preceding tool_use), result content, and callId, creating a tool_call↔result pair in the conversation

#### Scenario: Tool result is surfaced even if preceding tool_use was missed
- **WHEN** a tool_result block references a tool_use_id that was never seen in the raw stream (e.g., due to capture gap)
- **THEN** the engine yields a `tool_result` event with name="unknown" instead of failing, allowing partial recovery and logging the anomaly

#### Scenario: Rate limit event is surfaced as status
- **WHEN** the Claude SDK emits a rate_limit_event in a result message
- **THEN** the engine yields a `status` event informing the user that the API is rate limited and retrying

#### Scenario: Compaction summary is surfaced to provide transparency
- **WHEN** the Claude SDK emits a system message with subtype="compaction_summary"
- **THEN** the engine yields a `status` event showing users that context window management occurred (e.g., "Context window compacted. Conversation summary created to reduce tokens.")

### Requirement: Claude runtime leases SHALL expire after 10 minutes of task inactivity
The Claude adapter SHALL track task lease activity and gracefully release Claude runtime resources after 10 minutes without activity. This inactivity policy SHALL apply during running and waiting-user states.

#### Scenario: Waiting-user Claude lease expires
- **WHEN** a task is waiting for user input and no lease activity occurs for 10 minutes
- **THEN** the Claude runtime lease is gracefully released

#### Scenario: Active Claude lease remains while activity is observed
- **WHEN** lease activity is observed within each 10-minute window
- **THEN** the Claude runtime lease remains active

### Requirement: Claude leases SHALL be gracefully closed during app exit
On app exit flow, all active Claude leases SHALL be asked to gracefully close before hard termination fallback.

#### Scenario: App exit closes all active Claude leases
- **WHEN** app quit flow begins
- **THEN** the Claude adapter attempts graceful closure for all active Claude leases within a bounded deadline

#### Scenario: Startup does not kill Claude runtimes
- **WHEN** the app starts
- **THEN** no startup path terminates Claude runtimes as part of this capability

### Requirement: Claude engine runs in Claude Code mode for project-local features
The Claude engine SHALL use the Agent SDK in Claude Code mode so Claude-managed project features are loaded natively from the worktree. At minimum, the engine SHALL use the Claude Code system/tool presets and project setting sources so project-local `CLAUDE.md`, skills, and slash commands are available during execution.

#### Scenario: Project CLAUDE.md is loaded for a Claude execution
- **WHEN** the task worktree contains `CLAUDE.md` or `.claude/CLAUDE.md`
- **THEN** the Claude engine starts with project setting sources enabled so those instructions are available to the SDK

#### Scenario: Project skills and slash commands are available
- **WHEN** the task worktree contains Claude Code skills or slash-command files under the supported project paths
- **THEN** the Claude engine loads them through the SDK's project setting sources instead of reimplementing them in Railyin

#### Scenario: Stage instructions append to Claude Code behavior
- **WHEN** `ExecutionParams.systemInstructions` is present
- **THEN** the Claude engine appends those instructions on top of Claude Code mode instead of replacing the Claude Code baseline behavior

### Requirement: Claude engine uses Claude built-in tools plus Railyin common tools
The Claude engine SHALL rely on Claude's built-in tools for file, shell, search, edit, and agent operations. Railyin SHALL register only its engine-agnostic task-management tools with the Claude engine. Tool results emitted by the Claude engine SHALL include structured `writtenFiles` metadata when file changes can be determined reliably from Claude tool activity.

#### Scenario: Common task-management tools are available in Claude engine
- **WHEN** the Claude engine starts an execution
- **THEN** tools such as `create_task`, `move_task`, and `list_tasks` are available to the model through the SDK integration

#### Scenario: File and shell tools are not shadowed by Railyin duplicates
- **WHEN** the Claude engine is active
- **THEN** Railyin does NOT register duplicate `read_file`, `write_file`, `run_command`, or search tools because Claude's built-in tools already provide those capabilities

#### Scenario: Claude tool result includes structured written files when available
- **WHEN** Claude tool activity provides enough information to identify changed files
- **THEN** the emitted `tool_result` includes `writtenFiles` for those changes

#### Scenario: Claude tool result remains valid when only partial file detail is available
- **WHEN** Claude tool activity confirms file changes but does not include deterministic hunk detail
- **THEN** the emitted `writtenFiles` omits unavailable optional fields while still identifying changed files

### Requirement: Claude interactive pauses are surfaced through engine events and resumed in place
When the Claude SDK requests user input or tool permission during a live execution, the Claude engine SHALL surface that pause through the shared non-native interaction contract and SHALL resume the same execution after the orchestrator returns the user's decision.

#### Scenario: AskUserQuestion pause becomes ask_user event
- **WHEN** the Claude SDK requests a user answer through `AskUserQuestion`
- **THEN** the Claude engine yields an `ask_user` event carrying the serialized question payload needed by the orchestrator

#### Scenario: Permission request becomes shell_approval event
- **WHEN** the Claude SDK requests approval for a shell or tool action that requires user consent
- **THEN** the Claude engine yields a `shell_approval` event carrying the command or permission payload needed by the orchestrator

#### Scenario: User response resumes same execution
- **WHEN** the user answers a Claude question or approves/denies a pending permission request
- **THEN** the orchestrator routes the response back to the same Claude execution and the engine continues the paused SDK flow instead of starting a new execution

### Requirement: Claude engine lists models available through the SDK
`ClaudeEngine.listModels()` SHALL return models available through the Claude Agent SDK in the shared `EngineModelInfo` shape used by the rest of the product.

#### Scenario: Claude engine returns available models
- **WHEN** `listModels()` is called while the Claude engine is active
- **THEN** it returns an array of Claude model entries with shared model metadata fields such as qualified ID and display name

#### Scenario: Claude model IDs are qualified for UI grouping
- **WHEN** Claude models are returned to the product
- **THEN** they are qualified in a way that keeps model-selection grouping and persistence consistent with other engines

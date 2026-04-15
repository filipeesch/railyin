## Purpose
Defines the Claude-backed execution engine, including Claude Code mode behavior, shared tool registration, resumable interactive pauses, and Claude model discovery.
## Requirements
### Requirement: ClaudeEngine wraps the Claude Agent SDK as an ExecutionEngine
The system SHALL implement `ClaudeEngine` conforming to the shared `ExecutionEngine` contract. It SHALL use `@anthropic-ai/claude-agent-sdk` through an engine-specific adapter that can be replaced in tests. The engine SHALL create or resume Claude sessions, translate SDK messages into `EngineEvent` values, and manage session lifecycle for Claude-backed executions.

#### Scenario: ClaudeEngine instantiates from config
- **WHEN** `workspace.yaml` has `engine.type: claude`
- **THEN** a `ClaudeEngine` instance is created and ready to accept executions

#### Scenario: ClaudeEngine resumes a task session on later turns
- **WHEN** a later execution starts for the same task and worktree
- **THEN** the engine resumes the task's deterministic Claude session instead of starting from empty context

#### Scenario: ClaudeEngine disconnects active work on cancellation
- **WHEN** `cancel(executionId)` is called for a running Claude execution
- **THEN** the active Claude query/session is interrupted and the engine stops yielding additional events for that execution

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


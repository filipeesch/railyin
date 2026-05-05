## MODIFIED Requirements

### Requirement: ExecutionEngine interface defines the contract for all engines
The system SHALL define an `ExecutionEngine` interface that all supported engines implement. The interface SHALL include:
- `execute(params: ExecutionParams): AsyncIterable<EngineEvent>` — run an agentic execution
- `cancel(executionId: number): void` — abort a running execution
- `resume(executionId: number, input: EngineResumeInput): Promise<void>` — resume a paused execution
- `listModels(): Promise<EngineModelInfo[]>` — return models available through this engine; each model's `qualifiedId` SHALL use the `QualifiedModelId` format (`{engineId}/{providerId?}/{modelId}`)
- `compact?(taskId: number | null, conversationId: number, workingDirectory: string): Promise<void>` — optional; trigger manual context compaction; engines that do not support explicit compaction (e.g. Claude) leave this `undefined`
- `shutdown?(options?: { reason: "app-exit" | "workspace-reload" | "lifecycle-timeout"; deadlineMs?: number }): Promise<void>` — optional graceful shutdown hook

Every supported engine implementation SHALL conform to this interface. The interface SHALL be defined in `src/bun/engine/types.ts`.

#### Scenario: Copilot engine implements ExecutionEngine
- **WHEN** the engine factory constructs the copilot engine
- **THEN** the returned object satisfies the `ExecutionEngine` interface, including `compact()` and graceful shutdown

#### Scenario: Claude engine implements ExecutionEngine without compact
- **WHEN** the engine factory constructs the Claude engine
- **THEN** the returned object satisfies the `ExecutionEngine` interface
- **AND** `compact` is `undefined` (Claude auto-compacts internally)

#### Scenario: OpenCode engine implements ExecutionEngine with compact
- **WHEN** the engine factory constructs the OpenCode engine
- **THEN** the returned object satisfies the `ExecutionEngine` interface, including `compact()` that calls `client.session.summarize()`

#### Scenario: listModels returns QualifiedModelId-formatted qualifiedIds
- **WHEN** `engine.listModels()` is called on any engine
- **THEN** every returned `EngineModelInfo.qualifiedId` is a valid `QualifiedModelId` string parseable without error

#### Scenario: OpenCode listModels wraps IDs with opencode/ prefix
- **WHEN** `OpenCodeEngine.listModels()` is called and the SDK returns `anthropic/claude-sonnet-4-5`
- **THEN** the returned `qualifiedId` is `"opencode/anthropic/claude-sonnet-4-5"`

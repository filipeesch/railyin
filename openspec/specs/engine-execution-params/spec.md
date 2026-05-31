## Purpose
Defines the contract for `ExecutionParamsBuilder` — how task and chat execution parameters are constructed, including working directory resolution, AbortSignal handling, and callback injection. Decision record injection is handled by `DecisionContextInjector` at the user-prompt layer, not here.

## Requirements

### Requirement: ExecutionParamsBuilder.build() is a pure function
`ExecutionParamsBuilder` SHALL NOT accept or use a `DecisionRepository` parameter. `build()` and `buildForChat()` SHALL NOT call any decision repository method and SHALL NOT append any decision block to `systemInstructions`. `ExecutionParamsBuilder` SHALL NOT apply `contextWindowOverride` or `samplingPresetName` — these are applied by `ExecutionParamsEnricher` after the builder returns. All other behavior (AbortSignal, prompt resolution, attachments) remains unchanged.

#### Scenario: build() does not append decision block
- **WHEN** `build(task, conversationId, executionId, prompt, systemInstructions, workingDirectory, signal, attachments?)` is called
- **THEN** `systemInstructions` in the returned `ExecutionParams` does not contain any decision-related content

#### Scenario: buildForChat() does not append decision block
- **WHEN** `buildForChat(conversationId, executionId, prompt, workingDirectory, model, signal, enabledMcpTools?, attachments?)` is called
- **THEN** `systemInstructions` in the returned `ExecutionParams` does not contain any decision-related content

#### Scenario: build() — no decisions in systemInstructions
- **WHEN** `ExecutionParamsBuilder.build()` is called with an active conversation that has decision records
- **THEN** the returned `ExecutionParams.systemInstructions` does NOT contain any decision record text

#### Scenario: buildForChat() — no decisions in systemInstructions
- **WHEN** `ExecutionParamsBuilder.buildForChat()` is called with a conversation that has decision records
- **THEN** the returned params have no decision content in `systemInstructions`

#### Scenario: build() returns params without contextWindowOverride
- **WHEN** `ExecutionParamsBuilder.build()` is called
- **THEN** the returned `ExecutionParams.contextWindowOverride` is `undefined` (to be set by enricher)

#### Scenario: build() returns params without samplingPresetName
- **WHEN** `ExecutionParamsBuilder.build()` is called
- **THEN** the returned `ExecutionParams.samplingPresetName` is `undefined` (to be set by enricher)

### Requirement: WorkingDirectoryResolver resolves the agent CWD
`WorkingDirectoryResolver.resolve(task: TaskRow): string` SHALL implement the priority order: worktree_path + relative(gitRootPath, projectPath) → projectPath → throw.

#### Scenario: Worktree ready with monorepo sub-path
- **WHEN** the task has a ready worktree and the project has a `gitRootPath` different from `projectPath`
- **THEN** the resolved path is `join(worktreePath, relative(gitRootPath, projectPath))`

#### Scenario: projectPath outside gitRootPath throws
- **WHEN** `relative(gitRootPath, projectPath)` produces a `../` prefix
- **THEN** `resolve()` throws with a descriptive error referencing both paths

#### Scenario: No worktree, projectPath available
- **WHEN** the task has no ready worktree but has a configured `projectPath`
- **THEN** the resolved path is `projectPath`

#### Scenario: Neither worktree nor projectPath throws
- **WHEN** the task has no ready worktree and no configured projectPath
- **THEN** `resolve()` throws with a message referencing the `project_key`

### Requirement: ExecutionParams carries onTransition and onHumanTurn callbacks
`ExecutionParams` SHALL include two optional callback fields: `onTransition?: (taskId: number, toState: string) => void` and `onHumanTurn?: (taskId: number, message: string) => void`. Both engines (Claude and Copilot) SHALL read these from params and pass them into `commonToolContext` on every execution, defaulting to `() => {}` if absent. The Orchestrator SHALL populate these callbacks when building params via `ExecutionParamsBuilder`.

#### Scenario: onTransition injected into commonToolContext
- **WHEN** `ClaudeEngine.execute(params)` or `CopilotEngine.execute(params)` is called with a non-null `params.onTransition`
- **THEN** `commonToolContext.workflow.transition` is the same function reference as `params.onTransition`

#### Scenario: onHumanTurn injected into commonToolContext
- **WHEN** an engine executes with a non-null `params.onHumanTurn`
- **THEN** `commonToolContext.workflow.humanTurn` is the same function reference as `params.onHumanTurn`

#### Scenario: Callbacks default to no-op when absent from params
- **WHEN** an engine executes without `onTransition` or `onHumanTurn` set in params
- **THEN** `commonToolContext.onTransition` and `commonToolContext.onHumanTurn` are functions that do nothing when called

#### Scenario: Orchestrator provides real implementations
- **WHEN** the Orchestrator builds ExecutionParams for a task execution
- **THEN** `onTransition` is wired to `void transitionExecutor.execute(taskId, toState)`
- **AND** `onHumanTurn` is wired to `void humanTurnExecutor.execute(taskId, message)`

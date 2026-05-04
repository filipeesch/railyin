## ADDED Requirements

### Requirement: ExecutionParamsBuilder.build() is a pure function
`ExecutionParamsBuilder` SHALL accept a `DecisionRepository` instance via constructor injection. `build()` SHALL accept a pre-created `AbortSignal` as a parameter, SHALL NOT register or mutate any `AbortController` map, and SHALL call `decisionRepo.buildSystemBlock(conversationId)` to append the decision block to `systemInstructions` before returning `ExecutionParams`.

#### Scenario: Task execution params include decision block
- **WHEN** `build(task, conversationId, executionId, prompt, systemInstructions, workingDirectory, signal, attachments?)` is called and the conversation has decision records
- **THEN** it returns an `ExecutionParams` where `systemInstructions` ends with the formatted decision block produced by `buildSystemBlock`

#### Scenario: Task execution params with no decisions appends nothing
- **WHEN** `build(...)` is called and the conversation has no decision records
- **THEN** `systemInstructions` is returned unchanged (empty string from `buildSystemBlock` is not appended)

#### Scenario: Chat execution params include decision block
- **WHEN** `buildForChat(conversationId, executionId, prompt, workingDirectory, model, signal, enabledMcpTools?, attachments?)` is called and the conversation has decision records
- **THEN** it returns an `ExecutionParams` with `taskId: null` and `systemInstructions` appended with the decision block

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

### Requirement: ExecutionParamsBuilder injects decision records into systemInstructions
`ExecutionParamsBuilder` SHALL accept a `DecisionRepository` constructor parameter and append the formatted decision block to `systemInstructions` in both `build()` and `buildForChat()` when non-empty.

#### Scenario: build() appends decision block when records exist
- **WHEN** `build()` is called and the injected `DecisionRepository.buildSystemBlock()` returns a non-empty string
- **THEN** `systemInstructions` in the returned `ExecutionParams` ends with the decision block

#### Scenario: build() does not append when no records exist
- **WHEN** `build()` is called and `buildSystemBlock()` returns `""`
- **THEN** `systemInstructions` does not contain `## Decision Records` and has no trailing whitespace added

#### Scenario: buildForChat() appends decision block when records exist
- **WHEN** `buildForChat()` is called and `buildSystemBlock()` returns a non-empty string
- **THEN** `systemInstructions` in the result ends with the decision block

#### Scenario: buildForChat() does not append when no records exist
- **WHEN** `buildForChat()` is called and `buildSystemBlock()` returns `""`
- **THEN** `systemInstructions` is unchanged relative to the no-decisions baseline

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

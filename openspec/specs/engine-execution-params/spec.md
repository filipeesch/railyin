## ADDED Requirements

### Requirement: ExecutionParamsBuilder.build() is a pure function
`ExecutionParamsBuilder.build()` SHALL accept a pre-created `AbortSignal` as a parameter and SHALL NOT register or mutate any `AbortController` map. It SHALL return a fully populated `ExecutionParams` object.

#### Scenario: Task execution params
- **WHEN** `build(task, conversationId, executionId, prompt, systemInstructions, workingDirectory, signal, attachments?)` is called
- **THEN** it returns an `ExecutionParams` with all fields populated from the arguments, including `boardId`, `taskContext`, and `enabledMcpTools` parsed from `task.enabled_mcp_tools`

#### Scenario: Chat execution params
- **WHEN** `buildForChat(conversationId, executionId, prompt, workingDirectory, model, signal, enabledMcpTools?, attachments?)` is called
- **THEN** it returns an `ExecutionParams` with `taskId: null` and no `boardId` or `taskContext`

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

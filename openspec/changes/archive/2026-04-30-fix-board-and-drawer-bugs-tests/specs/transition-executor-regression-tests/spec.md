## ADDED Requirements

### Requirement: TransitionExecutor tests assert correct post-write execution state
`src/bun/test/transition-executor.test.ts` SHALL include tests TE-7 and TE-8 verifying that the task returned from a with-prompt transition reflects the final DB state written during that transition, not a stale pre-write snapshot.

#### Scenario: TE-7 — with-prompt transition returns executionState running
- **WHEN** `TransitionExecutor.execute(taskId, toState)` is called for a column with `on_enter_prompt`
- **THEN** the returned `result.task.executionState` equals `'running'`

#### Scenario: TE-8 — with-prompt transition returns non-null currentExecutionId
- **WHEN** `TransitionExecutor.execute(taskId, toState)` is called for a column with `on_enter_prompt`
- **THEN** `result.task.currentExecutionId` equals `result.executionId` and is not null

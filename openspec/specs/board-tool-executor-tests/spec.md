# Board Tool Executor Tests

## Purpose

Test coverage for the `BoardToolExecutor` class focusing on the integration seam between `BoardToolExecutor` and `WorkspaceRepository` using in-memory DB injection.

## Requirements

### Requirement: board-tool-executor.test.ts covers constructor contract and workspace routing
The test file `src/bun/test/board-tool-executor.test.ts` SHALL exist and test `BoardToolExecutor` with a real `WorkspaceRepository(db)` using an in-memory DB via `initDb()` + `setupTestConfig()`. It SHALL NOT duplicate the 50+ tool-method scenarios already in `tasks-tools.test.ts`; it SHALL focus on the integration seam between `BoardToolExecutor` and `WorkspaceRepository`.

#### Scenario: BE-1 constructor satisfies IBoardToolExecutor
- **WHEN** `const exec: IBoardToolExecutor = new BoardToolExecutor(db, wsRepo)` is evaluated
- **THEN** TypeScript compiles without errors

#### Scenario: BE-2 getTask returns task data for known id
- **WHEN** a task exists in the in-memory DB and `executor.getTask({ task_id: id }, ctx)` is called
- **THEN** the returned string contains the task title

#### Scenario: BE-3 getTask returns error string for unknown id
- **WHEN** no task with the given id exists and `executor.getTask({ task_id: 999 }, ctx)` is called
- **THEN** the returned string starts with `"Error:"`

#### Scenario: BE-4 createTask respects workspace routing via injected wsRepo
- **WHEN** `executor.createTask({ title: "T", project_key: "p", board_id: boardId }, ctx)` is called
- **THEN** a new task row is inserted into the in-memory DB (not the production DB)

#### Scenario: BE-5 moveTask updates workflow_state in injected DB
- **WHEN** `executor.moveTask({ task_id: id, workflow_state: "done" }, ctx)` is called with a valid task and column
- **THEN** the task's `workflow_state` is updated in the in-memory DB

#### Scenario: BE-6 messageTask delivers to idle task via injected callbacks
- **WHEN** `executor.messageTask({ task_id: id, message: "hello" }, ctx)` is called with an idle task
- **THEN** `ctx.onHumanTurn` is invoked

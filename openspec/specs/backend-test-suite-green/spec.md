## Requirements

### Requirement: All backend unit tests pass without failures
The backend test suite (`bun test src/bun/test --timeout 20000`) SHALL produce zero failures. Tests that fail due to stale fixtures, incorrect return-type assumptions, or deprecated callback channels SHALL be updated to match current production behavior.

#### Scenario: Migration fixture tests pass
- **WHEN** `bun test src/bun/test/db-migrations.test.ts` is run
- **THEN** all 4 tests pass with no SQLiteError about missing columns or tables

#### Scenario: Todo tool tests pass
- **WHEN** `bun test src/bun/test/tasks-tools.test.ts` is run
- **THEN** all todo-related tests pass by correctly unwrapping `ToolExecutionResult.text` before JSON parsing

#### Scenario: RPC scenario tests pass
- **WHEN** `bun test src/bun/test/copilot-rpc-scenarios.test.ts` is run
- **THEN** all tests pass by waiting on `waitForStreamDone` instead of the defunct `waitForTokenDone`

#### Scenario: Full suite has zero failures
- **WHEN** `bun test src/bun/test --timeout 20000` is run
- **THEN** 0 tests fail across all test files in the suite

### Requirement: Handler module unit tests are part of the green suite
The backend test suite SHALL include the 7 new handler module test files. All must pass as part of `bun test src/bun/test --timeout 20000`.

#### Scenario: New test files pass in the full suite run
- **WHEN** `bun test src/bun/test --timeout 20000` is run after the handler split and test files are committed
- **THEN** `transition-validator.test.ts`, `diff-utils.test.ts`, `todo-handlers.test.ts`, `code-review-handlers.test.ts`, `task-git-handlers.test.ts`, `model-handlers.test.ts`, and `engine-handlers.test.ts` all show 0 failures

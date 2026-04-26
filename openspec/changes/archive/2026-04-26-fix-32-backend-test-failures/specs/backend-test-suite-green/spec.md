## ADDED Requirements

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

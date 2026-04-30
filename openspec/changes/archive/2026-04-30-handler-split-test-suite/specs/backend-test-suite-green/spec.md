## ADDED Requirements

### Requirement: Handler module unit tests are part of the green suite
The backend test suite SHALL include the 7 new handler module test files. All must pass as part of `bun test src/bun/test --timeout 20000`.

#### Scenario: New test files pass in the full suite run
- **WHEN** `bun test src/bun/test --timeout 20000` is run after the handler split and test files are committed
- **THEN** `transition-validator.test.ts`, `diff-utils.test.ts`, `todo-handlers.test.ts`, `code-review-handlers.test.ts`, `task-git-handlers.test.ts`, `model-handlers.test.ts`, and `engine-handlers.test.ts` all show 0 failures

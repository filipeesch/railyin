# Test Infrastructure

## Purpose

Shared test helpers and utilities used across the backend test suite.

## Requirements

### Requirement: Test infrastructure supports workspace-relative project paths

The test helper `setupTestConfig` SHALL create a real `workspacePath` subdirectory inside the temp `configDir` and write YAML with `workspace_path` set and `project_path` as a relative path. It SHALL return `workspacePath` in its result object so new tests can assert resolved paths.

#### Scenario: setupTestConfig creates valid relative-path config

- **WHEN** `setupTestConfig` is called
- **THEN** the written YAML SHALL contain a relative `project_path` (e.g. `test-project`) and a `workspace_path` pointing to `${configDir}/workspace`
- **AND** `loadConfig()` on the produced config SHALL succeed without errors

#### Scenario: Existing callers are unaffected

- **WHEN** existing backend test files call `setupTestConfig` without using the `workspacePath` return value
- **THEN** all tests SHALL continue to pass without call-site changes

### Requirement: No test file may call getDb() implicitly at module level
No test file SHALL construct a class that eagerly calls `getDb()` (e.g. `new TodoRepository()`) at module level or outside a `beforeEach`/`beforeAll` block, unless `RAILYN_DB=:memory:` has already been set before module load. `common-tools-registration.test.ts` SHALL be fixed to comply with this rule. All adapted test files that construct `WorkspaceRepository`, `BoardToolExecutor`, or any DI-refactored class SHALL do so inside `beforeEach` using the `db` returned by `initDb()`.

#### Scenario: common-tools-registration uses initDb() and injects db
- **WHEN** `common-tools-registration.test.ts` runs
- **THEN** `initDb()` and `setupTestConfig()` are called in `beforeEach`, `new TodoRepository(db)` receives the in-memory DB, and `new BoardToolExecutor(db, wsRepo)` is injected into `baseContext`

#### Scenario: No production DB connection opened during test run
- **WHEN** the full backend test suite runs with `bun test src/bun --timeout 20000`
- **THEN** no file is created at `~/.railyn/railyn.db` that wasn't there before the run

#### Scenario: Tests can construct BoardToolExecutor without env vars
- **WHEN** a test calls `new BoardToolExecutor(db, new WorkspaceRepository(db))` where `db` is an in-memory DB
- **THEN** all methods work against that in-memory DB regardless of `RAILYN_DB` env var

#### Scenario: Adapted test files construct DI classes in beforeEach
- **WHEN** any test file that uses `WorkspaceRepository`, `BoardToolExecutor`, `WorkingDirectoryResolver`, or any refactored executor constructs those instances
- **THEN** all such constructions appear inside `beforeEach` (or `beforeAll`) with the `db` from `initDb()`

#### Scenario: StubWorkdirResolver implements interface, not extends class
- **WHEN** `transition-executor.test.ts` defines `StubWorkdirResolver`
- **THEN** it implements `IWorkingDirectoryResolver` directly with no `super()` call, and TypeScript compiles without errors

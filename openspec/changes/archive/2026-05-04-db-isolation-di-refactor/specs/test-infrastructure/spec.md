## MODIFIED Requirements

### Requirement: No test file may call getDb() implicitly at module level
No test file SHALL construct a class that eagerly calls `getDb()` (e.g. `new TodoRepository()`) at module level or outside a `beforeEach`/`beforeAll` block, unless `RAILYN_DB=:memory:` has already been set before module load. `common-tools-registration.test.ts` SHALL be fixed to comply with this rule.

#### Scenario: common-tools-registration uses initDb() and injects db
- **WHEN** `common-tools-registration.test.ts` runs
- **THEN** `initDb()` and `setupTestConfig()` are called in `beforeEach`, `new TodoRepository(db)` receives the in-memory DB, and `new BoardToolExecutor(db, wsRepo)` is injected into `baseContext`

#### Scenario: No production DB connection opened during test run
- **WHEN** the full backend test suite runs with `bun test src/bun --timeout 20000`
- **THEN** no file is created at `~/.railyn/railyn.db` that wasn't there before the run

#### Scenario: Tests can construct BoardToolExecutor without env vars
- **WHEN** a test calls `new BoardToolExecutor(db, new WorkspaceRepository(db))` where `db` is an in-memory DB
- **THEN** all methods work against that in-memory DB regardless of `RAILYN_DB` env var

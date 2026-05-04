## Context

The `decision-request` feature change adds a new DB layer (`DecisionRepository`, 3 new tables), 5 new AI tools, a refactored `CommonToolContext`, `ExecutionParamsBuilder` injection, atomic `sendMessage` persistence, and new frontend surfaces (DecisionsPanel, tab systems, renamed component). None of this has test coverage.

The existing test infrastructure provides strong patterns to follow: `initDb()` for in-memory SQLite, `seedProjectAndTask()` for seed data, `executeCommonTool()` for tool unit tests, `BackendRpcRuntime` for full integration scenarios, and `ApiMock`/`WsMock` for Playwright mocked-backend tests.

## Goals / Non-Goals

**Goals:**
- Verify `DecisionRepository` CRUD and `buildSystemBlock` formatting in isolation
- Verify all 5 new AI tools via `executeCommonTool()` with in-memory DB
- Verify `ExecutionParamsBuilder` appends decision block when records exist
- Verify `tasks.sendMessage` and `chatSessions.sendMessage` persist `decisionBatch` atomically
- Verify `decision_request` tool suspends execution (renamed from `interview_me`)
- Verify `record_decision` does NOT suspend execution
- Verify `decisions.list` RPC handler returns conversation-scoped, weight-ordered records
- Verify new DB migration creates all 3 tables with correct schema
- Verify `DecisionsPanel` Playwright specs: tab visibility, empty state, weight grouping, badges, routing
- Rename all `interview_me`/`interview_prompt` references in existing test files

**Non-Goals:**
- Performance tests for decision injection token overhead
- Testing decision record cross-conversation isolation beyond basic scoping assertion
- UI mutation testing for DecisionsPanel (covered by frontend mutation suite separately)

## Decisions

### 1. Extend `helpers.ts` `initDb()` with decision table DDL

The 3 new tables (`decision_batches`, `decision_records`, `decision_revisions`) must be added to `initDb()`'s inline DDL, not by calling `runMigrations()`. This follows the existing pattern (all current tables are defined inline in `initDb()`) and keeps unit tests fast and explicit about their schema dependency.

**Alternative considered**: Call `runMigrations()` in each test that needs decision tables. Rejected — slower, tests the migration runner in every suite, and couples unrelated tests to migration file structure.

### 2. `DecisionRepository` test injection: constructor arg

Tests instantiate `new DecisionRepository(db)` passing the in-memory DB — the same pattern `TodoRepository(db)` uses in `todo-handlers.test.ts`. The optional fallback to `getDb()` singleton (used by `common-tools-registration.test.ts`) continues to work because `initDb()` sets the global singleton to `:memory:`.

### 3. `ExecutionParamsBuilder` mock strategy: stub object

`ExecutionParamsBuilder` tests use a plain stub `{ buildSystemBlock: () => Promise.resolve("") }` for no-op cases and `{ buildSystemBlock: () => Promise.resolve("## Decision Records\n...") }` for injection cases. No real DB required for `ExecutionParamsBuilder` unit tests.

### 4. Playwright `decisions.list` mock: baseline empty stub in fixtures

`e2e/ui/fixtures/index.ts` adds a `decisions.list → []` baseline stub so all existing specs that open task drawers don't break when `DecisionsPanel` is mounted. Specs that need decision data override the stub inline.

### 5. `CommonToolContext` fixture shape update: coordinated single-point update

The `commonCtx()` fixture in `tasks-tools.test.ts` is the one place that constructs a full `CommonToolContext` for tool tests. Updating it to the nested shape (`task.conversationId`, `repos.decisions`, etc.) automatically covers all tool tests that depend on it — no per-test changes needed.

## Risks / Trade-offs

- **`helpers.ts` is a shared test utility**: Adding 3 table DDL statements is additive and non-breaking, but if the production migration diverges from the `initDb()` DDL (e.g., additional indexes), tests could silently pass on a schema that doesn't match prod. Mitigation: `db-migrations.test.ts` verifies the migration output independently — if they ever diverge, the migration test fails.

- **Playwright baseline stub for `decisions.list`**: If a future spec forgets to add the stub and the component does a real fetch, the test fails with a network error rather than a missing mock assertion. This is a fast-fail, not a silent pass — acceptable.

- **`BackendRpcRuntime` integration tests use the real orchestrator**: The `copilot-rpc-scenarios.test.ts` pattern is heavyweight (real engine + DB). Adding `record_decision` and `list_decisions` scenarios extends an already-long suite. Kept to 2–3 new scenarios per adapter to limit suite time.

## Migration Plan

No DB changes. No deployment. Tests are additive — existing test runs continue to pass before this change lands. After `decision-request` is applied:
1. Run `bun test src/bun/test --timeout 20000` — new test files and extensions pass
2. Run `npx playwright test e2e/ui` — renamed spec and new panel spec pass
3. No rollback needed — tests are non-destructive

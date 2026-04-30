## Context

The `split-handlers-tasks` refactor produces six new handler modules (`task-git.ts`, `code-review.ts`, `todos.ts`, `models.ts`, `engine.ts`) and two new utility modules (`git/diff-utils.ts`, `workflow/transition-validator.ts`). None of these modules have unit tests today. Additionally, the `column-allowed-transitions` spec shipped with zero Playwright coverage — six UI scenarios exist in the spec with no corresponding tests.

Existing test infrastructure (`src/bun/test/helpers.ts`) provides `initDb()`, `setupTestConfig()`, and `seedProjectAndTask()` — all patterns needed here. The `worktree.test.ts` file establishes the git-tmpdir pattern. The `position-service.test.ts` file establishes the domain-file-per-module pattern with describe blocks using spec-ID prefixes.

This task writes tests only. No source changes.

## Goals / Non-Goals

**Goals:**
- One test file per new handler module (7 files)
- Cover `validateTransition` and `diff-utils` as new utility modules
- Cover the `column-allowed-transitions` UI spec with a Playwright spec (AT-1..AT-4)
- Use real in-memory DB and real git tmpdirs — no mocking framework

**Non-Goals:**
- Testing `tasks.ts` CRUD handlers (covered by existing `handlers.test.ts`)
- End-to-end backend+frontend integration (Playwright tests use mock API)
- Mutation testing (separate concern)

## Decisions

### D1: Separate file per domain (not appending to handlers.test.ts)

Matches the established `position-service.test.ts` / `column-config.test.ts` / `workflow-handlers.test.ts` pattern. Each file is self-contained with its own `beforeEach`/`afterEach`. Avoids growing `handlers.test.ts` beyond its current scope.

**Alternative considered:** Appending new describes to `handlers.test.ts`. Rejected — that file already covers the composed `allHandlers` shape; new files test individual factory contracts.

### D2: TodoRepository via in-memory DB (no getDb() singleton dependence)

`todoHandlers(db)` constructs `new TodoRepository(db)`. Tests pass the `initDb()` result directly — no global singleton involved. This validates that the DI wiring actually works: if `TodoRepository` internally fell back to `getDb()`, the test DB and the fallback DB would be different instances and assertions would fail.

### D3: Real git tmpdir for diff-utils, code-review, task-git

These functions shell out to `git` or read real file paths. Tests create a temp git repo via `mkdtempSync` + `execSync("git init")`, matching the `worktree.test.ts` pattern. No mock of `execSync` — integration fidelity is the point.

### D4: Mock orchestrator as plain object (no test framework mock)

`modelHandlers(db, orchestrator)` and `engineHandlers(orchestrator)` call two methods: `listModels()` and `listCommands()`. A plain object implementing those methods (`{ listModels: async () => [...], listCommands: async () => [...] }`) is sufficient and matches the codebase's no-mocking-framework convention.

### D5: Playwright spec for column-allowed-transitions uses makeWorkflowTemplate with allowedTransitions

`makeWorkflowTemplate()` in `e2e/ui/fixtures/mock-data.ts` accepts a `columns` array. Tests construct a template where `backlog` has `allowedTransitions: ["plan"]` (only one allowed target) and verify CSS class, cursor, and API call behavior.

## Risks / Trade-offs

- **Task ordering dependency** — these tests cannot pass until `split-handlers-tasks` is applied. The test files should be written and committed after the handler split is merged. → Mitigation: tasks.md makes the dependency explicit.
- **git tmpdir tests on CI** — git must be installed and configured. Existing `worktree.test.ts` proves this works in CI already.
- **Playwright cursor check** — `not-allowed` cursor is a CSS computed style on the column element; it may require `page.evaluate` rather than a Playwright locator API. → Mitigation: use `evaluate` to check `getComputedStyle(el).cursor` directly.

## Context

The `decision-request-improvements` feature is fully designed but has no tests. This design covers how the test suite is structured: which test patterns to follow, how to inject doubles, the `helpers.ts` prerequisite, and the scope of Playwright changes.

Reference: `openspec/changes/decision-request-improvements/` for the production feature design.

## Goals / Non-Goals

**Goals:**
- Cover all new production units with appropriate tests (unit, integration, E2E)
- Follow existing test patterns already established in the codebase — no new testing infrastructure
- Update existing tests affected by the feature (params builder, executor, RPC scenario tests)
- Validate the `list_decisions → update_decision / record_decision` instruction contract

**Non-Goals:**
- Testing migration rollback (migration is additive/non-destructive)
- Performance or load testing
- Testing the AI's actual decision-writing quality (that's behavioural, not testable here)
- Modifying production code to enable testability — only DI patterns already present

## Decisions

### TD1: `helpers.ts` DDL update is the prerequisite for all backend tests

The `initDb()` function in `src/bun/test/helpers.ts` uses inline DDL — it does NOT run the migrations runner. The new `decisions_injected_after_compaction_id INTEGER NULL` column must be added to the inline `conversations` table DDL before any `DecisionContextInjector` tests can run. This is a one-line change and must be the first task.

**Alternative considered**: Create a separate `initDbWithDecisions()` helper. Rejected — duplicates the entire schema; inline DDL update is simpler and keeps all tests on the same schema.

### TD2: `StubDecisionContextInjector` via subclass, not interface extraction

The existing test doubles (`StubStreamProcessor`, `StubWorkdirResolver`) subclass the real classes rather than extracting interfaces. `DecisionContextInjector` should follow the same pattern: a `StubDecisionContextInjector extends DecisionContextInjector` that overrides `prepare()` to return a configurable value.

**Why**: Avoids adding an interface to production code just for tests. The existing pattern is DI via constructor, which is already clean enough.

**Alternative considered**: Extract `IDecisionContextInjector` interface. Acceptable but unnecessary overhead — defer until a second implementation is needed.

### TD3: `decision-context-injector.test.ts` mirrors `cross-engine-context.test.ts` exactly

Pattern: `initDb()` + `seedProjectAndTask()` + `appendMessage()` for compaction anchor seeding. Seed `decisions_injected_after_compaction_id` directly via `db.run("UPDATE conversations …")`. No factory function needed — the injector takes only `db` in its constructor.

### TD4: `decision-submission.test.ts` is a pure function test — no DB

`buildDecisionSubmission(answers)` is a pure transformation. Tests call it directly with `DecisionAnswer[]` inputs and assert on `userContent` / `engineContent` string content. Specifically:
- `engineContent` must contain the phrase `list_decisions()` (check first step)
- `engineContent` must contain `update_decision` (update path)
- `engineContent` must contain `record_decision` (create path)
- `engineContent` must contain `NEVER` (prohibition on duplicates)

### TD5: Handler integration tests use `initDb()` + real handler invocation

`tasks.submitDecisions` and `chatSessions.submitDecisions` are tested by calling the handler functions directly with a test DB (not through HTTP). Same pattern as existing handler tests. The orchestrator's `executeHumanTurn` / `executeChatTurn` can be stubbed via a `TestEngine` (already defined in `transition-executor.test.ts`).

### TD6: Playwright tests extend `interview-me.spec.ts` with new suite T-L through T-O

New tests are added as a new `test.describe` block at the bottom of the existing file rather than a new file. They reuse the same `makeInterviewPrompt` helper. `tasks.submitDecisions` is mocked via `api.handle("tasks.submitDecisions", ...)` — the `ApiMock` type will need to include the new RPC method (added as part of the production change to `rpc-types.ts`).

**T-E update**: The existing T-E test must be updated to mock `tasks.submitDecisions` instead of `tasks.sendMessage`. The test intent is unchanged.

## Risks / Trade-offs

- **[Risk] `helpers.ts` DDL diverges from real migrations** → Accepted. All tests use `initDb()`. The inline DDL is intentionally a simplified snapshot; it must be kept in sync manually when new columns are added.
- **[Risk] `StubDecisionContextInjector` hides bugs if `prepare()` is never called** → Mitigation: one of the `HumanTurnExecutor` tests verifies `prepare()` was actually called (via a call-count flag on the stub).
- **[Risk] Playwright `api.handle("tasks.submitDecisions")` won't type-check until `rpc-types.ts` is updated** → Tests should be written alongside the production change that adds the RPC type; task ordering in tasks.md reflects this.

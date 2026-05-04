## Why

The `decision-request` change introduces a new DB layer, AI toolset, engine context refactor, and multiple frontend surfaces — all with no test coverage. Tests need to be written as a dedicated follow-up so implementation risks are verified without inflating the feature change's scope.

## What Changes

- **New test file** `src/bun/test/decision-repository.test.ts` — unit tests for all `DecisionRepository` methods and `buildSystemBlock` formatting
- **Extend `helpers.ts` `initDb()`** — add `decision_batches`, `decision_records`, `decision_revisions` DDL so all backend unit tests share the new schema
- **New test file** `src/bun/test/decision-handlers.test.ts` — integration tests for `decisions.list` and `decisions.getRevisions` RPC handlers with in-memory DB
- **Extend `src/bun/test/tasks-tools.test.ts`** — add 10 scenarios covering the 4 new AI tools (`record_decision`, `list_decisions`, `update_decision`, `delete_decision`) and decision-specific `CommonToolContext` shape
- **Extend `src/bun/test/execution-params-builder.test.ts`** — add 4 scenarios for `DecisionRepository` injection and `buildSystemBlock` appending
- **Extend `src/bun/test/handlers.test.ts`** — add 4 atomic persistence scenarios for `tasks.sendMessage` + `chatSessions.sendMessage` with `decisionBatch`
- **Extend `src/bun/test/common-tools-registration.test.ts`** — rename `interview_me` → `decision_request`; add assertions for all 5 decision tools
- **Extend `src/bun/test/stream-processor.test.ts`** — rename `interview_me` event → `decision_request`; add 3 scenarios for event persistence and state transitions
- **Extend `src/bun/test/copilot-rpc-scenarios.test.ts`** — rename `interview_me` suspension test; add 3 scenarios: `record_decision` does not suspend, decisions visible after resume, `list_decisions` returns conversation-scoped results
- **Extend `src/bun/test/claude-rpc-scenarios.test.ts`** — 2 scenarios: `decision_request` suspension and `record_decision` non-suspension via Claude adapter
- **Extend `src/bun/test/db-migrations.test.ts`** — 4 assertions: 3 new tables exist post-migration, FK constraints, index presence, idempotency
- **Rename `e2e/ui/interview-me.spec.ts` → `decision-request.spec.ts`** — update all `interview_me`/`interview_prompt` refs; add 3 new Playwright specs (decisionBatch payload sent on submit, component fills drawer width, answers are read-only after resume)
- **New Playwright spec `e2e/ui/decisions-panel.spec.ts`** — 8 scenarios: tab visibility, empty state, weight grouping, AI-recorded badge, revision badge, tab switching, `conversationId` routing
- **Extend `e2e/ui/task-drawer.spec.ts`** — 1 scenario: Decisions tab visible in task drawer toolbar
- **Extend `e2e/ui/chat-session-drawer.spec.ts`** — 3 scenarios: Decisions tab in session, Chat is default, session's `conversationId` is used

## Capabilities

### New Capabilities

- `decision-record-tests`: All test coverage for `DecisionRepository`, decision AI tools, atomic `sendMessage` persistence, `ExecutionParamsBuilder` injection, migration schema assertions, and `DecisionsPanel` Playwright specs

### Modified Capabilities

- `engine-decision-common-tool`: Test renames from `interview_me` → `decision_request` in registration, RPC scenario, and stream-processor tests
- `engine-execution-params`: Extended `ExecutionParamsBuilder` tests for `DecisionRepository` injection

## Impact

- **Test files modified**: 9 existing files extended or renamed; 3 new files created
- **No production code changes** — this change is tests only
- **`helpers.ts` DDL extension**: adds 3 tables to `initDb()`; affects all backend test files that depend on it (additive, non-breaking)
- **Playwright fixtures**: `e2e/ui/fixtures/index.ts` gains a `decisions.list` baseline stub (empty array)
- **Dependency**: must be implemented after `decision-request` change is fully applied

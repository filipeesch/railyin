## Why

The `decision-request-improvements` feature introduces new backend services (`DecisionContextInjector`, `buildDecisionSubmission`), removes auto-save from the frontend, adds a new DB column, and changes the submission RPC from `sendMessage` to dedicated `submitDecisions` methods — all without tests. This change creates the full test suite to cover the feature safely before it ships.

## What Changes

- New unit test file `src/bun/test/decision-context-injector.test.ts` — 7 tests for injection logic
- New unit test file `src/bun/test/decision-repository.test.ts` — 10 tests for `buildContextBlock`, `markDecisionsInjected`, `getLastInjectedCompactionId`
- New unit test file `src/bun/test/decision-submission.test.ts` — 8 tests for `buildDecisionSubmission` (Q/A format, general notes, hidden instruction with `list_decisions`/`update_decision`/`record_decision` contract)
- Updated `src/bun/test/helpers.ts` — add `decisions_injected_after_compaction_id INTEGER NULL` to inline DDL
- Updated `src/bun/test/human-turn-executor.test.ts` — add `StubDecisionContextInjector`, 3 new tests
- Updated `src/bun/test/transition-executor.test.ts` — add `DecisionContextInjector` to factory, 2 new tests
- Updated `src/bun/test/execution-params-builder.test.ts` — decisions no longer in `systemInstructions`
- Updated `src/bun/test/common-tools-registration.test.ts` — verify ALWAYS/NEVER in `record_decision` description and `update_decision` mention in `decision_request` description
- New integration test file `src/bun/test/decision-handlers.test.ts` — 4 tests for `tasks.submitDecisions` and `chatSessions.submitDecisions`
- Updated `e2e/ui/interview-me.spec.ts` — T-E calls `tasks.submitDecisions`; new T-L/M/N/O for general notes and submitDecisions routing
- Updated `e2e/ui/chat-session-drawer.spec.ts` — CD-D-6 calls `chatSessions.submitDecisions`

## Capabilities

### New Capabilities

- `decision-context-injector-tests`: Unit tests for `DecisionContextInjector` — sentinel logic, first-turn injection, post-compaction re-injection, idempotency
- `decision-repository-extended-tests`: Unit tests for the extended `DecisionRepository` — `buildContextBlock` XML format, injection tracking methods
- `decision-submission-tests`: Unit tests for `buildDecisionSubmission` — Q/A formatting, general notes, hidden instruction contract (list→update-or-create)
- `decision-submission-handler-tests`: Integration tests for `tasks.submitDecisions` and `chatSessions.submitDecisions` handlers
- `decision-request-ui-tests`: Playwright tests for general notes field, `submitDecisions` routing, submit behavior changes

### Modified Capabilities

- `decision-context-injector`: Tests extend the spec with `StubDecisionContextInjector` DI pattern used in executor tests
- `decision-submission-rpc`: Tests cover the hidden instruction contract — `list_decisions()` + `update_decision`/`record_decision` branch logic
- `engine-execution-params`: Tests verify decisions are absent from `systemInstructions`

## Impact

- `src/bun/test/helpers.ts` — prerequisite DDL change
- `src/bun/test/` — 3 new test files, 5 updated test files
- `e2e/ui/interview-me.spec.ts` — updated T-E + 4 new tests
- `e2e/ui/chat-session-drawer.spec.ts` — updated CD-D-6
- No production code changes — test-only

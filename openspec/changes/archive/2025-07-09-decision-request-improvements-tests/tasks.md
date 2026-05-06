## 0. Prerequisites

- [x] 0.1 Update `src/bun/test/helpers.ts` inline DDL — add `decisions_injected_after_compaction_id INTEGER NULL` to the `conversations` table `CREATE TABLE` statement

## 1. Backend Unit Tests — New Files

- [x] 1.1 Create `src/bun/test/decision-repository.test.ts` — 10 tests: `buildContextBlock` XML format (DR-1 through DR-5), `markDecisionsInjected` and `getLastInjectedCompactionId` round-trips (DR-6 through DR-10)
- [x] 1.2 Create `src/bun/test/decision-context-injector.test.ts` — 7 tests: DCI-1 through DCI-7 covering NULL sentinel, first-turn injection, post-compaction re-injection, no-records guard, XML format, idempotency
- [x] 1.3 Create `src/bun/test/decision-submission.test.ts` — 8 tests: DS-1 through DS-8 covering Q/A formatting, general notes inclusion/exclusion, `engineContent` containing `list_decisions()`, `update_decision`, `record_decision`, and `NEVER`

## 2. Backend Unit Tests — Updates

- [x] 2.1 Update `src/bun/test/execution-params-builder.test.ts` — assert `systemInstructions` does NOT contain decision content after the feature change; verify `DecisionRepository` is no longer a constructor dependency
- [x] 2.2 Update `src/bun/test/common-tools-registration.test.ts` — add 3 tests: `record_decision` description contains `ALWAYS`; `record_decision` description contains `NEVER`; `decision_request` description references `record_decision` obligation
- [x] 2.3 Update `src/bun/test/human-turn-executor.test.ts` — add `StubDecisionContextInjector extends DecisionContextInjector` with configurable return and call-count; add `DecisionContextInjector` to `makeExecutor()` factory; add 3 tests: HTE-D-1 (block prepended), HTE-D-2 (undefined → no prepend), HTE-D-3 (prepare() called)
- [x] 2.4 Update `src/bun/test/transition-executor.test.ts` — add `DecisionContextInjector` to executor factory; add 2 tests verifying decisions block prepended to transition prompt when `prepare()` returns a block

## 3. Handler Integration Tests

- [x] 3.1 Create `src/bun/test/decision-handlers.test.ts` — 4 tests: DH-1 (userContent in persisted message), DH-2 (response shape), DH-3 (chatSessions routes to executeChatTurn), DH-4 (`sendMessage` no longer processes decisionBatch)

## 4. Playwright E2E Tests

- [x] 4.1 Update `e2e/ui/interview-me.spec.ts` T-E — change mock from `tasks.sendMessage` to `tasks.submitDecisions`; assert `tasks.sendMessage` is NOT called
- [x] 4.2 Update `e2e/ui/interview-me.spec.ts` — add suite T-L/M/N/O: general notes textarea visible (T-L), notes in message bubble (T-M), no notes section when empty (T-N), `tasks.submitDecisions` called on submit (T-O)
- [x] 4.3 Update `e2e/ui/chat-session-drawer.spec.ts` CD-D-6 — change mock from `chatSessions.sendMessage` to `chatSessions.submitDecisions`

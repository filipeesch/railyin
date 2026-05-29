## 1. Infrastructure & Shared Helpers

- [ ] 1.1 Extract `TestEngine`, `CapturingParamsBuilder`, `StubWorkdirResolver`, `StubStreamProcessor` from `human-turn-executor.test.ts` into new `src/bun/test/executor-test-helpers.ts`
- [ ] 1.2 Update `human-turn-executor.test.ts` to import the 4 stubs from `./executor-test-helpers` (remove inline definitions)

## 2. Unit Tests — New Shared Query Helpers

- [ ] 2.1 Create `src/bun/test/task-queries.test.ts` — TQ-1 through TQ-4: `fetchTaskWithModel` with model, null model, missing id, and git context columns
- [ ] 2.2 Add TQ-5 through TQ-7 to same file: `fetchChatSessionWithModel` with model, null model, missing id

## 3. Unit Tests — TaskRepository

- [ ] 3.1 Create `src/bun/test/task-repository.test.ts` — TR-MODEL-1: `TaskRepository.findById` returns task with correct model from conversations JOIN

## 4. Integration Tests — Backend Handler & Executor Push Paths

- [ ] 4.1 Extend `src/bun/test/handlers.test.ts` — add `sessionUpdates: ChatSession[]` capture array (replace `() => {}` with capturing callback in setModel/create/rename/archive tests)
- [ ] 4.2 Add CS-SET-1: `chatSessions.setModel` — captured session has `model === 'test/model'`
- [ ] 4.3 Add CS-SET-2: `chatSessions.setModel` — HTTP response body has `model === 'test/model'`
- [ ] 4.4 Add CS-CREATE-1: `chatSessions.create` — pushed session has correct model
- [ ] 4.5 Add CS-RENAME-1: `chatSessions.rename` — pushed session preserves model
- [ ] 4.6 Add CS-ARCHIVE-1: `chatSessions.archive` — pushed session preserves model
- [ ] 4.7 Extend `src/bun/test/orchestrator.test.ts` — add OC-MODEL-1: cancel push has `taskUpdates.last.model === 'fake/fake'`
- [ ] 4.8 Add OSA-MODEL-1: shell approval push has `taskUpdates.last.model === 'fake/fake'`
- [ ] 4.9 Extend `src/bun/test/transition-executor.test.ts` — add TE-MODEL-1: `result.task.model === 'fake/fake'`
- [ ] 4.10 Create `src/bun/test/code-review-executor.test.ts` (imports stubs from `executor-test-helpers`) — add CR-MODEL-1: `onTaskUpdated` receives task with `model === 'fake/fake'`

## 5. Frontend Store Tests

- [ ] 5.1 Extend `src/mainview/stores/task.test.ts` — add T-MODEL-1: `onTaskUpdated` with `model = 'test/model'` preserves it in `taskIndex`
- [ ] 5.2 Add T-MODEL-2: `onTaskUpdated` with `model = null` stores null (correct passthrough)
- [ ] 5.3 Extend `src/mainview/stores/chat.test.ts` — add C-MODEL-1: `onChatSessionUpdated` with `model = 'test/model'` preserves it in `sessions`
- [ ] 5.4 Add C-MODEL-2: `onChatSessionUpdated` with `model = null` stores null

## 6. Playwright E2E Tests

- [ ] 6.1 Extend `e2e/ui/model-persistence.spec.ts` — add MP-E1: session WS push with same model does not reset dropdown
- [ ] 6.2 Add MP-E2: session WS push with different model updates dropdown
- [ ] 6.3 Add MP-F1: task WS push with same model does not reset dropdown
- [ ] 6.4 Add MP-F2: task WS push with different model updates dropdown

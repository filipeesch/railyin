## 1. Shared Test Infrastructure

- [ ] 1.1 Extend `src/bun/test/helpers.ts` `initDb()` DDL to include `decision_batches`, `decision_records`, and `decision_revisions` table definitions (matching production migration schema)
- [ ] 1.2 Add `decisions.list → []` baseline stub to `e2e/ui/fixtures/index.ts` so existing Playwright specs that open task or session drawers don't break when `DecisionsPanel` mounts

## 2. DecisionRepository Unit Tests

- [ ] 2.1 Create `src/bun/test/decision-repository.test.ts` using `initDb()` + `new DecisionRepository(db)` pattern; cover all `createRecord` field assertions (DR-1, DR-2)
- [ ] 2.2 Add `updateRecord` revision scenarios: single update inserts revision row + increments count; double update yields `revision_count = 2` (DR-3, DR-4)
- [ ] 2.3 Add `deleteRecord` soft-delete assertion: `is_deleted = 1`, row not removed (DR-5)
- [ ] 2.4 Add `listByConversation` scenarios: excludes deleted, weight ordering, excludes other conversations (DR-6, DR-7, DR-8)
- [ ] 2.5 Add `getRevisions` ordering scenario: returns revisions in `revised_at ASC` (DR-9)
- [ ] 2.6 Add `buildSystemBlock` empty-state scenarios: no records → `""`, all deleted → `""` (DR-10, DR-11)
- [ ] 2.7 Add `buildSystemBlock` formatting scenarios: weight ordering, revision metadata lines, `[AI-recorded]` tag, header presence (DR-12 through DR-16)
- [ ] 2.8 Add `createBatch` + batch-linked record scenario (DR-17, DR-18)

## 3. Migration Tests

- [ ] 3.1 Extend `src/bun/test/db-migrations.test.ts`: assert `decision_batches`, `decision_records`, `decision_revisions` tables exist after running migrations on a fresh in-memory DB
- [ ] 3.2 Add FK constraint assertion: inserting a `decision_records` row with invalid `batch_id` raises an error
- [ ] 3.3 Add index existence assertion: `PRAGMA index_list('decision_records')` includes the `(conversation_id, is_deleted)` index
- [ ] 3.4 Add idempotency assertion: calling `runMigrations()` on an already-migrated DB throws no error

## 4. RPC Handler Tests

- [ ] 4.1 Create `src/bun/test/decision-handlers.test.ts` using `initDb()` + `seedProjectAndTask()` + handler injection; cover `decisions.list` empty, scoped, excludes-deleted, weight-ordered scenarios (DH-1 through DH-5)
- [ ] 4.2 Add `decisions.getRevisions` scenarios: empty array for unrevised record, chronological order for revised record (DH-6, DH-7)

## 5. Tool Unit Tests

- [ ] 5.1 Update `commonCtx()` fixture in `src/bun/test/tasks-tools.test.ts` to the nested `CommonToolContext` shape (`task.conversationId`, `repos.todos`, `repos.decisions`, etc.)
- [ ] 5.2 Add `record_decision` scenarios: stores record with `is_source_ai = 1`, defaults weight to `medium`, explicit weight stored correctly (DT-1, DT-2, DT-3)
- [ ] 5.3 Add `list_decisions` scenarios: returns conversation-scoped records, empty when none (DT-4, DT-5)
- [ ] 5.4 Add `update_decision` scenarios: persists revision + increments count when reason provided; returns validation error when reason missing (DT-6, DT-7)
- [ ] 5.5 Add `delete_decision` scenarios: soft-deletes record; excluded from subsequent `list_decisions` (DT-8, DT-9)
- [ ] 5.6 Add `record_decision` result type assertion: tool returns a result type, NOT a suspend (DT-10)

## 6. ExecutionParamsBuilder Tests

- [ ] 6.1 Update `src/bun/test/execution-params-builder.test.ts` to pass a stub `DecisionRepository` to `new ExecutionParamsBuilder(decisionRepo)`; stub returns `""` by default
- [ ] 6.2 Add `build()` appends decision block scenario: stub returns non-empty block → `systemInstructions` ends with block (EPB-new-1)
- [ ] 6.3 Add `build()` no-append scenario: stub returns `""` → `systemInstructions` unchanged (EPB-new-2)
- [ ] 6.4 Add `buildForChat()` appends block scenario (EPB-new-3)
- [ ] 6.5 Add `buildForChat()` no-append scenario (EPB-new-4)

## 7. sendMessage Atomic Persistence Tests

- [ ] 7.1 Extend `src/bun/test/handlers.test.ts`: call `tasks.sendMessage` with a `decisionBatch`; assert `decision_batches` + `decision_records` rows written with correct `conversation_id` (SM-1, SM-2)
- [ ] 7.2 Add regression scenario: `tasks.sendMessage` without `decisionBatch` works unchanged, no decision rows created (SM-3)
- [ ] 7.3 Add `chatSessions.sendMessage` atomic persistence scenario: batch and records written in same transaction as user message (SM-4)

## 8. Common Tools Registration Tests

- [ ] 8.1 Rename all `interview_me` references in `src/bun/test/common-tools-registration.test.ts` to `decision_request`; update `baseContext` fixture to nested `CommonToolContext` shape
- [ ] 8.2 Add assertions for all 5 decision tool registrations: `decision_request`, `record_decision`, `list_decisions`, `update_decision`, `delete_decision` present in `COMMON_TOOL_DEFINITIONS`
- [ ] 8.3 Add Copilot mapped-tools registration assertions for all 5 decision tools
- [ ] 8.4 Add Claude tool server registration assertions for all 5 decision tools
- [ ] 8.5 Add `record_decision` result type assertion (returns result, not suspend)
- [ ] 8.6 Add `update_decision` validation: missing reason returns error (REG-new-11)
- [ ] 8.7 Add `delete_decision` confirmation string assertion (REG-new-12)

## 9. RPC Scenario Integration Tests

- [ ] 9.1 Rename `interview_me` suspension test in `src/bun/test/copilot-rpc-scenarios.test.ts` → `decision_request` (COP-1)
- [ ] 9.2 Add `record_decision` non-suspension Copilot scenario: tool called → execution completes normally (COP-2)
- [ ] 9.3 Add `list_decisions` conversation-scoped Copilot scenario: returns only current conversation's records (COP-4)
- [ ] 9.4 Rename `interview_me` suspension test in `src/bun/test/claude-rpc-scenarios.test.ts` → `decision_request` (CLA-1)
- [ ] 9.5 Add `record_decision` non-suspension Claude scenario (CLA-2)

## 10. Stream Processor Tests

- [ ] 10.1 Rename `interview_me` event in `src/bun/test/stream-processor.test.ts` → `decision_request` (SP-1 rename)
- [ ] 10.2 Add `decision_request` event assertion: persists `decision_request_prompt` message type (SP-1)
- [ ] 10.3 Add `decision_request` event assertion: sets execution state to `waiting_user` (SP-2)

## 11. Playwright Tests

- [ ] 11.1 Rename `e2e/ui/interview-me.spec.ts` → `decision-request.spec.ts`; update all `interview_me`/`interview_prompt`/`makeInterviewPrompt`/`InterviewMe` refs to `decision_request`/`decision_request_prompt`/`makeDecisionRequestPrompt`/`DecisionRequest`
- [ ] 11.2 Add T-H: submit sends `decisionBatch` payload — capture `tasks.sendMessage` body and assert `decisionBatch.records[0].question` and `.answer` are present
- [ ] 11.3 Add T-I: decision_request component fills full drawer width — assert component width equals parent container width (no overflow)
- [ ] 11.4 Add T-J: answers are read-only after resume — submitted answers appear as non-interactive text in conversation
- [ ] 11.5 Create `e2e/ui/decisions-panel.spec.ts`: Decisions tab visible in task drawer toolbar (DP-1)
- [ ] 11.6 Add DP-2: switching to Decisions tab renders `DecisionsPanel` component
- [ ] 11.7 Add DP-3: empty state message shown when `decisions.list` returns `[]`
- [ ] 11.8 Add DP-4: decision records grouped by weight (critical section above easy section)
- [ ] 11.9 Add DP-5: `[AI-recorded]` badge shown for `is_source_ai = true` records
- [ ] 11.10 Add DP-6: revision badge shown for `revision_count > 0` records
- [ ] 11.11 Add DP-7: switching back to Chat tab shows conversation
- [ ] 11.12 Add DP-8: `decisions.list` called with task's `conversationId` (capture mock call params)
- [ ] 11.13 Extend `e2e/ui/task-drawer.spec.ts`: assert Decisions tab visible alongside existing tabs (TD-1)
- [ ] 11.14 Extend `e2e/ui/chat-session-drawer.spec.ts`: Decisions tab present in session view (CSD-1); Chat is default active tab (CSD-2); session's `conversationId` used for `decisions.list` (CSD-3)

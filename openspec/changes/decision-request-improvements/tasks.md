## 1. Database & Repository

- [ ] 1.1 Add migration `042_decisions_injection_tracking.ts` — `ALTER TABLE conversations ADD COLUMN decisions_injected_after_compaction_id INTEGER NULL`
- [ ] 1.2 Update `ConversationRow` in `src/bun/db/row-types.ts` to add `decisions_injected_after_compaction_id: number | null`
- [ ] 1.3 Update `DecisionRepository`: rename `buildSystemBlock` → `buildContextBlock` (return `<decisions>…</decisions>` XML block), add `markDecisionsInjected(conversationId, compactionSummaryId)` and `getLastInjectedCompactionId(conversationId)` methods

## 2. DecisionContextInjector

- [ ] 2.1 Create `src/bun/conversation/decision-context-injector.ts` with `DecisionContextInjector` class — constructor accepts `Database`, `prepare(conversationId)` returns `{ decisionsBlock: string | undefined }` with sentinel-0 and compaction-tracking logic

## 3. Wire Injection into Executors

- [ ] 3.1 Remove `DecisionRepository` from `ExecutionParamsBuilder` constructor and remove the `buildSystemBlock`/`buildContextBlock` call from `_buildBase()`
- [ ] 3.2 Update `HumanTurnExecutor` — construct `DecisionContextInjector`, call `prepare(conversationId)`, prepend `decisionsBlock` to `userContent` alongside `historyBlock`
- [ ] 3.3 Update `TransitionExecutor` — same injection pattern as `HumanTurnExecutor`

## 4. Tool Descriptions

- [ ] 4.1 Update `record_decision` description in `src/bun/engine/common-tools.ts` — add ALWAYS (call after every `decision_request` response) / NEVER (do not skip or defer) language
- [ ] 4.2 Update `decision_request` tool definition in `src/bun/engine/decision-request-tool-definition.ts` — reference obligation to call `record_decision` after user submits answers

## 5. Decision Submission RPC

- [ ] 5.1 Add `DecisionAnswer` interface to `src/shared/rpc-types.ts`; add `tasks.submitDecisions` and `chatSessions.submitDecisions` RPC signatures; remove `decisionBatch` from `sendMessage` params
- [ ] 5.2 Create `src/bun/conversation/decision-submission.ts` with `buildDecisionSubmission(answers: DecisionAnswer[]): { userContent: string; engineContent: string }`
- [ ] 5.3 Implement `tasks.submitDecisions` handler in `src/bun/handlers/tasks.ts` and remove `decisionBatch` processing from `tasks.sendMessage`
- [ ] 5.4 Implement `chatSessions.submitDecisions` handler in `src/bun/handlers/chat-sessions.ts` and remove `decisionBatch` processing from `chatSessions.sendMessage`

## 6. Frontend Wiring

- [ ] 6.1 Add `submitDecisions(taskId, answers)` to task store and `submitDecisions(sessionId, answers)` to chat session store in `src/mainview/stores/`
- [ ] 6.2 Update `MessageBubble.vue` `onInterviewSubmit` — call `taskStore.submitDecisions` / `chatStore.submitDecisions` instead of `sendMessage`; remove `decisionBatch` and `engineText` construction from this path

## 7. Cleanup

- [ ] 7.1 Remove `DecisionInput` and `DecisionBatch` types from `src/shared/rpc-types.ts` if no longer referenced
- [ ] 7.2 Remove any dead `decisionBatch`-related code from frontend stores after the `sendMessage` params are updated

## ADDED Requirements

### Requirement: tasks.submitDecisions and chatSessions.submitDecisions RPC methods handle decision submission
The system SHALL expose `tasks.submitDecisions({ taskId: number; answers: DecisionAnswer[] })` and `chatSessions.submitDecisions({ sessionId: number; answers: DecisionAnswer[] })` RPC methods. Both SHALL use a shared `buildDecisionSubmission(answers)` helper from `src/bun/conversation/decision-submission.ts` that returns `{ userContent: string; engineContent: string }`. `userContent` SHALL contain the formatted Q&A text visible to the user. `engineContent` SHALL contain `userContent` plus a hidden plain-text instruction directing the AI to: for each answer, (1) call `list_decisions()` to check if a record already exists for that question, (2) if found call `update_decision(id, newAnswer, reason)` with a brief reason (e.g. "user re-answered via decision_request"), (3) if not found call `record_decision(question, answer, weight, notes?)`. The instruction SHALL use NEVER language to prohibit creating duplicate records. Both methods SHALL route to the existing orchestrator execute methods (`executeHumanTurn` for tasks, `executeChatTurn` for chat sessions) using `engineContent` as the engine-side content.

#### Scenario: tasks.submitDecisions formats Q&A and triggers execution
- **WHEN** `tasks.submitDecisions({ taskId: 1, answers: [{ question: "Q?", answer: "A", weight: "critical" }] })` is called
- **THEN** the orchestrator receives `userContent = "Q: Q?\nA: A"` as the visible message and `engineContent` with the hidden instruction appended

#### Scenario: chatSessions.submitDecisions routes to executeChatTurn
- **WHEN** `chatSessions.submitDecisions({ sessionId: 1, answers: [...] })` is called
- **THEN** `orchestrator.executeChatTurn` is called with engineContent containing the hidden instruction

#### Scenario: answers with notes are included in formatted text
- **WHEN** an answer has a non-empty `notes` field
- **THEN** `userContent` includes a `Notes: <notes>` line after the answer

### Requirement: DecisionAnswer type is defined in rpc-types.ts
The system SHALL define `DecisionAnswer` in `src/shared/rpc-types.ts` with fields `question: string`, `answer: string`, `weight: string`, and `notes?: string | null`. The `DecisionBatch`-related parameters SHALL be removed from `tasks.sendMessage` and `chatSessions.sendMessage` params.

#### Scenario: sendMessage no longer accepts decisionBatch
- **WHEN** `tasks.sendMessage` or `chatSessions.sendMessage` is called
- **THEN** neither method accepts or processes a `decisionBatch` parameter

#### Scenario: DecisionAnswer is usable from frontend
- **WHEN** `MessageBubble.vue` imports `DecisionAnswer` from `@shared/rpc-types`
- **THEN** the type compiles with the expected fields

### Requirement: MessageBubble.vue calls submitDecisions for decision_request_prompt responses
`MessageBubble.vue`'s `onInterviewSubmit` handler SHALL call `taskStore.submitDecisions` or `chatStore.submitDecisions` instead of the `sendMessage` variants. It SHALL pass the structured answer array directly without constructing `engineContent` or `decisionBatch` in the component.

#### Scenario: Decision submission does not construct engineContent in Vue
- **WHEN** `onInterviewSubmit` fires
- **THEN** no `engineContent` or `engineText` is constructed in the Vue component for the decision path; the store method receives only `{ taskId/sessionId, answers }`

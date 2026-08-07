## MODIFIED Requirements

### Requirement: tasks.submitDecisions and chatSessions.submitDecisions RPC methods handle decision submission
The system SHALL expose `tasks.submitDecisions({ taskId: number; answers: DecisionAnswer[]; generalNotes?: string; recordAsDecisions?: boolean })` and `chatSessions.submitDecisions({ sessionId: number; answers: DecisionAnswer[]; generalNotes?: string; recordAsDecisions?: boolean })` RPC methods. Both SHALL use a shared `buildDecisionSubmission(answers, generalNotes?, recordAsDecisions = true)` helper from `src/bun/conversation/decision-submission.ts` that returns `{ userContent: string; engineContent: string }`. `userContent` SHALL contain the formatted Q&A text visible to the user. `engineContent` SHALL contain `userContent` plus a hidden plain-text instruction. When `recordAsDecisions` is `true`, the instruction directs the AI to: for each answer, (1) call `list_decisions()` to check if a record already exists for that question, (2) if found call `update_decision(id, newAnswer, reason)` with a brief reason (e.g. "user re-answered via decision_request"), (3) if not found call `record_decision(question, answer, weight, notes?)`. The instruction SHALL use NEVER language to prohibit creating duplicate records. When `recordAsDecisions` is `false`, the engineContent SHALL instead include an instruction telling the model these are questions (not decisions) and to NOT call `record_decision` or `update_decision`. Both methods SHALL route to the existing orchestrator execute methods (`executeHumanTurn` for tasks, `executeChatTurn` for chat sessions) using `engineContent` as the engine-side content.

#### Scenario: tasks.submitDecisions formats Q&A and triggers execution
- **WHEN** `tasks.submitDecisions({ taskId: 1, answers: [{ question: "Q?", answer: "A", weight: "critical" }] })` is called
- **THEN** the orchestrator receives `userContent = "Q: Q?\nA: A"` as the visible message and `engineContent` with the hidden instruction appended

#### Scenario: chatSessions.submitDecisions routes to executeChatTurn
- **WHEN** `chatSessions.submitDecisions({ sessionId: 1, answers: [...] })` is called
- **THEN** `orchestrator.executeChatTurn` is called with engineContent containing the hidden instruction

#### Scenario: answers with notes are included in formatted text
- **WHEN** an answer has a non-empty `notes` field
- **THEN** `userContent` includes a `Notes: <notes>` line after the answer

#### Scenario: hidden instruction update path
- **WHEN** `buildDecisionSubmission` is called with `recordAsDecisions: true` (default)
- **THEN** `engineContent` instructs the AI to check `list_decisions()` and call `update_decision` for existing records before falling back to `record_decision`
- **AND** `engineContent` contains `NEVER` prohibiting duplicate creation

#### Scenario: recordAsDecisions false skips recording instructions
- **WHEN** `buildDecisionSubmission` is called with `recordAsDecisions: false`
- **THEN** `engineContent` contains a directive to NOT call `record_decision` or `update_decision`
- **AND** `engineContent` does NOT contain the `list_decisions()` instruction

#### Scenario: recordAsDecisions false keeps identical userContent
- **WHEN** `buildDecisionSubmission` is called with `recordAsDecisions: false`
- **THEN** `userContent` is formatted identically to when `recordAsDecisions` is `true`

#### Scenario: tasks.submitDecisions passes recordAsDecisions to buildDecisionSubmission
- **WHEN** `tasks.submitDecisions({ taskId: 1, answers: [...], recordAsDecisions: false })` is called
- **THEN** `buildDecisionSubmission` is invoked with `recordAsDecisions = false`

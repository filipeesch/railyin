## Purpose
Integration-level test specifications for the `tasks.submitDecisions` and `chatSessions.submitDecisions` RPC handlers — verifying correct formatting, orchestrator routing, and legacy `decisionBatch` removal.

## Requirements

### Requirement: tasks.submitDecisions handler — formats and routes submission
The `tasks.submitDecisions` handler SHALL use `buildDecisionSubmission(answers)` and call `orchestrator.executeHumanTurn` with the resulting `userContent`/`engineContent`.

#### Scenario: DH-1 — userContent in persisted message
- **WHEN** `tasks.submitDecisions({ taskId, answers })` is called
- **THEN** the persisted conversation message contains the formatted Q/A from `buildDecisionSubmission`

#### Scenario: DH-2 — response shape
- **WHEN** `tasks.submitDecisions` succeeds
- **THEN** it returns `{ message, executionId }` matching the shape of `sendMessage`

### Requirement: chatSessions.submitDecisions handler — same behavior for sessions
The `chatSessions.submitDecisions` handler SHALL behave identically to `tasks.submitDecisions` for chat sessions.

#### Scenario: DH-3 — chatSessions.submitDecisions routes to executeChatTurn
- **WHEN** `chatSessions.submitDecisions({ sessionId, answers })` is called
- **THEN** `orchestrator.executeChatTurn` is called with the formatted content

#### Scenario: DH-4 — tasks.sendMessage no longer processes decisionBatch
- **WHEN** `tasks.sendMessage` is called with a `decisionBatch` param
- **THEN** no decision records are created (the param is ignored or rejected)

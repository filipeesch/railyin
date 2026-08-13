## MODIFIED Requirements

### Requirement: Submit is active only at waiting_user
The interview panel SHALL allow the user to fill answers at any time, but the Submit button SHALL be disabled until the terminal `decision_request_prompt` is persisted (turn end → `waiting_user`). Submitting SHALL use the existing `submitDecisions` RPC path (task and chat-session variants) with the answers accumulated across pages. The panel SHALL derive this gate from the task/session execution state (`waiting_user`), not from answer completeness alone.

#### Scenario: Submit disabled while streaming
- **WHEN** the execution is still running and pages are streaming
- **THEN** the Submit button is disabled (user can still fill answers and navigate pages)

#### Scenario: Submit gated even with all answers filled while running
- **WHEN** all questions are answered while the execution is still running (pages streaming)
- **THEN** the Submit button remains disabled (the gate is `waiting_user`, not answer completeness)

#### Scenario: Submit enabled after turn end
- **WHEN** the terminal `decision_request_prompt` is persisted and the task/session is `waiting_user`
- **THEN** the Submit button is enabled on the last page
- **AND** submitting routes through the existing `tasks.submitDecisions` / `chatSessions.submitDecisions` RPC

## ADDED Requirements

### Requirement: Superseded turn-end flush is discarded
When an engine run's turn-end flush would emit the terminal `decision_request` event, the stream processor SHALL discard it — no `decision_request_prompt` persistence, no execution/task state change, no `waiting_user` transition — if the execution has been superseded. For task-backed executions, superseded means `tasks.current_execution_id` no longer references this execution. For chat-session executions, superseded means a newer execution exists for the same conversation. This keeps the invariant that a terminal prompt is never persisted after the user's answer to that interview.

#### Scenario: Task superseded by a newer execution
- **WHEN** the user submitted answers while the model was still streaming (a newer execution started) and the old execution's turn-end flush fires afterward
- **THEN** no `decision_request_prompt` is persisted
- **AND** the task is not flipped to `waiting_user`

#### Scenario: Session superseded by a newer execution
- **WHEN** a newer chat execution exists for the conversation when the old execution's turn-end flush fires
- **THEN** the flush is discarded (no persist, no state change)

#### Scenario: Current execution flush persists normally
- **WHEN** the flushing execution is still the current one for the task/session
- **THEN** the `decision_request_prompt` is persisted and the task/session transitions to `waiting_user` as before

### Requirement: Terminal prompt reconcile is never dropped
The frontend conversation store SHALL exempt `decision_request_prompt` messages from the "stream not done" append guard so the live→persisted reconcile (clearing live pages and execution tracking) always runs when the terminal prompt arrives. Live interview state (`liveInterviews`, `liveInterviewExecutions`) SHALL be cleared when the active conversation is closed so stale pages cannot resurface on drawer reopen.

#### Scenario: Terminal prompt accepted mid-stream
- **WHEN** the terminal `decision_request_prompt` message push arrives while the stream state is not yet marked done
- **THEN** the message is appended
- **AND** the live interview state is cleared (reconcile runs)

#### Scenario: Live state cleared on conversation close
- **WHEN** the user closes the drawer / the active conversation is set to null
- **THEN** the conversation's live interview pages and execution tracking are cleared

## ADDED Requirements

### Requirement: Engine flushes one pending message after execution ends
After each execution for a task ends and the task's `execution_state` transitions to `waiting_user` or `idle`, the engine SHALL check the `pending_messages` table for that task. If a pending message exists, the engine SHALL delete the oldest one and call `handleHumanTurn` for that task asynchronously (fire-and-forget). Only one pending message SHALL be flushed per execution end.

#### Scenario: Pending message flushed after execution reaches waiting_user
- **WHEN** an execution ends with `execution_state` becoming `waiting_user` and a pending message exists for that task
- **THEN** the oldest pending message is deleted from `pending_messages` and `handleHumanTurn` is called asynchronously with its content

#### Scenario: Pending message flushed after execution reaches idle
- **WHEN** an execution ends with `execution_state` becoming `idle` and a pending message exists for that task
- **THEN** the oldest pending message is deleted from `pending_messages` and `handleHumanTurn` is called asynchronously with its content

#### Scenario: Only one pending message flushed per execution end
- **WHEN** an execution ends and multiple pending messages exist for the task
- **THEN** only the oldest pending message is flushed; the remaining messages stay in `pending_messages` to be flushed in subsequent executions

#### Scenario: No pending messages leaves state unchanged
- **WHEN** an execution ends and no pending messages exist for the task
- **THEN** no flush occurs and the task remains in its ended execution state

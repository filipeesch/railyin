## ADDED Requirements

### Requirement: StreamProcessor finally block drains needs_column_prompt before pending_messages
When a task execution reaches its terminal state, the `StreamProcessor.consume()` finally block SHALL:
1. Check `needs_column_prompt` on the task row. If set, clear it and fire `transitionExecutor.execute()` asynchronously (non-blocking).
2. Only if `needs_column_prompt` was NOT set, check `pending_messages` for the task and drain each queued message via `humanTurnExecutor.execute()`.

The two drains are mutually exclusive per execution end. Column prompt takes priority because it establishes the task's new execution context; pending messages are delivered after the column prompt execution ends.

#### Scenario: needs_column_prompt fires on execution end
- **WHEN** a task execution ends with `needs_column_prompt = 1` on the task row
- **THEN** `needs_column_prompt` is set to `0`
- **AND** `transitionExecutor.execute(taskId, task.workflow_state)` is called (fires column prompt)
- **AND** `pending_messages` drain is NOT run in the same finally block

#### Scenario: pending_messages drained when no column prompt pending
- **WHEN** a task execution ends with `needs_column_prompt = 0` and there are rows in `pending_messages` for the task
- **THEN** each pending message is delivered via `humanTurnExecutor.execute()` in insertion order
- **AND** the `pending_messages` rows for the task are deleted

#### Scenario: No drain when both flags absent
- **WHEN** a task execution ends with `needs_column_prompt = 0` and no `pending_messages` rows
- **THEN** the finally block behaves as before — only `onTaskUpdated` is called with the final task state

#### Scenario: TransitionExecutor and HumanTurnExecutor injected into StreamProcessor
- **WHEN** `new StreamProcessor(db, ..., transitionExecutor, humanTurnExecutor)` is called
- **THEN** the instance uses the provided executors for drain operations and does not construct them internally

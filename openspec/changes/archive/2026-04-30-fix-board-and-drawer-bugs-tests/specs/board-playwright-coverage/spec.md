## ADDED Requirements

### Requirement: Card badge reflects running state after drop onto prompted column
`e2e/ui/board-dnd.spec.ts` SHALL include DND-10 verifying that after a successful drag-and-drop to a column with `on_enter_prompt`, the card's execution state badge reflects the `running` state returned in the `tasks.transition` response.

#### Scenario: DND-10 — card badge shows running after drop to prompted column
- **WHEN** the `tasks.transition` mock returns a task with `executionState: 'running'`
- **AND** the user drops a card onto a prompted column
- **THEN** the task card's execution badge shows the running state without a page reload

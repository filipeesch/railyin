## ADDED Requirements

### Requirement: False-failure path unlocks send button after done event
`e2e/ui/stream-reactivity.spec.ts` SHALL include E-X verifying that when a task transitions to `failed` execution state while still streaming, the send button becomes enabled and the streaming indicator is dismissed once a `done` stream event is received.

#### Scenario: E-X — send button re-enables after failed + done
- **WHEN** a task's execution state is updated to `failed` via `task.updated` push
- **AND** a `done` stream event is subsequently pushed for that execution
- **THEN** the streaming indicator is dismissed
- **AND** the send/submit button is enabled (not disabled)

### Requirement: Chat scroll position is stable during active token streaming
`e2e/ui/stream-reactivity.spec.ts` SHALL include E-Y verifying that the conversation body remains scrolled to the bottom throughout active streaming, checked across multiple mid-stream checkpoints, not only at the end.

#### Scenario: E-Y — scroll stays at bottom across mid-stream checkpoints
- **WHEN** tokens are pushed in three batches of five text_chunk events each
- **THEN** after each batch, `scrollTop + clientHeight >= scrollHeight - 40` is true
- **AND** no mid-stream checkpoint shows the viewport having left the bottom

## ADDED Requirements

### Requirement: Pi gauge shows accurate usage after first turn
For Pi engine tasks, the context gauge SHALL display accurate token usage after the first turn completes. Before the first turn, the gauge SHALL remain hidden (context window is unknown). The gauge SHALL NOT display the 128,000 token fallback for Pi sessions.

#### Scenario: Pi gauge hidden before first turn
- **WHEN** a Pi task drawer opens before any execution has run
- **THEN** the gauge shows "Context usage unavailable" (no `usage` event has been emitted yet, so token count N is unknown)
- **NOTE** The context window size W is known immediately from `listModels()` via the provider's `/models` endpoint, but N is only known after the first `turn_end`

#### Scenario: Pi gauge shows real values after first turn
- **WHEN** a Pi execution completes at least one turn
- **AND** a `{ type: "usage", inputTokens: N }` event updates the execution's token count
- **THEN** the gauge shows `N / W` tokens with the correct percentage and colour, where W comes from `listModels().contextWindow`

#### Scenario: Pi gauge updates on subsequent turns
- **WHEN** a Pi execution completes additional turns
- **AND** the `usage` EngineEvent updates `input_tokens` in the executions table
- **THEN** the gauge re-fetches and updates to reflect the new token count

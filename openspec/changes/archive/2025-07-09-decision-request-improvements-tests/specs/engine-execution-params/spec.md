## MODIFIED Requirements

### Requirement: systemInstructions no longer contains decision content
After the `decision-request-improvements` feature, `ExecutionParamsBuilder.build()` and `buildForChat()` SHALL NOT include any decision records content in `systemInstructions`. The `DecisionRepository` SHALL NOT be a constructor dependency of `ExecutionParamsBuilder`.

#### Scenario: build() — no decisions in systemInstructions
- **WHEN** `ExecutionParamsBuilder.build()` is called with an active conversation that has decision records
- **THEN** the returned `ExecutionParams.systemInstructions` does NOT contain any decision record text

#### Scenario: buildForChat() — no decisions in systemInstructions
- **WHEN** `ExecutionParamsBuilder.buildForChat()` is called with a conversation that has decision records
- **THEN** the returned params have no decision content in `systemInstructions`

## MODIFIED Requirements

### Requirement: ExecutionParamsBuilder injects decision records into systemInstructions
`ExecutionParamsBuilder` SHALL accept a `DecisionRepository` constructor parameter and append the formatted decision block to `systemInstructions` in both `build()` and `buildForChat()` when non-empty.

#### Scenario: build() appends decision block when records exist
- **WHEN** `build()` is called and the injected `DecisionRepository.buildSystemBlock()` returns a non-empty string
- **THEN** `systemInstructions` in the returned `ExecutionParams` ends with the decision block

#### Scenario: build() does not append when no records exist
- **WHEN** `build()` is called and `buildSystemBlock()` returns `""`
- **THEN** `systemInstructions` does not contain `## Decision Records` and has no trailing whitespace added

#### Scenario: buildForChat() appends decision block when records exist
- **WHEN** `buildForChat()` is called and `buildSystemBlock()` returns a non-empty string
- **THEN** `systemInstructions` in the result ends with the decision block

#### Scenario: buildForChat() does not append when no records exist
- **WHEN** `buildForChat()` is called and `buildSystemBlock()` returns `""`
- **THEN** `systemInstructions` is unchanged relative to the no-decisions baseline

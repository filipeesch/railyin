## ADDED Requirements

### Requirement: decision_request tool description does not mandate decision recording
`decision_request` TOOL DEFINITION SHALL NOT contain text instructing the model to always call `record_decision` after user submission (e.g. the line "After the user submits answers, call record_decision... for EVERY question — never skip this step" SHALL be removed). The description SHALL keep all other fields (weight, model_lean, answers_affect_followup, etc.) intact.

#### Scenario: Tool description omits mandatory record_decision instruction
- **WHEN** `DECISION_REQUEST_TOOL_DEFINITION.description` is inspected
- **THEN** it does NOT contain "call record_decision" or "never skip this step"

#### Scenario: Tool description retains other fields
- **WHEN** `DECISION_REQUEST_TOOL_DEFINITION.description` is inspected
- **THEN** it still mentions `weight`, `model_lean`, and `answers_affect_followup`

### Requirement: record_decision tool description reflects toggle-driven usage
`record_decision`'s description in `COMMON_TOOL_DEFINITIONS` SHALL NOT contain the blanket instruction "ALWAYS call this tool after every decision_request response." It SHALL instead reflect that recording is controlled by the user's "Record as decisions" toggle choice.

#### Scenario: record_decision description lacks unconditional mandate
- **WHEN** `COMMON_TOOL_DEFINITIONS` finds the `record_decision` tool
- **THEN** the description does NOT contain "ALWAYS call this tool after every decision_request response"

#### Scenario: record_decision description still links to list_decisions
- **WHEN** `COMMON_TOOL_DEFINITIONS` finds the `record_decision` tool
- **THEN** the description still mentions `list_decisions()` and `update_decision`

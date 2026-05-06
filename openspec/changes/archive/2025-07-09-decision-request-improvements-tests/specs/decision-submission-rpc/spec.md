## MODIFIED Requirements

### Requirement: buildDecisionSubmission hidden instruction includes update_decision path
The hidden instruction in `engineContent` SHALL direct the AI to call `list_decisions()` first and then branch to `update_decision` for existing records or `record_decision` for new ones. The previous requirement only mentioned `record_decision`.

#### Scenario: hidden instruction update path
- **WHEN** `buildDecisionSubmission` is called
- **THEN** `engineContent` instructs the AI to check `list_decisions()` and call `update_decision` for existing records before falling back to `record_decision`
- **AND** `engineContent` contains `NEVER` prohibiting duplicate creation

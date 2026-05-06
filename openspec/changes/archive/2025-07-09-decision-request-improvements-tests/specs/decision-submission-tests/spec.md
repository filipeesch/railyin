## ADDED Requirements

### Requirement: buildDecisionSubmission — Q/A format in userContent
`buildDecisionSubmission(answers)` SHALL return `userContent` containing each answer as `Q: <question>\nA: <answer>`.

#### Scenario: DS-1 — single answer
- **WHEN** called with one answer `{ question: "Q?", answer: "A" }`
- **THEN** `userContent` contains `"Q: Q?\nA: A"`

#### Scenario: DS-2 — multiple answers
- **WHEN** called with two answers
- **THEN** `userContent` contains both Q/A pairs

### Requirement: buildDecisionSubmission — general notes in userContent
If answers include a `generalNotes` string, it SHALL be appended to `userContent` as `\n\n---\n\nGeneral notes: <value>`.

#### Scenario: DS-3 — with general notes
- **WHEN** `generalNotes = "some context"` is present
- **THEN** `userContent` ends with `"General notes: some context"`

#### Scenario: DS-4 — without general notes
- **WHEN** no `generalNotes` is present
- **THEN** `userContent` does NOT contain `"General notes"`

### Requirement: buildDecisionSubmission — hidden instruction in engineContent
`engineContent` SHALL equal `userContent` plus a hidden instruction block that directs the AI to call `list_decisions()` first, then `update_decision` or `record_decision`.

#### Scenario: DS-5 — engineContent contains list_decisions reference
- **WHEN** `buildDecisionSubmission` is called with any answers
- **THEN** `engineContent` contains the string `list_decisions()`

#### Scenario: DS-6 — engineContent contains update_decision reference
- **WHEN** `buildDecisionSubmission` is called with any answers
- **THEN** `engineContent` contains `update_decision`

#### Scenario: DS-7 — engineContent contains record_decision reference
- **WHEN** `buildDecisionSubmission` is called with any answers
- **THEN** `engineContent` contains `record_decision`

#### Scenario: DS-8 — engineContent contains NEVER prohibition
- **WHEN** `buildDecisionSubmission` is called with any answers
- **THEN** `engineContent` contains `NEVER` to prohibit duplicate creation

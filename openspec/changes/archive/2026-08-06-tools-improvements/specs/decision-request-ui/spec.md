## ADDED Requirements

### Requirement: DecisionRequest component has a "Record as decisions" checkbox
`DecisionRequest.vue` SHALL render a checkbox labeled "Record as decisions" near the Submit button, checked by default. The checkbox SHALL be independent of question type and always visible. Its state SHALL be included in the submit emit payload as `recordAsDecisions: boolean`.

#### Scenario: Toggle renders on all question types
- **WHEN** a decision request form with exclusive, non_exclusive, or freetext questions is rendered
- **THEN** the "Record as decisions" checkbox is visible

#### Scenario: Toggle defaults to true
- **WHEN** the form first renders
- **THEN** the "Record as decisions" checkbox is checked

#### Scenario: Unchecking toggle allows submission
- **WHEN** the user unchecks "Record as decisions" and all questions are answered
- **THEN** the Submit button is enabled and submission proceeds with `recordAsDecisions: false`

#### Scenario: Toggle state included in submit payload
- **WHEN** the user clicks Submit
- **THEN** the emitted payload includes `recordAsDecisions` matching the checkbox state

### Requirement: "Other" textarea is visible whenever __other__ is selected
`DecisionRequest.vue` SHALL render the "Other" free-text textarea when `__other__` is selected in a `non_exclusive` question's checkbox selection — regardless of which option row has focus. The desc-area visibility condition SHALL be based on selection state (`isSelected(qi, q, '__other__')`) rather than focus state (`focusedOption[qi] === '__other__'`).

#### Scenario: Other textarea shows when __other__ checked without focus
- **WHEN** the user clicks the "Other" checkbox (without separately clicking the "Other" row)
- **THEN** the "Other" textarea is visible and ready for input

#### Scenario: Submitting with __other__ selected and text filled enables submit
- **WHEN** `__other__` is checked and the "Other" textarea contains text
- **THEN** the Submit button is enabled

#### Scenario: Regular option description still shows when no __other__ selected
- **WHEN** `__other__` is not selected and the user has focused a regular option row
- **THEN** that option's description is rendered in the desc-area

### Requirement: DecisionRequest validation and formatting logic is extracted to testable utilities
The validation (`canSubmit`), answer formatting (`parts` text and `decisions` array), and selection-state logic from `DecisionRequest.vue` SHALL be extracted into a plain TypeScript module at `src/mainview/utils/decisionRequest.ts`. `DecisionRequest.vue` SHALL import and call these pure functions rather than inlining the logic. The module SHALL export: `canSubmitDecisionRequest(questions, state)`, `buildDecisionAnswerParts(questions, state)`, `buildDecisionAnswers(questions, state)`, `isOptionSelected(question, title, state)`, and `buildSubmissionText(questions, state, generalNotes)`.

#### Scenario: Utility functions are importable without Vue runtime
- **WHEN** a test imports `canSubmitDecisionRequest` from `src/mainview/utils/decisionRequest.ts`
- **THEN** it executes without needing Vue SFC compilation or DOM environment

#### Scenario: Component delegates canSubmit to utility
- **WHEN** `DecisionRequest.vue` computes its `canSubmit`
- **THEN** it calls `canSubmitDecisionRequest` with the current per-question state

#### Scenario: Component delegates answer formatting to utilities
- **WHEN** `DecisionRequest.vue` builds the submit payload in `submit()`
- **THEN** it calls `buildDecisionAnswerParts` and `buildDecisionAnswers` to produce the `text` and `decisions` arrays respectively

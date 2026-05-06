## ADDED Requirements

### Requirement: DecisionRequest.vue always renders an optional general notes textarea
`DecisionRequest.vue` SHALL render a general notes textarea below all question sections and above the Submit button. The textarea SHALL be visible on every decision form regardless of question count or type. It SHALL be optional — an empty value SHALL NOT block form submission. The label SHALL read "Additional context" with an "(optional)" qualifier. The placeholder SHALL be "Anything else the AI should know when recording these decisions…". When the textarea contains text at submit time, it SHALL be appended to the `text` payload as `\n\n---\n\nGeneral notes: <value>`. The `generalNotes` ref SHALL be reset to `""` when `props.questions` changes.

#### Scenario: Form submits without general notes
- **WHEN** the user leaves the general notes textarea empty and clicks Submit
- **THEN** the emitted `text` does not contain "General notes" and submission proceeds normally

#### Scenario: General notes appended to submission text
- **WHEN** the user types "Consider cost constraints" in the general notes field and clicks Submit
- **THEN** the emitted `text` ends with `\n\n---\n\nGeneral notes: Consider cost constraints`

#### Scenario: General notes reset on question change
- **WHEN** `props.questions` changes (new decision_request received)
- **THEN** `generalNotes` is reset to `""` so the previous text does not carry over

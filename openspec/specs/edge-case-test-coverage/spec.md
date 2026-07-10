# Edge Case Test Coverage

## Purpose

Test coverage for edge cases in executeCommonTool, decision-context-injector, and decision-submission formatting.

## Requirements

### Requirement: executeCommonTool edge cases handle string-encoded arguments
The `executeCommonTool` function MUST handle edge cases when tool arguments are string-encoded or malformed.

#### Scenario: decision_request with string-encoded questions
- **WHEN** `executeCommonTool` receives `questions: "[{\"question\":\"...\",\"type\":\"exclusive\"}]"` (JSON string instead of array)
- **THEN** AJV validation returns an error: "questions must be array"

#### Scenario: decision_request with empty string in questions
- **WHEN** `executeCommonTool` receives `questions: [""]` (array with empty string question)
- **THEN** AJV validation returns an error: "question is required field"

#### Scenario: decision_request with null question value
- **WHEN** `executeCommonTool` receives `questions: [{ question: null, type: "exclusive" }]`
- **THEN** validation rejects the null question value

#### Scenario: tool with object parameter receives string
- **WHEN** a tool with `type: "object"` parameter receives a string value
- **THEN** AJV validation returns the expected type error

### Requirement: decision-context-injector handles edge cases
The `DecisionContextInjector` MUST handle edge cases in decision record storage and retrieval.

#### Scenario: No decisions exist
- **WHEN** `prepare()` is called on a conversation with zero decision records
- **THEN** the method returns `decisionsBlock: undefined`
- **AND** marks decisions as injected (sentinel 0) so no further checks are needed

#### Scenario: Sentence decision records exist
- **WHEN** `prepare()` is called on a conversation with decision records
- **THEN** the method returns a `decisionsBlock` string containing all records formatted for the system prompt

#### Scenario: Already injected decisions for current compaction
- **WHEN** `prepare()` is called and last injected compaction ID equals current compaction ID
- **THEN** the method returns `decisionsBlock: undefined` (no duplicate injection)

#### Scenario: New compaction after injection
- **WHEN** `prepare()` is called after a new compaction has occurred (current compaction ID > last injected)
- **THEN** the method returns `decisionsBlock` with all records and marks as injected

### Requirement: decision-submission formatting handles all edge cases
The `buildDecisionSubmission` function MUST format all combinations of answers and notes correctly.

#### Scenario: Answers with multiline notes
- **WHEN** an answer has notes containing newlines and markdown
- **THEN** the notes appear on a single line in userContent with the `Notes:` prefix

#### Scenario: Mix of weighted answers
- **WHEN** answers have mixed weights: `critical`, `medium`, `easy`
- **THEN** each weight is formatted with its uppercase bracket label: `[CRITICAL]`, `[MEDIUM]`, `[EASY]`

#### Scenario: Engine content includes hidden instructions
- **WHEN** `buildDecisionSubmission` is called
- **THEN** engineContent contains the instruction to call `list_decisions()`, `record_decision()`, and `update_decision()`
- **AND** userContent does NOT contain these hidden instructions

#### Scenario: Empty answers array
- **WHEN** `buildDecisionSubmission` receives an empty answers array
- **THEN** userContent and engineContent are both empty strings or minimal valid content

#### Scenario: General notes with markdown formatting
- **WHEN** generalNotes contains markdown (bold, lists, code blocks)
- **THEN** the markdown is preserved in the output after the `---` separator

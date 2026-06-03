## ADDED Requirements

### Requirement: decision_request validates options count per question type
The system SHALL validate that every `exclusive` or `non_exclusive` question in a `decision_request` call provides at least 2 distinct options. This validation SHALL occur at two layers:

1. **Schema layer**: The `options` array in the `questions` items schema SHALL have `minItems: 2`, so AJV reports the violation via the existing `validateToolArgs` path.
2. **Runtime layer**: `executeCommonTool` SHALL check, after schema validation passes, that each question where `type !== "freetext"` has `options.length >= 2`. If the check fails, it SHALL return a `{ type: "result", text: "<error>" }` — never the `suspend` path — with an error message that: names the offending question index, states the minimum required count, and instructs the model not to embed options in the question text.

`freetext` questions SHALL NOT be subject to the options-count check.

#### Scenario: exclusive question with fewer than 2 options is rejected
- **WHEN** `decision_request` is called with a question of `type: "exclusive"` and `options` array of length 1
- **THEN** `executeCommonTool` returns `{ type: "result", text: <error> }` (not suspend)
- **AND** the error text contains a message about the minimum required options count

#### Scenario: non_exclusive question with fewer than 2 options is rejected
- **WHEN** `decision_request` is called with a question of `type: "non_exclusive"` and `options` array of length 0
- **THEN** `executeCommonTool` returns `{ type: "result", text: <error> }` (not suspend)

#### Scenario: freetext question with no options is accepted
- **WHEN** `decision_request` is called with a question of `type: "freetext"` and no `options` field
- **THEN** `executeCommonTool` proceeds to the suspend path (not rejected)

#### Scenario: exclusive question with 2 or more options is accepted
- **WHEN** `decision_request` is called with a question of `type: "exclusive"` and `options` array of length 2
- **THEN** `executeCommonTool` proceeds to the suspend path

### Requirement: decision_request tool description is concise and non-redundant
The `DECISION_REQUEST_TOOL_DEFINITION` description string SHALL NOT repeat information already present in field-level descriptions. The top-level description SHALL state: (a) when to use the tool, (b) that options MUST NOT be embedded in question text, and (c) the `exclusive`/`non_exclusive` minimum of 2 options. Field descriptions SHALL own the details of their own structure.

#### Scenario: Description does not duplicate field-level guidance
- **WHEN** the `DECISION_REQUEST_TOOL_DEFINITION` is inspected
- **THEN** the top-level `description` string does not repeat constraints already present in the `parameters.properties` field descriptions

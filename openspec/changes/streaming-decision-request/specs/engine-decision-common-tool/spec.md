## Purpose

Specification for the common decision-related tools registered in the engine tool registry: `decision_request`, `record_decision`, `list_decisions`, `update_decision`, `delete_decision`, and the atomic persistence of `decisionBatch` in `sendMessage`.

## Requirements

### Requirement: decision_request accepts a single question per call
The `decision_request` tool SHALL accept one question object per call (`{ context?, question: {...} }`) rather than an array of questions. The question object SHALL declare `required: ["question", "type"]`, with `type` as an enum (`exclusive` | `non_exclusive` | `freetext`), `options` as an array with `minItems: 2` for choice questions, and optional `weight`, `model_lean`, `model_lean_reason`, `answers_affect_followup`, and per-question `context` guidance. The tool description SHALL instruct the model to call once per question, repeat to add more, and END ITS TURN to present the interview.

#### Scenario: decision_request schema is single-question
- **WHEN** the `DECISION_REQUEST_TOOL_DEFINITION` is inspected
- **THEN** its `parameters.properties` contain a `question` object (with nested `required: ["question", "type"]`) and an optional `context` string
- **AND** no `questions` array property exists

#### Scenario: Valid single question appends and streams
- **WHEN** `executeCommonTool("decision_request", { question: {...} }, ctx)` is called with a valid question
- **THEN** the question is appended to the execution buffer and the result is `{ type: "page", text, payload }`

#### Scenario: Invalid single question returns error without buffer mutation
- **WHEN** `executeCommonTool("decision_request", { question: { question: "Pick?" } }, ctx)` is called (missing `type`)
- **THEN** the result is `{ type: "result", text }` where text names `question.type` and lists the valid enum values
- **AND** the buffer is unchanged

#### Scenario: decision_request registration in common-tools
- **WHEN** the common tool registry is inspected
- **THEN** `decision_request` is registered and `interview_me` is absent

### Requirement: record_decision allows silent AI decision logging
The system SHALL expose a `record_decision` tool that allows the AI to persist a decision record without suspending execution or prompting the user. The tool SHALL accept `question` (string), `answer` (string), and optional `weight` (enum: `critical` | `medium` | `easy`, default `medium`). On success, it SHALL create a `decision_records` row with `is_source_ai = 1` and return a confirmation string. The tool SHALL NOT trigger the `waiting_user` state.

#### Scenario: AI records decision without interrupting execution
- **WHEN** the AI calls `record_decision` with question, answer, and weight
- **THEN** a decision record is persisted with `is_source_ai = 1` and execution continues immediately

### Requirement: list_decisions returns non-deleted records for the conversation
The system SHALL expose a `list_decisions` tool that returns all non-deleted `decision_records` for the current conversation, ordered by weight descending. Each record SHALL include `id`, `question`, `answer`, `weight`, `is_source_ai`, and `revision_count`.

#### Scenario: list_decisions returns current conversation records
- **WHEN** the AI calls `list_decisions`
- **THEN** it receives a JSON array of non-deleted records for the active conversationId

### Requirement: update_decision appends a revision with required reason
The system SHALL expose an `update_decision` tool that accepts `id` (number), `answer` (string), and `reason` (string, REQUIRED). It SHALL append a revision row and increment `revision_count`. The `reason` field is required to prevent AI oscillation loops.

#### Scenario: update_decision without reason is rejected
- **WHEN** the AI calls `update_decision` without a `reason` field
- **THEN** `executeCommonTool` returns a validation error and no revision is written

### Requirement: delete_decision soft-deletes a record
The system SHALL expose a `delete_decision` tool that accepts `id` (number) and sets `is_deleted = 1`. The record SHALL remain in the database for audit purposes but SHALL be excluded from all read operations.

#### Scenario: Deleted record excluded from subsequent reads
- **WHEN** the AI calls `delete_decision` with a valid id
- **THEN** subsequent `list_decisions` calls do not include the deleted record

## Purpose

Specification for the common decision-related tools registered in the engine tool registry: `decision_request`, `record_decision`, `list_decisions`, `update_decision`, `delete_decision`, and the atomic persistence of `decisionBatch` in `sendMessage`.

## Requirements

### Requirement: decision_request accepts a single flat question per call
The `decision_request` tool SHALL accept ONE question per call with a FLAT, top-level shape (`{ context?, question: string, type, weight?, model_lean?, model_lean_reason?, answers_affect_followup?, options? }`) rather than an array of questions or a nested `question` object. The schema SHALL declare `required: ["question", "type"]`, with `type` as an enum (`exclusive` | `non_exclusive` | `freetext`), `options` as an array with `minItems: 2` for choice questions, and optional `weight`, `model_lean`, `model_lean_reason`, `answers_affect_followup`, and per-question `context`. The tool description SHALL instruct the model to call once per question with flat top-level fields, repeat to add more, and END ITS TURN to present the interview.

#### Scenario: decision_request schema is single flat question
- **WHEN** the `DECISION_REQUEST_TOOL_DEFINITION` is inspected
- **THEN** its `parameters.properties` contain a `question` STRING and sibling top-level `type`, `weight`, `model_lean`, `options`, etc.
- **AND** no `questions` array property and no nested `question` object property exists

#### Scenario: Valid flat question appends and streams
- **WHEN** `executeCommonTool("decision_request", { question: "Pick?", type: "freetext" }, ctx)` is called with a valid flat question
- **THEN** the question is appended to the execution buffer and the result is `{ type: "page", text, payload }`

#### Scenario: Invalid flat question returns error without buffer mutation
- **WHEN** `executeCommonTool("decision_request", { question: "Pick?" }, ctx)` is called (missing `type`)
- **THEN** the result is `{ type: "result", text }` where text names `type` and lists the valid enum values
- **AND** the buffer is unchanged

#### Scenario: decision_request stream event persists decision_request_prompt message
- **WHEN** the stream processor processes a `decision_request` event
- **THEN** a `ConversationMessage` of type `decision_request_prompt` is persisted

#### Scenario: decision_request tool registration in common-tools
- **WHEN** the common tool registry is inspected
- **THEN** `decision_request` is registered and `interview_me` is absent

### Requirement: record_decision tool creates a record without suspending

The `record_decision` tool SHALL create a `decision_record` with `is_source_ai = 1` and return a result (not suspend) so execution continues uninterrupted.

#### Scenario: record_decision stores record scoped to current conversation
- **WHEN** `record_decision` is called with question, answer, and weight
- **THEN** a record exists in `decision_records` with `conversation_id` matching the current execution's conversation and `is_source_ai = 1`

#### Scenario: record_decision defaults weight to medium
- **WHEN** `record_decision` is called without a weight argument
- **THEN** the stored record has `weight = "medium"`

#### Scenario: record_decision does not suspend Copilot execution
- **WHEN** the Copilot engine calls `record_decision` during an execution
- **THEN** the execution continues and completes normally (does not transition to `waiting_user`)

#### Scenario: record_decision does not suspend Claude execution
- **WHEN** the Claude engine calls `record_decision` during an execution
- **THEN** the execution continues and completes normally

### Requirement: list_decisions tool returns conversation-scoped records

The `list_decisions` tool SHALL return all non-deleted records for the current execution's `conversationId`, ordered by weight descending.

#### Scenario: list_decisions returns empty when no records exist
- **WHEN** `list_decisions` is called on a conversation with no records
- **THEN** the tool returns an empty array or equivalent empty-state message

#### Scenario: list_decisions excludes records from other conversations
- **WHEN** multiple conversations have decision records
- **THEN** `list_decisions` returns only records for the current execution's conversation

### Requirement: update_decision requires a reason and appends a revision

The `update_decision` tool SHALL reject calls missing the `reason` field and, when valid, append a revision row.

#### Scenario: update_decision without reason returns validation error
- **WHEN** `update_decision` is called without a `reason` argument
- **THEN** the tool returns an error message without modifying any records

#### Scenario: update_decision with reason persists the revision
- **WHEN** `update_decision` is called with a new answer and a reason
- **THEN** a row is inserted in `decision_revisions` and `revision_count` increments on the record

### Requirement: delete_decision soft-deletes the record

The `delete_decision` tool SHALL soft-delete the target record and confirm to the AI.

#### Scenario: delete_decision marks record as deleted
- **WHEN** `delete_decision` is called with a valid record id
- **THEN** `is_deleted = 1` in `decision_records` and the record is excluded from `list_decisions`

### Requirement: sendMessage atomic persistence of decisionBatch

Both `tasks.sendMessage` and `chatSessions.sendMessage` SHALL persist the `decisionBatch` in the same SQLite transaction as the user message, before execution starts.

#### Scenario: sendMessage with decisionBatch persists batch and records
- **WHEN** `tasks.sendMessage` is called with a `decisionBatch` containing records
- **THEN** a `decision_batches` row and corresponding `decision_records` rows are written to the DB with the correct `conversation_id`

#### Scenario: sendMessage without decisionBatch works unchanged
- **WHEN** `tasks.sendMessage` is called without `decisionBatch`
- **THEN** the message is persisted and execution starts (regression — no decision rows created)

#### Scenario: chatSessions.sendMessage with decisionBatch persists atomically
- **WHEN** `chatSessions.sendMessage` is called with a `decisionBatch`
- **THEN** the batch and records are written in the same transaction as the user message

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

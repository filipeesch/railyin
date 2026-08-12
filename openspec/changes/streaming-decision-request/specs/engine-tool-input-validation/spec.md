## Purpose

Defines the AJV-based input validation layer for common tool handlers. All common tool calls are validated against their JSON Schema definitions before handler dispatch, providing consistent, schema-driven error messages to the model.

## Requirements

### Requirement: validateToolArgs validates tool input against its JSON Schema definition
The system SHALL provide a `validateToolArgs(def: AIToolDefinition, args: Record<string, unknown>): string | null` helper that validates the given `args` against `def.parameters` using AJV. It SHALL return `null` when args are valid and a descriptive error string when validation fails. The function SHALL never throw; all AJV errors are caught and converted to a return value. AJV SHALL be configured with `{ allErrors: true }` so every violation in a single call is reported.

#### Scenario: Invalid enum value returns descriptive error
- **WHEN** `validateToolArgs` is called with an arg whose value is not in the schema `enum` list
- **THEN** it returns a string that MATCHES the invalid value AND MATCHES valid options

#### Scenario: Multiple validation errors are all reported
- **WHEN** `validateToolArgs` is called with args that have more than one validation error
- **THEN** all errors are joined and returned as a single string

#### Scenario: Valid args return null
- **WHEN** `validateToolArgs` is called with args that satisfy all schema constraints
- **THEN** it returns `null`

### Requirement: Missing required enum fields report valid values
When a `required` validation error fires for a missing property, the system SHALL look up that property in the schema node at the error path and, if the property declares an `enum`, append the valid values to the error message. This SHALL be generic — it applies to every required field whose schema declares an enum, not just `decision_request`.

#### Scenario: Missing question.type lists valid values
- **WHEN** `validateToolArgs(DECISION_REQUEST_TOOL_DEFINITION, { question: { question: "Pick?" } })` is called
- **THEN** the returned error contains `'question.type' is required`
- **AND** contains `"exclusive"`, `"non_exclusive"`, and `"freetext"`

#### Scenario: Missing enum field on another tool lists its valid values
- **WHEN** `validateToolArgs` is called for a tool whose required enum field is missing
- **THEN** the returned error contains the missing field name and its enum values

#### Scenario: Missing non-enum required field reports field name only
- **WHEN** `validateToolArgs` is called with a missing required field that has no enum
- **THEN** the returned error names the missing field without a values list

### Requirement: executeCommonTool validates args before dispatching to a handler
The system SHALL call `validateToolArgs` at the top of `executeCommonTool` (after normalization) before any handler dispatch. When validation fails, `executeCommonTool` SHALL return `{ type: "result", text: "<error-message>" }` immediately without invoking any handler or mutating state.

#### Scenario: Invalid decision_request returns error without buffer mutation
- **WHEN** `executeCommonTool("decision_request", { question: { question: "Q" } }, ctx)` is called (missing `type`)
- **THEN** the returned text MATCHES `/question.type/` and the decision buffer is unchanged

#### Scenario: Valid args pass through to handler
- **WHEN** a model calls a tool with fully valid typed args
- **THEN** `executeCommonTool` proceeds to handler dispatch and returns the handler's result

### Requirement: decision_request validates options count per question type
The system SHALL validate that every `exclusive` or `non_exclusive` question in a `decision_request` call provides at least 2 distinct options. This validation SHALL occur at two layers:

1. **Schema layer**: The `options` array in the question schema SHALL have `minItems: 2`.
2. **Runtime layer**: `executeCommonTool` SHALL check, after schema validation passes, that a question with `type !== "freetext"` has `options.length >= 2`. If the check fails, it SHALL return a `{ type: "result", text: "<error>" }` (never `page` or `suspend`) naming the offending field and instructing the model not to embed options in the question text.

#### Scenario: exclusive question with fewer than 2 options is rejected
- **WHEN** `decision_request` is called with a single `exclusive` question and `options` length 1
- **THEN** `executeCommonTool` returns `{ type: "result", text: <error> }` (not `page`)
- **AND** the error text contains a message about the minimum required options count

#### Scenario: freetext question with no options is accepted
- **WHEN** `decision_request` is called with a single `freetext` question and no `options`
- **THEN** `executeCommonTool` proceeds to the `page` path (not rejected)

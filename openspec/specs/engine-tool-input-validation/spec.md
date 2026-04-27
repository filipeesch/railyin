## Purpose

Defines the AJV-based input validation layer for common tool handlers. All common tool calls are validated against their JSON Schema definitions before handler dispatch, providing consistent, schema-driven error messages to the model.

## Requirements

### Requirement: validateToolArgs validates tool input against its JSON Schema definition
The system SHALL provide a `validateToolArgs(def: AIToolDefinition, args: Record<string, unknown>): string | null` helper that validates the given `args` against `def.parameters` using AJV. It SHALL return `null` when args are valid and a descriptive error string when validation fails. The function SHALL never throw; all AJV errors are caught and converted to a return value. AJV SHALL be configured with `{ allErrors: true }` so every violation in a single call is reported, not just the first.

The test suite for this function SHALL be at `src/bun/test/validate-tool-args.test.ts` and SHALL NOT import any DB setup or orchestrator helpers — it tests the function in pure isolation.

#### Scenario: Invalid enum value returns descriptive error
- **WHEN** `validateToolArgs` is called with an arg whose value is not in the schema `enum` list
- **THEN** it returns a string of the form `"Invalid value '<val>' for '<field>'. Valid values: <a>, <b>, <c>"`
- **THEN** it returns a string that MATCHES the invalid value AND MATCHES valid options

#### Scenario: Missing required field returns descriptive error
- **WHEN** `validateToolArgs` is called with args that omit a field listed in the schema `required` array
- **THEN** it returns a string of the form `"Missing required field: '<field>'"`
- **THEN** it returns a string that MATCHES the missing field name

#### Scenario: Type mismatch returns descriptive error
- **WHEN** `validateToolArgs` is called with an arg whose runtime type does not match the schema `type`
- **THEN** it returns a string of the form `"Field '<field>' must be <expected-type>, got <actual-type>"`
- **THEN** it returns a string that MATCHES the field name

#### Scenario: Multiple validation errors are all reported
- **WHEN** `validateToolArgs` is called with args that have more than one validation error
- **THEN** all errors are joined with newline and returned as a single string

#### Scenario: Valid args return null
- **WHEN** `validateToolArgs` is called with args that satisfy all schema constraints
- **THEN** it returns `null`

### Requirement: executeCommonTool validates args before dispatching to a handler
The system SHALL call `validateToolArgs` at the top of `executeCommonTool` before any handler dispatch. When validation fails, `executeCommonTool` SHALL return `{ type: "result", text: "<error-message>" }` immediately without invoking any handler.

The integration tests for this gate SHALL live alongside existing handler tests in `tasks-tools.test.ts` (for common tool handlers) and `claude-tools.test.ts` (for interview_me and Claude-specific paths). Tests SHALL NOT mock `validateToolArgs` — they pass real invalid args and assert on the returned text.

#### Scenario: Invalid enum triggers early return
- **WHEN** a model calls a tool with an invalid enum value (e.g. `update_todo_status` with `status: "finished"`)
- **THEN** `executeCommonTool` returns a result with the descriptive error string and does not execute the handler

#### Scenario: Invalid enum triggers early return (integration)
- **WHEN** `executeCommonTool("update_todo_status", { id: 1, status: "finished" }, ctx)` is called
- **THEN** the returned `text` MATCHES `/finished/` and the todo status is NOT changed in the DB

#### Scenario: Missing required field triggers early return
- **WHEN** a model calls `get_task` without supplying `task_id`
- **THEN** `executeCommonTool` returns `"Missing required field: 'task_id'"` and does not execute the handler

#### Scenario: Missing required field triggers early return (integration)
- **WHEN** `executeCommonTool("get_task", {}, ctx)` is called
- **THEN** the returned `text` MATCHES `/task_id/` and no DB query is made

#### Scenario: Valid args pass through to handler
- **WHEN** a model calls a tool with fully valid args
- **THEN** `executeCommonTool` proceeds to handler dispatch and returns the handler's result

#### Scenario: Valid args pass through to handler (integration)
- **WHEN** a model calls a tool with fully valid typed args
- **THEN** `executeCommonTool` proceeds to handler dispatch and returns the handler's result

### Requirement: AIToolDefinition.parameters is typed as JSONSchema7
The `parameters` field on `AIToolDefinition` SHALL be typed as `JSONSchema7` from `@types/json-schema`. Tool definitions that already have `enum`, `items`, or nested `properties` SHALL compile without casts.

#### Scenario: Enum field compiles without cast
- **WHEN** a tool definition declares `enum: ["a", "b", "c"]` on a property
- **THEN** TypeScript accepts the definition without a type assertion

#### Scenario: Nested object property compiles without cast
- **WHEN** a tool definition uses `type: "object"` with nested `properties` on an item type
- **THEN** TypeScript accepts the definition without a type assertion

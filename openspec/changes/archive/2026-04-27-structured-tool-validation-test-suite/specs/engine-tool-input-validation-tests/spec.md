## ADDED Requirements

### Requirement: validateToolArgs unit tests cover all error categories
The test suite SHALL include a dedicated unit test file `src/bun/test/validate-tool-args.test.ts` that exercises `validateToolArgs` directly. Tests SHALL cover: invalid enum value (returns message naming the value and listing valid options), missing required field (returns message naming the field), type mismatch (returns message naming field, expected type, and actual type), multiple simultaneous violations (all errors reported), and valid args (returns null). Tests SHALL use at least four distinct tool definitions: `lsp`, `update_todo_status`, `get_task`, and `interview_me`.

#### Scenario: Invalid lsp.operation enum returns named error
- **WHEN** `validateToolArgs` is called for the `lsp` tool with `operation: "invalid_op"`
- **THEN** the returned string mentions `"invalid_op"` and lists valid operation names

#### Scenario: Invalid update_todo_status.status enum returns named error
- **WHEN** `validateToolArgs` is called for `update_todo_status` with `status: "finished"`
- **THEN** the returned string mentions `"finished"` and lists `pending`, `in-progress`, `done`, `blocked`, `deleted`

#### Scenario: Missing required field returns descriptive message
- **WHEN** `validateToolArgs` is called for `get_task` with empty args `{}`
- **THEN** the returned string mentions `"task_id"`

#### Scenario: Multiple violations are all reported
- **WHEN** `validateToolArgs` is called for `create_task` with args missing both `title` and `description`
- **THEN** the returned string mentions both missing fields

#### Scenario: Type mismatch returns descriptive message
- **WHEN** `validateToolArgs` is called for `interview_me` with `questions: "not-an-array"`
- **THEN** the returned string mentions `"questions"` and indicates a type problem

#### Scenario: Valid args return null
- **WHEN** `validateToolArgs` is called for `get_task` with `{ task_id: 42 }`
- **THEN** it returns `null`

#### Scenario: All tool schemas compile in AJV without errors
- **WHEN** `validateToolArgs` is called once for each definition in `COMMON_TOOL_DEFINITIONS` with empty args
- **THEN** none of the calls throw an exception (schema compilation errors surface as thrown errors, not returned strings)

### Requirement: interview_me empty questions array is rejected by validator
The test suite SHALL include a case asserting that `questions: []` is rejected. This requires `minItems: 1` on the `questions` array schema. This test acts as a regression guard ensuring the AJV gate covers the case that the old ad-hoc block handled.

#### Scenario: Empty questions array triggers validation error
- **WHEN** `executeCommonTool("interview_me", { questions: [] }, ctx)` is called
- **THEN** the result type is `"result"` and the text mentions `"questions"` and a minimum items constraint

#### Scenario: Non-empty questions array passes validation
- **WHEN** `executeCommonTool("interview_me", { questions: [validQuestion] }, ctx)` is called with a valid question
- **THEN** the result type is `"suspend"`

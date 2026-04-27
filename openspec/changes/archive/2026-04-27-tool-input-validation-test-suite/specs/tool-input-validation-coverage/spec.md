## ADDED Requirements

### Requirement: validateToolArgs pure unit tests cover all error categories
The test suite SHALL include a dedicated file `src/bun/test/validate-tool-args.test.ts` that tests `validateToolArgs` in isolation (no DB, no context, no network). Tests SHALL cover: enum violations, missing required fields, type mismatches, multiple simultaneous errors, valid args returning null, and unknown extra fields being allowed (AJV `additionalProperties` not set).

#### Scenario: V-1 — Enum violation returns descriptive error
- **WHEN** `validateToolArgs` is called with `{ status: "finished" }` against the `update_todo_status` definition
- **THEN** the returned string MATCHES `/finished/` AND MATCHES `/valid values|enum/i`

#### Scenario: V-2 — Missing required field returns descriptive error
- **WHEN** `validateToolArgs` is called with `{}` against the `get_task` definition (which requires `task_id`)
- **THEN** the returned string MATCHES `/task_id/` AND MATCHES `/required|missing/i`

#### Scenario: V-3 — Wrong type returns descriptive error
- **WHEN** `validateToolArgs` is called with `{ task_id: { nested: true } }` against `get_task`
- **THEN** the returned string MATCHES `/task_id/` AND MATCHES `/number|integer|type/i`

#### Scenario: V-4 — Multiple errors are all reported
- **WHEN** `validateToolArgs` is called with args that have two distinct violations
- **THEN** the returned string contains both violation descriptions (joined by newline or separator)

#### Scenario: V-5 — Valid args return null
- **WHEN** `validateToolArgs` is called with fully valid args for `update_todo_status`
- **THEN** it returns `null`

#### Scenario: V-6 — interview_me with valid exclusive question returns null
- **WHEN** `validateToolArgs` is called with a well-formed exclusive question array
- **THEN** it returns `null`

#### Scenario: V-7 — interview_me with invalid type enum returns error
- **WHEN** `validateToolArgs` is called with `questions: [{ question: "Q?", type: "single_choice", options: [] }]`
- **THEN** the returned string MATCHES `/single_choice/` AND MATCHES `/exclusive|non_exclusive|freetext/`

#### Scenario: V-8 — interview_me with empty questions array returns error
- **WHEN** `validateToolArgs` is called with `questions: []`
- **THEN** the returned string MATCHES `/minItems|at least 1|questions/i`

#### Scenario: V-9 — reorganize_todos items as real array validates correctly
- **WHEN** `validateToolArgs` is called with `items: [{ id: 1, number: 10 }]` against `reorganize_todos`
- **THEN** it returns `null`

#### Scenario: V-10 — reorganize_todos items as string fails type validation
- **WHEN** `validateToolArgs` is called with `items: "[{ id: 1, number: 10 }]"` (stringified) against `reorganize_todos`
- **THEN** the returned string MATCHES `/items/` AND MATCHES `/array|type/i`

#### Scenario: V-11 — All COMMON_TOOL_DEFINITIONS schemas compile in AJV without throwing
- **WHEN** `new Ajv().compile(def.parameters)` is called for every `def` in `COMMON_TOOL_DEFINITIONS`
- **THEN** no exception is thrown for any definition

### Requirement: validateToolArgs handles null/undefined args gracefully
The `validateToolArgs` function SHALL accept `null` or `undefined` as `args` and return a descriptive error rather than throwing.

#### Scenario: V-12 — null args returns error
- **WHEN** `validateToolArgs` is called with `null` as args
- **THEN** the returned string MATCHES `/invalid|null|args/i` and does NOT throw

#### Scenario: V-13 — non-object args returns error
- **WHEN** `validateToolArgs` is called with `"hello"` as args
- **THEN** the returned string MATCHES `/object|invalid/i` and does NOT throw

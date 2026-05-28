## ADDED Requirements

### Requirement: Normalize JSON-string-encoded arguments before SDK validation
The Pi engine's `buildCommonTools()` MUST create tool definitions with `prepareArguments` that JSON-parses string values when the tool's JSON Schema indicates the parameter should be an array or object.

#### Scenario: decision_request with string-encoded questions
- **WHEN** a model sends `decision_request` tool call with `questions` as a JSON-encoded string `"[{\"question\": \"...\", \"type\": \"exclusive\"}]"`
- **THEN** `prepareArguments` parses the string into a native array before SDK validation
- **THEN** SDK validation passes (questions is now an array)
- **THEN** `tool.execute()` receives the normalized array

#### Scenario: decision_request with native questions
- **WHEN** a model sends `decision_request` tool call with `questions` as a native array
- **THEN** `prepareArguments` passes through without modification
- **THEN** execution proceeds normally

#### Scenario: reorganize_todos with string-encoded items
- **WHEN** a model sends `reorganize_todos` tool call with `items` as a JSON-encoded string `"[{\"id\": 1, \"number\": 10}]"`
- **THEN** `prepareArguments` parses the string into a native array before SDK validation
- **THEN** SDK validation passes

#### Scenario: Tool with only scalar fields
- **WHEN** a model sends `get_task` tool call (`task_id` is a number)
- **THEN** `prepareArguments` passes through without modification
- **THEN** execution proceeds normally

### Requirement: Schema-driven normalization distinguishes types correctly
The normalizer MUST only JSON-parse string values for properties where the JSON Schema declares `type: "array"` or `type: "object"`. Properties with `type: "string"` MUST be left unchanged.

#### Scenario: String enum values preserved
- **WHEN** `decision_request` has a question with `type: "exclusive"` (a string value matching a schema `type: "string"`)
- **THEN** the normalizer does NOT JSON-parse it (it's a legitimate string)

#### Scenario: String fields not treated as JSON
- **WHEN** `decision_request` has `context: "This looks like: [not-json]"`
- **THEN** the normalizer does NOT attempt to parse the string

### Requirement: Deep recursive normalization for nested values
The normalizer MUST recurse into array `items` and object `properties` to normalize nested values that may be string-encoded.

#### Scenario: Nested options inside questions
- **WHEN** `decision_request.questions[0].options` is a JSON-encoded string (separately serialized)
- **THEN** the normalizer recurses into the array items and JSON-parses nested string arrays

#### Scenario: Already-native nested values pass through
- **WHEN** `decision_request.questions` is parsed from a single JSON string
- **THEN** the resulting `options` arrays inside are already native after the top-level parse
- **THEN** recursion continues without attempting redundant parsing

### Requirement: Safe error handling for malformed JSON
The normalizer MUST never throw on invalid JSON content. Any `JSON.parse` failure MUST be caught and the original string value preserved.

#### Scenario: Malformed JSON in string-encoded array
- **WHEN** `decision_request.questions = "[invalid json"`
- **THEN** JSON.parse throws, the error is caught
- **THEN** the original string value is preserved unchanged

#### Scenario: Valid JSON but wrong type after parse
- **WHEN** schema declares `type: "array"` but JSON.parse produces a string `"hello"`
- **THEN** the normalizer rejects the result and preserves the original string

### Requirement: Normalization is a standalone shared module
The normalize logic MUST be implemented in `src/bun/engine/normalize-args.ts` as a pure function that accepts `(schema, rawArgs)` and returns normalized arguments. It MUST have no dependencies on Pi SDK internals, execute functions, or tool contexts.

#### Scenario: Module is importable independently
- **WHEN** `normalize-args.ts` is imported
- **THEN** the exported function accepts any JSON Schema and any object
- **THEN** returns the normalized object without side effects

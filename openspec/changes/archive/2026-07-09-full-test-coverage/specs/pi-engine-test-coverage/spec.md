## ADDED Requirements

### Requirement: normalizeArgs parses JSON-string-encoded array/object parameters
The `normalizeToolArguments` function MUST JSON-parse string values when the JSON Schema indicates the parameter type is `array` or `object`.

#### Scenario: String-encoded array is parsed
- **WHEN** a parameter has `type: "array"` in the schema and the value is a JSON string `"[1,2,3]"`
- **THEN** the function returns an array `[1,2,3]`

#### Scenario: String-encoded object is parsed
- **WHEN** a parameter has `type: "object"` in the schema and the value is a JSON string `{"key":"value"}`
- **THEN** the function returns an object `{key: "value"}`

#### Scenario: String-typed parameter is NOT parsed
- **WHEN** a parameter has `type: "string"` and the value is `"hello world"`
- **THEN** the function returns the string unchanged

#### Scenario: Number-typed parameter is NOT parsed
- **WHEN** a parameter has `type: "number"` and the value is `42`
- **THEN** the function returns the number unchanged

#### Scenario: Non-string non-array parameter passes through
- **WHEN** the value is `null` for a parameter with `type: "array"`
- **THEN** the function returns `null` unchanged

### Requirement: normalizeArgs recurses into nested array items and object properties
The `normalizeToolArguments` function MUST recursively process nested values within array items and object properties.

#### Scenario: Nested array string is parsed
- **WHEN** `questions` is an array, and `questions[0].options` is a JSON string `"[{...}]"`
- **THEN** the function recurses into items and parses nested string arrays

#### Scenario: Nested object string is parsed
- **WHEN** a parameter has `type: "object"` and a property inside is a JSON string `{"nested":"value"}`
- **THEN** the function recurses into properties and parses nested strings

#### Scenario: Already-native nested values pass through
- **WHEN** `questions` is a native array containing objects with native `options` arrays
- **THEN** the function recurses without attempting to parse already-native values

### Requirement: normalizeArgs handles malformed JSON safely
The `normalizeToolArguments` function MUST never throw on invalid JSON. All `JSON.parse` calls MUST be wrapped in try/catch.

#### Scenario: Malformed JSON string is preserved
- **WHEN** a parameter has `type: "array"` and the value is `"[invalid json"`
- **THEN** the function catches the parse error and returns the original string

#### Scenario: Valid JSON but wrong type after parse
- **WHEN** a parameter has `type: "array"` and the JSON string is `"hello"` (valid JSON, but not an array)
- **THEN** the function validates the result type and preserves the original string

### Requirement: normalizeArgs skips allOf/anyOf/oneOf combinations (TODO)
The `normalizeToolArguments` function MUST currently skip handling `allOf`, `anyOf`, and `oneOf` schema combinations with a TODO comment.

#### Scenario: allOf schemas are skipped
- **WHEN** the schema contains an `allOf` array with nested schemas
- **THEN** the function does not recurse into these combinations

#### Scenario: anyOf schemas are skipped
- **WHEN** the schema contains an `anyOf` array with candidate schemas
- **THEN** the function does not attempt to parse union discriminators

## ADDED Requirements

### Requirement: Pi engine decision_request pipeline is fully tested
The Pi engine's `decision_request` execution path MUST have comprehensive integration tests using the `ScriptedEngine` pattern.

#### Scenario: decision_request event is emitted via SDK
- **WHEN** a Pi engine agent tool call for `decision_request` is executed
- **THEN** the engine emits a `decision_request` event with the structured payload

#### Scenario: decision_request event transitions task to waiting_user
- **WHEN** a `decision_request` event is emitted with a task ID
- **THEN** the task's `execution_state` is set to `waiting_user` in the DB

#### Scenario: decision_request_prompt message is created
- **WHEN** a `decision_request` event is processed by the stream processor
- **THEN** a message with type `decision_request_prompt` is enqueued in the conversation buffer

#### Scenario: decision_request_prompt is pushed to IPC
- **WHEN** the `decision_request_prompt` message is created
- **THEN** the message is forwarded through the IPC channel to the frontend

#### Scenario: decision_request suspends the agent loop
- **WHEN** a `decision_request` event is emitted
- **THEN** the Pi SDK's agent loop suspends execution and waits for user response

### Requirement: decision-handlers edge cases are tested
The `tasks.submitDecisions` and `chatSessions.submitDecisions` handlers MUST have tests for edge cases beyond the single-answer case.

#### Scenario: Multi-answer submission
- **WHEN** `tasks.submitDecisions` receives three answers in the answers array
- **THEN** all three answers are formatted in `userContent` and the payload is recorded

#### Scenario: Empty answers array
- **WHEN** `tasks.submitDecisions` receives an empty answers array `[]`
- **THEN** the handler returns an error or no-op without crashing

#### Scenario: Long notes field
- **WHEN** `tasks.submitDecisions` receives answers with notes exceeding 500 characters
- **THEN** the handler truncates or stores the full notes without error

#### Scenario: Multiple weight levels in one submission
- **WHEN** `tasks.submitDecisions` receives answers with weights `critical`, `medium`, and `easy`
- **THEN** each weight is correctly formatted (CALLED, medium, easy) in the user content

### Requirement: Streaming and reconnection edge cases are tested
The UI MUST handle decision_request_prompt during streaming, concurrency, and disconnection scenarios.

#### Scenario: decision_request_prompt during streaming
- **WHEN** a `done` event is emitted while other chunks are still streaming
- **THEN** the `decision_request_prompt` appears at the end of the stream

#### Scenario: Concurrent decision requests
- **WHEN** two decision requests are emitted for different tasks concurrently
- **THEN** each task shows its own interview prompt (no cross-contamination)

#### Scenario: Disconnection during interview
- **WHEN** the WebSocket disconnects while an interview prompt is displayed
- **THEN** the interview UI persists across reconnection (no state loss)

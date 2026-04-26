## ADDED Requirements

### Requirement: executeCommonTool returns a typed result object
The `executeCommonTool` function SHALL return `Promise<ToolExecutionResult>` where `ToolExecutionResult` is a discriminated union: `{ type: "result"; text: string }` for normal tool completions or `{ type: "suspend"; payload: string }` when the `interview_me` tool triggers execution suspension. Callers SHALL unwrap the `.text` field before treating the result as a plain string.

#### Scenario: Normal tool call returns result type
- **WHEN** a common tool (e.g. `create_todo`, `list_todos`) completes successfully
- **THEN** `executeCommonTool` resolves to `{ type: "result", text: "<json-string>" }`
- **THEN** callers can safely do `result.text` to get the serialized tool output

#### Scenario: interview_me triggers suspend type
- **WHEN** `interview_me` is called with questions
- **THEN** `executeCommonTool` resolves to `{ type: "suspend", payload: "<interview-payload>" }`
- **THEN** callers check `result.type === "suspend"` and handle the suspend path separately

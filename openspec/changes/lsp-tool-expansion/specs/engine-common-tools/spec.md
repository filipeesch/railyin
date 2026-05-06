## MODIFIED Requirements

### Requirement: executeCommonTool returns a typed result object
The `executeCommonTool` function SHALL return `Promise<ToolExecutionResult>` where `ToolExecutionResult` is a discriminated union:
- `{ type: "result"; text: string; writtenFiles?: FileDiffPayload[]; beforeFiles?: Record<string, string | null> }` for normal tool completions
- `{ type: "suspend"; payload: string }` when the `decision_request` tool triggers execution suspension

The `writtenFiles` field, when present, carries file diff payloads for UI visualization. The `beforeFiles` field, when present, carries the pre-mutation content of each changed file (keyed by absolute path; `null` means the file was newly created). Callers that only need text SHALL continue to use the `.text` field — the new fields are optional and backward-compatible.

#### Scenario: Normal tool call returns result type
- **WHEN** a common tool (e.g. `create_todo`, `list_decisions`) completes successfully
- **THEN** `executeCommonTool` resolves to `{ type: "result", text: "<json-string>" }`

#### Scenario: decision_request triggers suspend type
- **WHEN** `decision_request` is called with questions
- **THEN** `executeCommonTool` resolves to `{ type: "suspend", payload: "<interview-payload>" }`

#### Scenario: lsp_rename result carries writtenFiles and beforeFiles
- **WHEN** `lsp_rename` succeeds and modifies N files
- **THEN** `executeCommonTool` resolves to `{ type: "result", text: "...", writtenFiles: [N FileDiffPayload entries], beforeFiles: { <absPath>: <beforeContent>, ... } }`

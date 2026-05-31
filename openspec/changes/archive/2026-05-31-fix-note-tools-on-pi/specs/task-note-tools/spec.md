## MODIFIED Requirements

### Requirement: Note tools are available in all four engines
The `create_note`, `list_notes`, and `update_note` tools SHALL be included in `COMMON_TOOL_DEFINITIONS` and therefore available in the Claude, Copilot, Pi, and OpenCode engines. Each engine's context construction SHALL inject a `NoteRepository` instance at `repos.notes`. For the Pi engine specifically, all three note tool names SHALL appear in the SDK `tools` allowlist on both session creation (`defaultSessionFactory`) and session reuse (`setActiveToolsByName`).

#### Scenario: Note tools available in Claude engine
- **WHEN** the Claude engine runs an execution
- **THEN** `create_note`, `list_notes`, and `update_note` are registered with the SDK

#### Scenario: Note tools available in Copilot engine
- **WHEN** the Copilot engine runs an execution
- **THEN** `create_note`, `list_notes`, and `update_note` are in the registered tool list

#### Scenario: Note tools available in Pi engine on first execution
- **WHEN** the Pi engine processes the first execution of a new conversation
- **THEN** `create_note`, `list_notes`, and `update_note` are present in the SDK `tools` allowlist
- **AND** calling `create_note` from the LLM persists a note successfully

#### Scenario: Note tools available in Pi engine on subsequent executions
- **WHEN** the Pi engine processes the second or later execution of the same conversation
- **THEN** `create_note`, `list_notes`, and `update_note` remain present in the active tool set via `setActiveToolsByName`

#### Scenario: executeCommonTool dispatches to NoteRepository
- **WHEN** `executeCommonTool("create_note", { content: "hello" }, ctx)` is called
- **THEN** `ctx.repos.notes.createNote(...)` is called and the result is returned

## ADDED Requirements

### Requirement: update_note rejects empty content
The `update_note` tool SHALL reject a `content` argument that is empty or whitespace-only with the validation error `"Error: content is required"`, consistent with the `create_note` guard. The `content` SHALL be trimmed before the empty check.

#### Scenario: update_note with empty content string is rejected
- **WHEN** `executeCommonTool("update_note", { id: 1, content: "" }, ctx)` is called
- **THEN** the tool returns `"Error: content is required"` and no update is persisted

#### Scenario: update_note with whitespace-only content is rejected
- **WHEN** `executeCommonTool("update_note", { id: 1, content: "   " }, ctx)` is called
- **THEN** the tool returns `"Error: content is required"` and no update is persisted

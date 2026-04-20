## ADDED Requirements

### Requirement: LSP tool is defined in a shared definition file
The system SHALL define the `lsp` tool schema in `src/bun/engine/lsp-tool-definition.ts` as `LSP_TOOL_DEFINITION`, mirroring the pattern of `interview-tool-definition.ts`. This definition SHALL be imported by both `engine/common-tools.ts` and `workflow/tools.ts` to eliminate schema duplication.

#### Scenario: Both native and SDK engines use the same tool schema
- **WHEN** the native engine and the Copilot engine both initialize their tool lists
- **THEN** both reference the same `LSP_TOOL_DEFINITION` object for the `lsp` tool schema

### Requirement: LSP tool description uses behavioral ALWAYS/NEVER guidance
The `lsp` tool description SHALL lead with imperative behavioral rules telling the model WHEN to use each operation, not HOW the operations work. It SHALL include explicit ALWAYS and NEVER blocks for when to call the tool and how to sequence calls (documentSymbol before position-based ops).

#### Scenario: Model receives behavioral guidance in tool description
- **WHEN** the `lsp` tool schema is included in any engine's tool list
- **THEN** the description contains ALWAYS and NEVER sections with concrete usage rules

### Requirement: LSP tool exposes typeDefinition operation
The system SHALL add a `typeDefinition` operation to the `lsp` tool that sends `textDocument/typeDefinition` to the language server and formats the result using the same formatter as `goToDefinition`.

#### Scenario: typeDefinition returns the type location
- **WHEN** the model calls `lsp(typeDefinition, file_path, line, character)` at a variable position
- **THEN** the result shows the file and line where the variable's type is defined

### Requirement: LSP tool exposes rename operation
The system SHALL add a `rename` operation to the `lsp` tool. It SHALL first call `textDocument/prepareRename` to validate the position; if the server rejects it, return a clear error message. On success, call `textDocument/rename` with `newName`, receive a `WorkspaceEdit`, apply it to disk via `applyWorkspaceEdit()`, and return a summary of files changed.

#### Scenario: Successful cross-file rename
- **WHEN** the model calls `lsp(rename, file_path, line, character, newName="Bar")`
- **THEN** all occurrences of the symbol across the project are renamed, and the result lists each file changed with a count of edits

#### Scenario: Rename rejected at invalid position
- **WHEN** the model calls `lsp(rename, ...)` at a position the server cannot rename (e.g., string literal, external declaration)
- **THEN** the tool returns an error message explaining why rename is not possible at that position

### Requirement: LSP tool exposes format operation
The system SHALL add a `format` operation to the `lsp` tool. It SHALL call `textDocument/formatting`, receive `TextEdit[]`, apply them to the file via `applyWorkspaceEdit()`, and return a summary ("Formatted X lines changed").

#### Scenario: Successful file format
- **WHEN** the model calls `lsp(format, file_path)`
- **THEN** the file is formatted according to the language server's rules and the result reports lines changed

#### Scenario: Format on already-formatted file
- **WHEN** the model calls `lsp(format, file_path)` on an already-formatted file
- **THEN** the tool returns "No changes needed" without writing the file

### Requirement: applyWorkspaceEdit applies LSP edits to disk
The system SHALL implement `applyWorkspaceEdit(edit: WorkspaceEdit, worktreePath: string)` that reads each affected file, applies `TextEdit[]` in reverse range order (to preserve character offsets), writes the result back, and returns `{ filesChanged: string[], summary: string }` on success or `{ error: string }` on failure. It SHALL handle both `changes` and `documentChanges` formats of `WorkspaceEdit`.

#### Scenario: Multi-file WorkspaceEdit applied correctly
- **WHEN** `applyWorkspaceEdit` receives edits spanning 3 files
- **THEN** all 3 files are modified on disk and the return value lists all 3 paths

#### Scenario: Edits applied in reverse range order
- **WHEN** a file has multiple TextEdits
- **THEN** edits are applied last-range-first so earlier offsets remain valid throughout

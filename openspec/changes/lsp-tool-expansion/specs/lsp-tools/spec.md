## ADDED Requirements

### Requirement: Ten focused LSP tools replace the single lsp tool
The system SHALL expose exactly 10 focused LSP tools — `lsp_go_to_definition`, `lsp_find_references`, `lsp_document_symbols`, `lsp_workspace_symbols`, `lsp_hover`, `lsp_rename`, `lsp_incoming_calls`, `lsp_outgoing_calls`, `lsp_diagnostics`, `lsp_type_definition` — and SHALL NOT expose a general-purpose `lsp` tool.

Each tool SHALL accept only the parameters relevant to its operation. The shared parameters across all tools are `file_path: string` (relative path) and any operation-specific arguments.

#### Scenario: LT-1 lsp tool no longer exists
- **WHEN** any engine enumerates available tools
- **THEN** no tool named `lsp` is present in the tool list

#### Scenario: LT-2 Ten focused tools are registered
- **WHEN** any engine enumerates available tools with the `lsp` group enabled
- **THEN** exactly 10 tools matching the `lsp_*` prefix are available

#### Scenario: LT-3 Each tool accepts only its own parameters
- **WHEN** `lsp_hover` is called with only `{ file_path, line, character }`
- **THEN** the call succeeds without an operation parameter

### Requirement: lsp_go_to_definition navigates to symbol definition
The `lsp_go_to_definition` tool SHALL accept `{ file_path: string, line: number, character: number }` and SHALL return the definition location(s) as a formatted string.

#### Scenario: LT-4 Definition found
- **WHEN** `lsp_go_to_definition` is called at a position that has a definition
- **THEN** the result includes the target file path and 1-based line number

#### Scenario: LT-5 No definition found
- **WHEN** `lsp_go_to_definition` is called at a position with no definition
- **THEN** the result indicates no definition was found

### Requirement: lsp_find_references returns all references with pagination
The `lsp_find_references` tool SHALL accept `{ file_path: string, line: number, character: number, include_declaration?: boolean, limit?: number, offset?: number }`. The `limit` parameter SHALL default to 50. The tool description SHALL note that LSP servers do not guarantee stable result ordering between calls, so `offset`-based pagination may return inconsistent results.

#### Scenario: LT-6 References returned with default limit
- **WHEN** `lsp_find_references` is called without `limit`
- **THEN** at most 50 references are returned

#### Scenario: LT-7 Pagination with limit and offset
- **WHEN** `lsp_find_references` is called with `limit: 10, offset: 10`
- **THEN** references 11 through 20 are returned (if available)

### Requirement: lsp_document_symbols lists symbols in a file
The `lsp_document_symbols` tool SHALL accept `{ file_path: string }` and SHALL return the symbol tree for that file as a formatted string.

#### Scenario: LT-8 Symbols returned for a file with symbols
- **WHEN** `lsp_document_symbols` is called on a TypeScript file with exported functions
- **THEN** the result includes symbol names, kinds, and line numbers

### Requirement: lsp_workspace_symbols searches workspace symbols with pagination
The `lsp_workspace_symbols` tool SHALL accept `{ query: string, limit?: number, offset?: number }` (no `file_path`). The `limit` parameter SHALL default to 20. The description SHALL carry the same LSP ordering instability caveat as `lsp_find_references`.

#### Scenario: LT-9 Workspace symbols match query
- **WHEN** `lsp_workspace_symbols` is called with `query: "UserRepo"`
- **THEN** symbols matching `UserRepo` from across the workspace are returned, up to the limit

### Requirement: lsp_hover returns type and documentation at a position
The `lsp_hover` tool SHALL accept `{ file_path: string, line: number, character: number }` and SHALL return the hover content (type signature and documentation) as a string. Its result limit SHALL be 10k characters.

#### Scenario: LT-10 Hover returns type info
- **WHEN** `lsp_hover` is called at a function call position
- **THEN** the result contains the function signature

### Requirement: lsp_rename renames a symbol across all references
The `lsp_rename` tool SHALL accept `{ file_path: string, line: number, character: number, new_name: string }` and SHALL apply the workspace edit returned by the LSP server to disk. On success, it SHALL return a summary that includes the number of files changed and, in the Pi engine, an `[op:XXXX]` operationId for undo.

#### Scenario: LT-11 Rename succeeds and reports changed files
- **WHEN** `lsp_rename` is called with a valid symbol position and new name
- **THEN** all files containing references are updated on disk
- **THEN** the result string includes the count of changed files

#### Scenario: LT-12 Rename result includes operationId in Pi engine
- **WHEN** `lsp_rename` is called in a Pi engine session
- **THEN** the result string contains `[op:XXXX]` where XXXX is a 4-character hex string
- **THEN** `undo_write` can restore all changed files using that operationId

#### Scenario: LT-13 Rename with no changes
- **WHEN** the LSP server returns an empty workspace edit for a rename
- **THEN** the result indicates no changes were needed

### Requirement: lsp_incoming_calls and lsp_outgoing_calls traverse call hierarchy
`lsp_incoming_calls` SHALL accept `{ file_path: string, line: number, character: number }` and return callers of the symbol. `lsp_outgoing_calls` SHALL accept the same parameters and return callees. Both SHALL call `prepareCallHierarchy` internally.

#### Scenario: LT-14 Incoming calls returned
- **WHEN** `lsp_incoming_calls` is called on a function symbol
- **THEN** callers of that function are listed with their file paths and positions

#### Scenario: LT-15 Outgoing calls returned
- **WHEN** `lsp_outgoing_calls` is called on a function symbol
- **THEN** functions called by that function are listed with their file paths and positions

### Requirement: lsp_diagnostics returns file diagnostics
The `lsp_diagnostics` tool SHALL accept `{ file_path: string }` and SHALL return current LSP diagnostics (errors, warnings) for that file as a formatted string.

#### Scenario: LT-16 Diagnostics returned for file with errors
- **WHEN** `lsp_diagnostics` is called on a file with type errors
- **THEN** the result lists each diagnostic with severity, line number, and message

#### Scenario: LT-17 No diagnostics
- **WHEN** `lsp_diagnostics` is called on an error-free file
- **THEN** the result indicates no diagnostics were found

### Requirement: lsp_type_definition navigates to the type definition of a symbol
The `lsp_type_definition` tool SHALL accept `{ file_path: string, line: number, character: number }` and SHALL return the type definition location(s).

#### Scenario: LT-18 Type definition found
- **WHEN** `lsp_type_definition` is called at a variable that has a named type
- **THEN** the result includes the type's definition file and line number

### Requirement: lsp tool group expands to all ten tools in TOOL_GROUPS
`TOOL_GROUPS["lsp"]` in `registry.ts` SHALL map to the array of all 10 `lsp_*` tool names. Workflow YAML files that specify `- lsp` under `tools:` SHALL continue to work without modification.

#### Scenario: LT-19 YAML tool group enables all ten tools
- **WHEN** a workflow column specifies `tools: [lsp]`
- **THEN** all 10 `lsp_*` tools are available to the executing engine

### Requirement: Per-tool TOOL_RESULT_LIMITS are set
`TOOL_RESULT_LIMITS` in `conversation/context.ts` SHALL contain an entry for each of the 10 `lsp_*` tools. Navigation, reference, and symbol tools SHALL have a limit of 100,000 characters. `lsp_hover` SHALL have a limit of 10,000 characters. `lsp_rename` SHALL have a limit of 2,000 characters.

#### Scenario: LT-20 Hover result is truncated at 10k
- **WHEN** `lsp_hover` returns more than 10,000 characters
- **THEN** the result is truncated to 10,000 characters before being sent to the model

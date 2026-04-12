## ADDED Requirements

### Requirement: LSP tool provides code intelligence operations

The system SHALL provide an `lsp` tool that accepts an `operation` parameter (one of: `goToDefinition`, `findReferences`, `hover`, `documentSymbol`, `workspaceSymbol`, `goToImplementation`, `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`), a `file_path` (relative to worktree), a `line` (1-based integer), and a `character` (1-based integer). The tool SHALL route the request to the appropriate LSP server and return a human-readable formatted result.

#### Scenario: Go to definition returns file and line
- **WHEN** the model calls `lsp` with `operation: "goToDefinition"`, `file_path: "src/main.ts"`, `line: 10`, `character: 5`
- **THEN** the tool returns a string like `"Defined in src/utils.ts:42:10"` with the definition location

#### Scenario: Find references returns grouped results
- **WHEN** the model calls `lsp` with `operation: "findReferences"`, `file_path: "src/utils.ts"`, `line: 42`, `character: 10`
- **THEN** the tool returns results grouped by file with line numbers, e.g. `"Found 3 references across 2 files:\n\nsrc/main.ts:\n  Line 10:5\n  Line 25:3\n\nsrc/other.ts:\n  Line 7:1"`

#### Scenario: Hover returns type and documentation info
- **WHEN** the model calls `lsp` with `operation: "hover"`, `file_path: "src/main.ts"`, `line: 10`, `character: 5`
- **THEN** the tool returns the hover content (type information, documentation) as provided by the language server

#### Scenario: Document symbol lists all symbols in a file
- **WHEN** the model calls `lsp` with `operation: "documentSymbol"`, `file_path: "src/main.ts"`, `line: 1`, `character: 1`
- **THEN** the tool returns a hierarchical list of symbols with their kinds and line numbers

#### Scenario: Workspace symbol searches across the project
- **WHEN** the model calls `lsp` with `operation: "workspaceSymbol"`, `file_path: "src/main.ts"`, `line: 1`, `character: 1`
- **THEN** the tool returns matching symbols across the workspace with file paths and line numbers

#### Scenario: Incoming calls shows callers of a function
- **WHEN** the model calls `lsp` with `operation: "incomingCalls"`, `file_path: "src/utils.ts"`, `line: 42`, `character: 10`
- **THEN** the tool returns a list of functions that call the target, grouped by file

#### Scenario: Outgoing calls shows callees from a function
- **WHEN** the model calls `lsp` with `operation: "outgoingCalls"`, `file_path: "src/main.ts"`, `line: 10`, `character: 5`
- **THEN** the tool returns a list of functions called by the target, grouped by file

### Requirement: LSP servers are spawned as child processes via stdio

The system SHALL spawn LSP servers as child processes using `child_process.spawn` with stdio pipes. Communication SHALL use JSON-RPC 2.0 with Content-Length headers (standard LSP transport). The system SHALL perform the standard `initialize` → `initialized` handshake before sending requests.

#### Scenario: Server is spawned on first LSP request for a file type
- **WHEN** the `lsp` tool is called for a `.ts` file and no TypeScript LSP server is running
- **THEN** the system spawns the configured server process, completes the LSP handshake, and processes the request

#### Scenario: Server process crash triggers error state
- **WHEN** an LSP server process exits unexpectedly
- **THEN** the server instance moves to `error` state and the next request attempts a restart

#### Scenario: Server restart fails after 3 consecutive crashes
- **WHEN** an LSP server process crashes 3 times consecutively
- **THEN** the server is disabled for the session and the tool returns an error message

### Requirement: File extension routing via LSPServerManager

The system SHALL maintain a singleton `LSPServerManager` that maps file extensions to server names based on workspace configuration. When a tool request arrives, the manager SHALL route it to the server responsible for that file's extension.

#### Scenario: Request routed to correct server by extension
- **WHEN** the `lsp` tool is called for a `.py` file and a Python LSP server is configured
- **THEN** the request is routed to the Python server, not the TypeScript server

#### Scenario: No server configured for file type
- **WHEN** the `lsp` tool is called for a file type with no configured LSP server
- **THEN** the tool returns `"Error: No LSP server configured for .xyz files. Configure one in workspace.yaml under lsp.servers."`

### Requirement: File content sent via didOpen on first access

The system SHALL send a `textDocument/didOpen` notification with the file's full content before the first LSP request for that file. Files larger than 10MB SHALL be skipped with an error.

#### Scenario: File opened before first request
- **WHEN** the `lsp` tool handles its first request for `src/main.ts`
- **THEN** it reads the file and sends `textDocument/didOpen` before the actual LSP request

#### Scenario: File too large to open
- **WHEN** the `lsp` tool is called for a file larger than 10MB
- **THEN** the tool returns an error indicating the file is too large for LSP analysis

### Requirement: Result formatting uses relative paths and 1-based lines

The system SHALL convert all LSP result URIs to relative paths (from the worktree root) and convert all positions from 0-based (LSP protocol) to 1-based for display. Results SHALL be formatted as plain text, not JSON.

#### Scenario: Absolute URIs converted to relative paths
- **WHEN** an LSP server returns `file:///Users/x/project/src/foo.ts`
- **THEN** the formatted result shows `src/foo.ts`

#### Scenario: 0-based positions converted to 1-based
- **WHEN** an LSP server returns position `{ line: 41, character: 9 }` (0-based)
- **THEN** the formatted result shows `42:10` (1-based)

### Requirement: LSP servers configured in workspace.yaml

The system SHALL support an `lsp.servers` array in workspace.yaml where each entry defines `name`, `command`, `args`, and `extensions`. The system SHALL validate this configuration at startup and log warnings for invalid entries.

#### Scenario: Server configured and used
- **WHEN** workspace.yaml contains `lsp.servers: [{name: "typescript", command: "typescript-language-server", args: ["--stdio"], extensions: [".ts", ".tsx"]}]`
- **THEN** the LSP manager registers `.ts` and `.tsx` routes to the "typescript" server

#### Scenario: No LSP config present
- **WHEN** workspace.yaml does not contain an `lsp` section
- **THEN** the LSP manager is created with an empty routing table and all `lsp` tool calls return "no server configured" errors

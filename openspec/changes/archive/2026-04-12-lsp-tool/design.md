## Context

The AI model currently navigates code by text-searching (grep/search_text) for symbol names, followed by reading candidate files to identify definitions, implementations, and callers. This approach is unreliable (wrong overload, wrong file) and expensive (3-5 tool rounds per query, each adding tokens to the context). Free Code's LSP tool provides a proven pattern: spawn language servers as child processes, communicate via JSON-RPC over stdio, and return precise file:line results in a single tool call.

The Railyin runtime uses Bun, which supports `child_process.spawn` and can communicate with any LSP-compliant server (e.g. `typescript-language-server`, `pyright`, `rust-analyzer`).

## Goals / Non-Goals

**Goals:**
- Add an `lsp` tool offering 9 code intelligence operations (goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls)
- Spawn LSP servers as child processes via stdio JSON-RPC
- Route requests to the correct server based on file extension
- Return human-readable formatted results (relative paths, 1-based line numbers)
- Lazy-start servers on first use (no startup cost if lsp tool is never called)
- Support user-configurable server definitions in workspace.yaml

**Non-Goals:**
- Not implementing code actions, rename, or formatting (write operations via LSP)
- Not bundling or auto-installing language servers (user must install them)
- Not supporting LSP servers that require TCP/socket transport (stdio only)
- Not providing IDE-like file watching or incremental sync (full file content sent on didOpen)

## Decisions

### 1. Subprocess via stdio JSON-RPC (not VS Code API, not TCP)

LSP servers are spawned as child processes with `stdin`/`stdout` pipes. Communication uses the JSON-RPC 2.0 protocol with Content-Length headers (standard LSP transport).

**Rationale**: This is the same approach Free Code uses. It works in any runtime (Bun, Node), doesn't depend on an editor API, and supports all major language servers. TCP would add connection management complexity with no benefit.

**Alternative considered**: Embedding a TypeScript language service directly via Bun's TS API — rejected because it only covers TypeScript and wouldn't generalize to other languages.

### 2. LSPServerManager singleton with file-extension routing

A single `LSPServerManager` maps file extensions to server names via a routing table built from config. It manages the lifecycle of `LSPServerInstance` objects (idle → starting → running → error). The manager handles `didOpen`/`didClose` notifications to keep servers informed of file state.

**Rationale**: Matches Free Code's architecture. Centralizes server lifecycle so multiple tool calls reuse the same server instance. The extension-based routing is simple and covers all practical cases.

### 3. Lazy initialization — servers start on first LSP tool call

Servers are NOT started at Railyin startup. The first `lsp` tool call triggers `initialize` → `initialized` handshake for the required server. Subsequent calls reuse the running instance.

**Rationale**: Many tasks never use LSP. Eager startup would waste resources and slow down launch. The first call has ~1-2s latency for server startup, which is acceptable.

### 4. File content sent via `textDocument/didOpen` on first access

Before sending any request for a file, the manager checks if the file is already open. If not, it reads the file (up to 10MB) and sends `textDocument/didOpen`. Files are not re-synced after tool edits (the model can re-read if needed).

**Rationale**: Simplest correct approach. Full-document sync avoids the complexity of incremental updates. The 10MB limit prevents memory issues with generated files.

### 5. Config-driven server definitions in workspace.yaml

```yaml
lsp:
  servers:
    - name: typescript
      command: typescript-language-server
      args: ["--stdio"]
      extensions: [".ts", ".tsx", ".js", ".jsx"]
    - name: python
      command: pyright-langserver
      args: ["--stdio"]
      extensions: [".py"]
```

**Rationale**: Users have different language stacks. Hardcoding server paths would break across environments. Config-driven approach lets users add servers for their specific languages.

### 6. Result formatting: relative paths, 1-based lines, human-readable text

Results are formatted as plain text strings, not JSON. Examples:
- goToDefinition: `"Defined in src/foo.ts:42:10"`
- findReferences: `"Found 5 references across 3 files:\n\nsrc/foo.ts:\n  Line 42:10\n  Line 55:3\n\nsrc/bar.ts:\n  Line 7:1"`
- hover: Raw markdown content from the server

**Rationale**: The model processes natural language better than structured JSON. Relative paths save tokens. 1-based line numbers match the `read_file` output (which will also use 1-based numbering).

### 7. Add `lsp` to tool groups, default off

A new `lsp` tool group containing the single `lsp` tool. Not part of any existing group by default — columns must explicitly include `lsp` in their tools array.

**Rationale**: LSP requires server configuration. Adding it silently to all columns would cause confusing errors when no server is configured.

## Risks / Trade-offs

- **[Server not installed]** → The tool returns a clear error: "No LSP server configured for .xyz files. Configure one in workspace.yaml under lsp.servers." The model can fall back to grep-based navigation.
- **[Server crash mid-session]** → LSPServerInstance tracks state. On crash, state moves to `error`. Next request attempts a restart. After 3 consecutive failures, the server is disabled for the session.
- **[Stale file state]** → After the model edits a file via `edit_file`/`write_file`, the LSP server may have stale content. Mitigation: send `textDocument/didClose` + `textDocument/didOpen` with fresh content when a file is re-accessed after modification. Track file mtimes.
- **[Slow server startup]** → First call may take 1-2s. Acceptable for the accuracy benefit. Could add a warmup step in the future.
- **[Large workspaces]** → Some LSP servers index the entire workspace on startup. For very large repos this could be slow. Mitigation: document recommended server settings (e.g. `typescript-language-server` has project scoping via `tsconfig.json`).

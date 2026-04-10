## 1. LSP Client Transport

- [x] 1.1 Create `src/bun/lsp/types.ts` with LSP protocol types (InitializeParams, InitializeResult, TextDocumentPositionParams, Location, SymbolInformation, CallHierarchyItem, etc.)
- [x] 1.2 Create `src/bun/lsp/client.ts` — LSPClient class that spawns a child process via stdio, implements JSON-RPC 2.0 with Content-Length framing, handles `initialize`/`initialized` handshake, and provides `sendRequest`/`sendNotification` methods
- [x] 1.3 Add `textDocument/didOpen` and `textDocument/didClose` notification helpers to LSPClient
- [x] 1.4 Add error handling: process exit detection, request timeout (30s), and graceful shutdown via `shutdown`/`exit` sequence

## 2. LSP Server Manager

- [x] 2.1 Create `src/bun/lsp/manager.ts` — LSPServerManager singleton with file-extension-to-server routing table built from config
- [x] 2.2 Implement lazy server initialization: spawn + handshake on first request, reuse on subsequent calls
- [x] 2.3 Implement file open tracking: send `didOpen` with full file content before first request for a file; track opened file set per server
- [x] 2.4 Implement server health: state machine (idle → starting → running → error), restart on crash, disable after 3 consecutive failures
- [x] 2.5 Implement stale file handling: when a file was modified since last `didOpen`, send `didClose` + `didOpen` with fresh content

## 3. Result Formatters

- [x] 3.1 Create `src/bun/lsp/formatters.ts` — format functions for each operation: locations as `"file.ts:42:10"`, references grouped by file, hover as raw markdown, symbols as hierarchical tree, call hierarchy as grouped lists
- [x] 3.2 Implement URI-to-relative-path conversion and 0-based-to-1-based position conversion
- [x] 3.3 Cap result output at 100K chars with truncation indicator

## 4. Tool Definition and Executor

- [x] 4.1 Add `lsp` tool definition to `TOOL_DEFINITIONS` in `tools.ts` with parameters: `operation` (enum of 9 values), `file_path` (string), `line` (number), `character` (number)
- [x] 4.2 Add `lsp` case to `executeTool()` in `tools.ts` — resolve absolute path, get manager instance, route to correct server, call formatter, return result
- [x] 4.3 Add `lsp` to `TOOL_GROUPS` map as `["lsp"]` and to `TOOL_DESCRIPTIONS` map
- [x] 4.4 Set `maxResultSizeChars` for lsp tool to 100,000 (when per-tool limits are implemented)

## 5. Configuration

- [x] 5.1 Add `lsp.servers` array type to workspace config schema in `src/bun/config/index.ts` — each entry: `name`, `command`, `args`, `extensions`
- [x] 5.2 Add LSPServerManager initialization in engine startup: read config, create manager instance, pass to tool context
- [x] 5.3 Add `lsp` to default tool set for `apply` column in the openspec workflow template

## 6. Tests

- [x] 6.1 Unit test LSPClient JSON-RPC framing: serialize request with Content-Length header, parse response from stream
- [x] 6.2 Unit test LSPServerManager routing: correct server selected by extension, error on unknown extension, restart logic
- [x] 6.3 Unit test result formatters: location formatting, reference grouping, URI conversion, position conversion
- [x] 6.4 Unit test `executeTool("lsp", ...)` with a mock manager: verify parameter validation, error messages

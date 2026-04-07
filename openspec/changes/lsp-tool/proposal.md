## Why

The AI model currently navigates code by grep-searching for symbol names and reading multiple files to guess which is the definition, implementation, or caller. This wastes 3-5 tool rounds per navigation query and produces unreliable results (wrong file, wrong overload). Free Code's LSP tool provides exact answers in a single call by querying a real language server — go-to-definition, find-references, hover docs, call hierarchy — all returning precise file:line results. Adding an LSP tool would eliminate the most expensive class of wasted tool rounds.

## What Changes

- Add an `lsp` tool that spawns language servers (e.g. `typescript-language-server`) as child processes via stdio JSON-RPC
- Support 9 operations: `goToDefinition`, `findReferences`, `hover`, `documentSymbol`, `workspaceSymbol`, `goToImplementation`, `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`
- Add an `LSPServerManager` singleton that routes requests to the correct server based on file extension
- Add an `LSPClient` transport layer using JSON-RPC over stdin/stdout
- Add workspace config for LSP server definitions (command, args, file extensions)
- Add the `lsp` tool to relevant tool groups so it's available in workflow columns

## Capabilities

### New Capabilities
- `lsp-tool`: LSP-based code intelligence tool supporting definition lookup, reference finding, hover documentation, symbol listing, and call hierarchy queries via subprocess language servers

### Modified Capabilities
- `column-tool-config`: Add `lsp` to the available tool groups that workflow columns can reference

## Impact

- New files: `src/bun/lsp/` directory (client, manager, types)
- New tool definition and executor in `src/bun/workflow/tools.ts`
- Config schema update for LSP server definitions in workspace.yaml
- Tool groups updated to include `lsp`
- Runtime dependency: `typescript-language-server` (or user-configured servers) must be installed on the host

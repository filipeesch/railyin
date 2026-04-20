import type { AIToolDefinition } from "../ai/types.ts";

export const LSP_TOOL_DEFINITION: AIToolDefinition = {
  name: "lsp",
  description:
    "Query a language server for code intelligence and refactoring.\n\n" +
    "ALWAYS use lsp when:\n" +
    "- Navigating to where a symbol is defined before editing it\n" +
    "- Finding all usages of a function, type, or variable before renaming or removing it\n" +
    "- Renaming a symbol across the entire project (use rename operation — scope-aware, cross-file)\n" +
    "- Checking what type a variable or expression resolves to (use typeDefinition or hover)\n" +
    "- Tracing who calls a function or what it calls (use prepareCallHierarchy, incomingCalls, outgoingCalls)\n\n" +
    "NEVER use lsp when:\n" +
    "- Searching for text patterns — use search_text instead\n" +
    "- The file has no registered language server (plain text, JSON, YAML, markdown)\n" +
    "- You already have the definition in your current context — avoid redundant calls\n" +
    "- The rename is trivial (single file, one occurrence) — multi_replace is fine\n\n" +
    "ALWAYS call documentSymbol first to get exact 1-based line/character positions\n" +
    "before calling any position-based operation (goToDefinition, findReferences, hover, rename, typeDefinition, etc.).\n\n" +
    "ALWAYS use rename instead of search-and-replace for symbol renaming — it is scope-aware\n" +
    "and handles all cross-file references atomically.\n\n" +
    "For workspaceSymbol, file_path is optional — omit it or pass any .ts file as a routing hint.",
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: [
          "goToDefinition",
          "findReferences",
          "hover",
          "documentSymbol",
          "workspaceSymbol",
          "goToImplementation",
          "prepareCallHierarchy",
          "incomingCalls",
          "outgoingCalls",
          "typeDefinition",
          "rename",
        ],
        description: "The LSP operation to perform.",
      },
      file_path: {
        type: "string",
        description:
          "Relative path to the file from the worktree root. Required for all operations except workspaceSymbol.",
      },
      line: {
        type: "number",
        description: "1-based line number. Required for position-based operations.",
      },
      character: {
        type: "number",
        description: "1-based character offset. Required for position-based operations.",
      },
      query: {
        type: "string",
        description: "Symbol name query string. Required for workspaceSymbol.",
      },
      new_name: {
        type: "string",
        description: "New name for the symbol. Required for rename operation.",
      },
    },
    required: ["operation"],
  },
};

import type { AIToolDefinition } from "../ai/types.ts";

export const LSP_TOOL_DEFINITIONS: AIToolDefinition[] = [
  {
    name: "lsp_go_to_definition",
    description:
      "Navigate to where a symbol is defined.\n\n" +
      "ALWAYS call lsp_document_symbols first to get exact 1-based line/character positions.\n" +
      "Use before editing a symbol to understand its full definition.\n" +
      "Prefer this over text search for jumping to definitions.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Relative path to the file from the worktree root." },
        line: { type: "number", description: "1-based line number of the symbol." },
        character: { type: "number", description: "1-based character offset of the symbol." },
      },
      required: ["file_path", "line", "character"],
    },
  },
  {
    name: "lsp_find_references",
    description:
      "Find all usages of a symbol across the project.\n\n" +
      "ALWAYS call lsp_document_symbols first to get exact 1-based line/character positions.\n" +
      "Use before renaming or removing a symbol to see all affected sites.\n" +
      "Results are paginated — use limit/offset to navigate large result sets.\n" +
      "NOTE: LSP servers do not guarantee stable ordering between calls; paginated results may vary.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Relative path to the file from the worktree root." },
        line: { type: "number", description: "1-based line number of the symbol." },
        character: { type: "number", description: "1-based character offset of the symbol." },
        include_declaration: { type: "boolean", description: "Include the declaration site in results. Defaults to true." },
        limit: { type: "number", description: "Maximum number of references to return. Defaults to 50." },
        offset: { type: "number", description: "Number of references to skip (for pagination). Defaults to 0." },
      },
      required: ["file_path", "line", "character"],
    },
  },
  {
    name: "lsp_document_symbols",
    description:
      "List all symbols (functions, classes, variables) defined in a file.\n\n" +
      "ALWAYS call this first to get exact 1-based line/character positions before any position-based operation.\n" +
      "Returns the full symbol hierarchy including nested symbols.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Relative path to the file from the worktree root." },
      },
      required: ["file_path"],
    },
  },
  {
    name: "lsp_workspace_symbols",
    description:
      "Search for symbols by name across the entire project.\n\n" +
      "Use when you know a symbol's name but not its location.\n" +
      "Results are paginated — use limit/offset to navigate large result sets.\n" +
      "NOTE: LSP servers do not guarantee stable ordering between calls; paginated results may vary.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Symbol name to search for (partial matches supported)." },
        limit: { type: "number", description: "Maximum number of symbols to return. Defaults to 20." },
        offset: { type: "number", description: "Number of symbols to skip (for pagination). Defaults to 0." },
      },
      required: ["query"],
    },
  },
  {
    name: "lsp_hover",
    description:
      "Get type information and documentation for a symbol at a position.\n\n" +
      "Use to check what type a variable or expression resolves to.\n" +
      "ALWAYS call lsp_document_symbols first to get exact 1-based line/character positions.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Relative path to the file from the worktree root." },
        line: { type: "number", description: "1-based line number of the symbol." },
        character: { type: "number", description: "1-based character offset of the symbol." },
      },
      required: ["file_path", "line", "character"],
    },
  },
  {
    name: "lsp_rename",
    description:
      "Rename a symbol across the entire project — scope-aware, all cross-file references updated atomically.\n\n" +
      "ALWAYS use this instead of search-and-replace for symbol renaming.\n" +
      "ALWAYS call lsp_document_symbols first to get exact 1-based line/character positions.\n" +
      "ALWAYS save the op:XXXX from the result — pass it to undo_write if you need to revert.\n" +
      "The rename is trivial (single file, one occurrence) — multi_replace is fine instead.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Relative path to the file from the worktree root." },
        line: { type: "number", description: "1-based line number of the symbol to rename." },
        character: { type: "number", description: "1-based character offset of the symbol to rename." },
        new_name: { type: "string", description: "The new name for the symbol." },
      },
      required: ["file_path", "line", "character", "new_name"],
    },
  },
  {
    name: "lsp_incoming_calls",
    description:
      "Find all callers of a function — who calls this function.\n\n" +
      "ALWAYS call lsp_document_symbols first to get exact 1-based line/character positions.\n" +
      "Use to understand call graphs and find all usages at the call site level.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Relative path to the file from the worktree root." },
        line: { type: "number", description: "1-based line number of the function." },
        character: { type: "number", description: "1-based character offset of the function." },
      },
      required: ["file_path", "line", "character"],
    },
  },
  {
    name: "lsp_outgoing_calls",
    description:
      "Find all functions called by a function — what this function calls.\n\n" +
      "ALWAYS call lsp_document_symbols first to get exact 1-based line/character positions.\n" +
      "Use to trace execution paths and understand dependencies.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Relative path to the file from the worktree root." },
        line: { type: "number", description: "1-based line number of the function." },
        character: { type: "number", description: "1-based character offset of the function." },
      },
      required: ["file_path", "line", "character"],
    },
  },
  {
    name: "lsp_diagnostics",
    description:
      "Get all errors, warnings, and hints for a file from the language server.\n\n" +
      "Use after editing a file to verify correctness before proceeding.\n" +
      "Returns type errors, unused imports, and other static analysis findings.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Relative path to the file from the worktree root." },
      },
      required: ["file_path"],
    },
  },
  {
    name: "lsp_type_definition",
    description:
      "Navigate to the type definition of a symbol.\n\n" +
      "Use when you need the type declaration, not the value declaration.\n" +
      "ALWAYS call lsp_document_symbols first to get exact 1-based line/character positions.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Relative path to the file from the worktree root." },
        line: { type: "number", description: "1-based line number of the symbol." },
        character: { type: "number", description: "1-based character offset of the symbol." },
      },
      required: ["file_path", "line", "character"],
    },
  },
];

export const LSP_TOOL_NAMES = LSP_TOOL_DEFINITIONS.map((d) => d.name);

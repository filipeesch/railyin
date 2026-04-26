import { resolve, join } from "path";
import { pathToFileURL } from "url";
import type { LSPServerManager } from "../../lsp/manager.ts";
import type { CallHierarchyItem } from "../../lsp/types.ts";
import { applyWorkspaceEdit } from "../../lsp/apply-edits.ts";
import {
  formatDefinition,
  formatReferences,
  formatHover,
  formatDocumentSymbols,
  formatWorkspaceSymbols,
  formatCallHierarchyItems,
  formatIncomingCalls,
  formatOutgoingCalls,
} from "../../lsp/formatters.ts";

function safePath(worktreePath: string, userPath: string): string | null {
  const abs = resolve(join(worktreePath, userPath));
  if (!abs.startsWith(resolve(worktreePath))) return null;
  return abs;
}

export async function executeLspTool(
  args: Record<string, string | number>,
  lspManager: LSPServerManager,
  worktreePath: string,
): Promise<string> {
  const op = (args.operation as string) ?? "";

  const filePath = (args.file_path as string) ?? "";
  const abs = filePath
    ? safePath(worktreePath, filePath)
    : resolve(worktreePath);
  if (!abs) return "Error: file_path is outside the worktree";

  const line0 = args.line !== undefined ? Number(args.line) - 1 : 0;
  const char0 = args.character !== undefined ? Number(args.character) - 1 : 0;
  const docUri = pathToFileURL(abs).toString();
  const pos = { line: line0, character: char0 };

  switch (op) {
    case "goToDefinition": {
      const result = await lspManager.request(abs, "textDocument/definition", { textDocument: { uri: docUri }, position: pos });
      return formatDefinition(result, worktreePath);
    }
    case "findReferences": {
      const result = await lspManager.request(abs, "textDocument/references", { textDocument: { uri: docUri }, position: pos, context: { includeDeclaration: true } });
      return formatReferences(result, worktreePath);
    }
    case "hover": {
      const result = await lspManager.request(abs, "textDocument/hover", { textDocument: { uri: docUri }, position: pos });
      return formatHover(result);
    }
    case "documentSymbol": {
      const result = await lspManager.request(abs, "textDocument/documentSymbol", { textDocument: { uri: docUri } });
      return formatDocumentSymbols(result, worktreePath);
    }
    case "workspaceSymbol": {
      const query = (args.query as string) ?? "";
      const anchorPath = filePath ? abs : resolve(worktreePath);
      const result = await lspManager.requestWorkspaceSymbol(anchorPath, query);
      return formatWorkspaceSymbols(result, worktreePath);
    }
    case "goToImplementation": {
      const result = await lspManager.request(abs, "textDocument/implementation", { textDocument: { uri: docUri }, position: pos });
      return formatDefinition(result, worktreePath, "Implemented");
    }
    case "prepareCallHierarchy": {
      const result = await lspManager.request(abs, "textDocument/prepareCallHierarchy", { textDocument: { uri: docUri }, position: pos });
      return formatCallHierarchyItems(result as CallHierarchyItem[] | null, worktreePath);
    }
    case "incomingCalls": {
      const items = (await lspManager.request(abs, "textDocument/prepareCallHierarchy", { textDocument: { uri: docUri }, position: pos })) as CallHierarchyItem[] | null;
      if (!items || items.length === 0) return "No call hierarchy item found at that position";
      const result = await lspManager.request(abs, "callHierarchy/incomingCalls", { item: items[0] });
      return formatIncomingCalls(result, worktreePath);
    }
    case "outgoingCalls": {
      const items = (await lspManager.request(abs, "textDocument/prepareCallHierarchy", { textDocument: { uri: docUri }, position: pos })) as CallHierarchyItem[] | null;
      if (!items || items.length === 0) return "No call hierarchy item found at that position";
      const result = await lspManager.request(abs, "callHierarchy/outgoingCalls", { item: items[0] });
      return formatOutgoingCalls(result, worktreePath);
    }
    case "typeDefinition": {
      const result = await lspManager.request(abs, "textDocument/typeDefinition", { textDocument: { uri: docUri }, position: pos });
      return formatDefinition(result, worktreePath, "Type defined");
    }
    case "rename": {
      const newName = args.new_name as string;
      if (!newName) return "Error: new_name is required for rename operation";
      const prepareResult = await lspManager.request(abs, "textDocument/prepareRename", { textDocument: { uri: docUri }, position: pos });
      if (!prepareResult) return "Error: cannot rename symbol at this position (server rejected prepareRename)";
      const workspaceEdit = await lspManager.request(abs, "textDocument/rename", { textDocument: { uri: docUri }, position: pos, newName });
      if (!workspaceEdit) return "Error: rename returned no edits";
      const applyResult = applyWorkspaceEdit(workspaceEdit as import("../../lsp/types.ts").WorkspaceEdit, worktreePath);
      if ("error" in applyResult) return `Error applying rename: ${applyResult.error}`;
      for (const relPath of applyResult.filesChanged) {
        lspManager.markStale(resolve(worktreePath, relPath));
      }
      return `Renamed to "${newName}": ${applyResult.summary}`;
    }
    default:
      return `Error: unknown lsp operation "${op}"`;
  }
}

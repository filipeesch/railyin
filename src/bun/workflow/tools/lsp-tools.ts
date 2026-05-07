import { resolve, join, relative } from "path";
import { pathToFileURL } from "url";
import type { LSPServerManager } from "../../lsp/manager.ts";
import type { CallHierarchyItem, Location, LocationLink, Hover, DocumentSymbol, SymbolInformation, CallHierarchyIncomingCall, CallHierarchyOutgoingCall } from "../../lsp/types.ts";
import type { ToolExecutionResult } from "../common-tools.ts";
import { applyWorkspaceEdit } from "../../lsp/apply-edits.ts";
import {
  formatDefinition,
  formatReferences,
  formatHover,
  formatDocumentSymbols,
  formatWorkspaceSymbols,
  formatIncomingCalls,
  formatOutgoingCalls,
} from "../../lsp/formatters.ts";

function safePath(worktreePath: string, userPath: string): string | null {
  const abs = resolve(join(worktreePath, userPath));
  if (!abs.startsWith(resolve(worktreePath))) return null;
  return abs;
}

function requireFilePath(args: Record<string, unknown>, worktreePath: string): { abs: string; docUri: string } | { error: string } {
  const filePath = (args.file_path as string) ?? "";
  if (!filePath) return { error: "Error: file_path is required" };
  const abs = safePath(worktreePath, filePath);
  if (!abs) return { error: "Error: file_path is outside the worktree" };
  return { abs, docUri: pathToFileURL(abs).toString() };
}

function pos0(args: Record<string, unknown>): { line: number; character: number } {
  return {
    line: args.line !== undefined ? Number(args.line) - 1 : 0,
    character: args.character !== undefined ? Number(args.character) - 1 : 0,
  };
}

export async function executeLspGoToDefinition(
  args: Record<string, unknown>,
  lspManager: LSPServerManager,
  worktreePath: string,
): Promise<string> {
  const r = requireFilePath(args, worktreePath);
  if ("error" in r) return r.error;
  const p = pos0(args);
  const result = await lspManager.request(r.abs, "textDocument/definition", { textDocument: { uri: r.docUri }, position: p });
  return formatDefinition(result as Location | Location[] | LocationLink[] | null, worktreePath);
}

export async function executeLspFindReferences(
  args: Record<string, unknown>,
  lspManager: LSPServerManager,
  worktreePath: string,
): Promise<string> {
  const r = requireFilePath(args, worktreePath);
  if ("error" in r) return r.error;
  const p = pos0(args);
  const includeDeclaration = args.include_declaration !== false;
  const limit = args.limit !== undefined ? Number(args.limit) : 50;
  const offset = args.offset !== undefined ? Number(args.offset) : 0;
  const result = (await lspManager.request(r.abs, "textDocument/references", { textDocument: { uri: r.docUri }, position: p, context: { includeDeclaration } })) as Location[] | null;
  const all = result ?? [];
  const page = all.slice(offset, offset + limit);
  const text = formatReferences(page, worktreePath);
  if (all.length > offset + limit) {
    return `${text}\n(showing ${offset + 1}–${offset + page.length} of ${all.length} — use offset=${offset + limit} for more)`;
  }
  return text;
}

export async function executeLspDocumentSymbols(
  args: Record<string, unknown>,
  lspManager: LSPServerManager,
  worktreePath: string,
): Promise<string> {
  const r = requireFilePath(args, worktreePath);
  if ("error" in r) return r.error;
  const result = await lspManager.request(r.abs, "textDocument/documentSymbol", { textDocument: { uri: r.docUri } });
  return formatDocumentSymbols(result as DocumentSymbol[] | SymbolInformation[] | null, worktreePath);
}

export async function executeLspWorkspaceSymbols(
  args: Record<string, unknown>,
  lspManager: LSPServerManager,
  worktreePath: string,
): Promise<string> {
  const query = (args.query as string) ?? "";
  const limit = args.limit !== undefined ? Number(args.limit) : 20;
  const offset = args.offset !== undefined ? Number(args.offset) : 0;
  const anchorPath = resolve(worktreePath);
  const result = (await lspManager.requestWorkspaceSymbol(anchorPath, query)) as SymbolInformation[] | null;
  const all = result ?? [];
  const page = all.slice(offset, offset + limit);
  const text = formatWorkspaceSymbols(page, worktreePath);
  if (all.length > offset + limit) {
    return `${text}\n(showing ${offset + 1}–${offset + page.length} of ${all.length} — use offset=${offset + limit} for more)`;
  }
  return text;
}

export async function executeLspHover(
  args: Record<string, unknown>,
  lspManager: LSPServerManager,
  worktreePath: string,
): Promise<string> {
  const r = requireFilePath(args, worktreePath);
  if ("error" in r) return r.error;
  const p = pos0(args);
  const result = await lspManager.request(r.abs, "textDocument/hover", { textDocument: { uri: r.docUri }, position: p });
  return formatHover(result as Hover | null);
}

export async function executeLspRename(
  args: Record<string, unknown>,
  lspManager: LSPServerManager,
  worktreePath: string,
): Promise<ToolExecutionResult> {
  const r = requireFilePath(args, worktreePath);
  if ("error" in r) return { type: "result", text: r.error };
  const p = pos0(args);
  const newName = args.new_name as string;
  if (!newName) return { type: "result", text: "Error: new_name is required for rename" };

  const prepareResult = await lspManager.request(r.abs, "textDocument/prepareRename", { textDocument: { uri: r.docUri }, position: p });
  if (!prepareResult) return { type: "result", text: "Error: cannot rename symbol at this position (server rejected prepareRename)" };

  const workspaceEdit = await lspManager.request(r.abs, "textDocument/rename", { textDocument: { uri: r.docUri }, position: p, newName });
  if (!workspaceEdit) return { type: "result", text: "Error: rename returned no edits" };

  const applyResult = applyWorkspaceEdit(workspaceEdit as import("../../lsp/types.ts").WorkspaceEdit, worktreePath);
  if ("error" in applyResult) return { type: "result", text: `Error applying rename: ${applyResult.error}` };

  for (const relPath of applyResult.filesChanged) {
    lspManager.markStale(resolve(worktreePath, relPath));
  }

  const text = `Renamed to "${newName}": ${applyResult.summary}`;

  return {
    type: "result",
    text,
    writtenFiles: applyResult.diffs,
    beforeFiles: applyResult.beforeContents,
  };
}

export async function executeLspIncomingCalls(
  args: Record<string, unknown>,
  lspManager: LSPServerManager,
  worktreePath: string,
): Promise<string> {
  const r = requireFilePath(args, worktreePath);
  if ("error" in r) return r.error;
  const p = pos0(args);
  const items = (await lspManager.request(r.abs, "textDocument/prepareCallHierarchy", { textDocument: { uri: r.docUri }, position: p })) as CallHierarchyItem[] | null;
  if (!items || items.length === 0) return "No call hierarchy item found at that position";
  const result = await lspManager.request(r.abs, "callHierarchy/incomingCalls", { item: items[0] });
  return formatIncomingCalls(result as CallHierarchyIncomingCall[] | null, worktreePath);
}

export async function executeLspOutgoingCalls(
  args: Record<string, unknown>,
  lspManager: LSPServerManager,
  worktreePath: string,
): Promise<string> {
  const r = requireFilePath(args, worktreePath);
  if ("error" in r) return r.error;
  const p = pos0(args);
  const items = (await lspManager.request(r.abs, "textDocument/prepareCallHierarchy", { textDocument: { uri: r.docUri }, position: p })) as CallHierarchyItem[] | null;
  if (!items || items.length === 0) return "No call hierarchy item found at that position";
  const result = await lspManager.request(r.abs, "callHierarchy/outgoingCalls", { item: items[0] });
  return formatOutgoingCalls(result as CallHierarchyOutgoingCall[] | null, worktreePath);
}

export async function executeLspDiagnostics(
  args: Record<string, unknown>,
  lspManager: LSPServerManager,
  worktreePath: string,
): Promise<string> {
  const r = requireFilePath(args, worktreePath);
  if ("error" in r) return r.error;

  let diagnostics: Array<{ severity?: number; range?: { start: { line: number; character: number } }; source?: string; message: string }> | null = null;
  try {
    const result = await lspManager.request<{ items?: typeof diagnostics } | null>(r.abs, "textDocument/diagnostic", { textDocument: { uri: r.docUri } });
    diagnostics = result?.items ?? null;
  } catch {
    return "Error: this language server does not support pull diagnostics (textDocument/diagnostic)";
  }

  if (!diagnostics || diagnostics.length === 0) return "No diagnostics — file looks clean.";

  const SEVERITY: Record<number, string> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };
  const lines = diagnostics.map((d) => {
    const sev = SEVERITY[(d.severity as number) ?? 0] ?? "info";
    const line = (d.range?.start?.line ?? 0) + 1;
    const char = (d.range?.start?.character ?? 0) + 1;
    const src = d.source ? `[${d.source}] ` : "";
    return `${sev} ${line}:${char} ${src}${d.message}`;
  });

  const rel = relative(worktreePath, r.abs);
  return `Diagnostics for ${rel}:\n${lines.join("\n")}`;
}

export async function executeLspTypeDefinition(
  args: Record<string, unknown>,
  lspManager: LSPServerManager,
  worktreePath: string,
): Promise<string> {
  const r = requireFilePath(args, worktreePath);
  if ("error" in r) return r.error;
  const p = pos0(args);
  const result = await lspManager.request(r.abs, "textDocument/typeDefinition", { textDocument: { uri: r.docUri }, position: p });
  return formatDefinition(result as Location | Location[] | LocationLink[] | null, worktreePath, "Type defined");
}


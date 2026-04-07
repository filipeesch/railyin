import { relative } from "path";
import { fileURLToPath } from "url";
import type {
  Location,
  LocationLink,
  Hover,
  DocumentSymbol,
  SymbolInformation,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
} from "./types.ts";
import { SYMBOL_KIND_NAMES } from "./types.ts";

const MAX_OUTPUT_CHARS = 100_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a file URI to a workspace-relative path. Returns raw URI on failure. */
function uriToRelPath(uri: string, worktreePath: string): string {
  try {
    const abs = fileURLToPath(uri);
    return relative(worktreePath, abs);
  } catch {
    return uri;
  }
}

/** Convert 0-based line/char to 1-based display string: "file.ts:42:10" */
function loc(relPath: string, line: number, character: number): string {
  return `${relPath}:${line + 1}:${character + 1}`;
}

function cap(output: string): string {
  if (output.length > MAX_OUTPUT_CHARS) {
    return output.slice(0, MAX_OUTPUT_CHARS) + "\n[truncated]";
  }
  return output;
}

// ─── goToDefinition / goToImplementation ─────────────────────────────────────

export function formatDefinition(
  result: Location | Location[] | LocationLink[] | null,
  worktreePath: string,
  opLabel = "Defined",
): string {
  if (!result) return "(no definition found)";

  const locations: Array<{ uri: string; line: number; char: number }> = [];

  if (Array.isArray(result)) {
    for (const item of result) {
      if ("targetUri" in item) {
        // LocationLink
        locations.push({ uri: item.targetUri, line: item.targetSelectionRange.start.line, char: item.targetSelectionRange.start.character });
      } else {
        // Location
        locations.push({ uri: item.uri, line: item.range.start.line, char: item.range.start.character });
      }
    }
  } else {
    locations.push({ uri: result.uri, line: result.range.start.line, char: result.range.start.character });
  }

  if (locations.length === 0) return "(no definition found)";

  if (locations.length === 1) {
    const { uri, line, char } = locations[0];
    return `${opLabel} in ${loc(uriToRelPath(uri, worktreePath), line, char)}`;
  }

  const lines = [`${opLabel} in ${locations.length} locations:`];
  for (const { uri, line, char } of locations) {
    lines.push(`  ${loc(uriToRelPath(uri, worktreePath), line, char)}`);
  }
  return cap(lines.join("\n"));
}

// ─── findReferences ───────────────────────────────────────────────────────────

export function formatReferences(
  result: Location[] | null,
  worktreePath: string,
): string {
  if (!result || result.length === 0) return "(no references found)";

  // Group by file
  const byFile = new Map<string, Array<{ line: number; char: number }>>();
  for (const loc of result) {
    const rel = uriToRelPath(loc.uri, worktreePath);
    const entries = byFile.get(rel) ?? [];
    entries.push({ line: loc.range.start.line, char: loc.range.start.character });
    byFile.set(rel, entries);
  }

  const fileCount = byFile.size;
  const lines = [`Found ${result.length} reference${result.length !== 1 ? "s" : ""} across ${fileCount} file${fileCount !== 1 ? "s" : ""}:`];

  for (const [relPath, positions] of byFile) {
    lines.push(`\n${relPath}:`);
    for (const { line, char } of positions) {
      lines.push(`  Line ${line + 1}:${char + 1}`);
    }
  }

  return cap(lines.join("\n"));
}

// ─── hover ───────────────────────────────────────────────────────────────────

export function formatHover(result: Hover | null): string {
  if (!result) return "(no hover information)";

  const { contents } = result;
  if (typeof contents === "string") return contents || "(no hover information)";
  if ("kind" in contents) return contents.value || "(no hover information)";
  if ("language" in contents) return "```" + contents.language + "\n" + contents.value + "\n```";
  if (Array.isArray(contents)) {
    return contents.map((c) =>
      typeof c === "string" ? c : ("kind" in c ? c.value : "```" + c.language + "\n" + c.value + "\n```")
    ).filter(Boolean).join("\n\n") || "(no hover information)";
  }
  return "(no hover information)";
}

// ─── documentSymbol ───────────────────────────────────────────────────────────

export function formatDocumentSymbols(
  result: DocumentSymbol[] | SymbolInformation[] | null,
  worktreePath: string,
): string {
  if (!result || result.length === 0) return "(no symbols found)";

  const lines: string[] = [];

  if (result.length > 0 && "children" in result[0]) {
    // DocumentSymbol (hierarchical)
    const renderSymbol = (sym: DocumentSymbol, indent = ""): void => {
      const kind = SYMBOL_KIND_NAMES[sym.kind] ?? `Kind(${sym.kind})`;
      lines.push(`${indent}${kind}: ${sym.name} (line ${sym.selectionRange.start.line + 1})`);
      for (const child of sym.children ?? []) {
        renderSymbol(child, indent + "  ");
      }
    };
    for (const sym of result as DocumentSymbol[]) renderSymbol(sym);
  } else {
    // SymbolInformation (flat)
    for (const sym of result as SymbolInformation[]) {
      const kind = SYMBOL_KIND_NAMES[sym.kind] ?? `Kind(${sym.kind})`;
      const rel = uriToRelPath(sym.location.uri, worktreePath);
      lines.push(`${kind}: ${sym.name} — ${loc(rel, sym.location.range.start.line, sym.location.range.start.character)}`);
    }
  }

  return cap(lines.join("\n"));
}

// ─── workspaceSymbol ─────────────────────────────────────────────────────────

export function formatWorkspaceSymbols(
  result: SymbolInformation[] | null,
  worktreePath: string,
): string {
  if (!result || result.length === 0) return "(no symbols found)";
  return formatDocumentSymbols(result, worktreePath);
}

// ─── Call hierarchy ───────────────────────────────────────────────────────────

export function formatCallHierarchyItems(items: CallHierarchyItem[] | null, worktreePath: string): string {
  if (!items || items.length === 0) return "(no call hierarchy results)";
  const lines = items.map((item) => {
    const rel = uriToRelPath(item.uri, worktreePath);
    const kind = SYMBOL_KIND_NAMES[item.kind] ?? `Kind(${item.kind})`;
    return `${kind}: ${item.name} — ${loc(rel, item.selectionRange.start.line, item.selectionRange.start.character)}`;
  });
  return lines.join("\n");
}

export function formatIncomingCalls(
  result: CallHierarchyIncomingCall[] | null,
  worktreePath: string,
): string {
  if (!result || result.length === 0) return "(no incoming calls found)";
  const lines = [`Found ${result.length} incoming call${result.length !== 1 ? "s" : ""}:`];
  for (const call of result) {
    const rel = uriToRelPath(call.from.uri, worktreePath);
    const kind = SYMBOL_KIND_NAMES[call.from.kind] ?? "Symbol";
    lines.push(`\n${kind}: ${call.from.name} — ${rel}`);
    for (const range of call.fromRanges) {
      lines.push(`  called at line ${range.start.line + 1}:${range.start.character + 1}`);
    }
  }
  return cap(lines.join("\n"));
}

export function formatOutgoingCalls(
  result: CallHierarchyOutgoingCall[] | null,
  worktreePath: string,
): string {
  if (!result || result.length === 0) return "(no outgoing calls found)";
  const lines = [`Found ${result.length} outgoing call${result.length !== 1 ? "s" : ""}:`];
  for (const call of result) {
    const rel = uriToRelPath(call.to.uri, worktreePath);
    const kind = SYMBOL_KIND_NAMES[call.to.kind] ?? "Symbol";
    lines.push(`\n${kind}: ${call.to.name} — ${rel}`);
    for (const range of call.fromRanges) {
      lines.push(`  at line ${range.start.line + 1}:${range.start.character + 1}`);
    }
  }
  return cap(lines.join("\n"));
}

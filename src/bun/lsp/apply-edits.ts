import { readFileSync, writeFileSync } from "fs";
import { relative } from "path";
import { fileURLToPath } from "url";
import type { WorkspaceEdit, TextEdit } from "./types.ts";

export interface ApplyResult {
  filesChanged: string[];
  summary: string;
}

/**
 * Apply a WorkspaceEdit (returned by rename, format, codeAction) to disk.
 * Edits are applied in reverse range order within each file to preserve character offsets.
 */
export function applyWorkspaceEdit(
  edit: WorkspaceEdit,
  worktreePath: string,
): ApplyResult | { error: string } {
  const byUri = new Map<string, TextEdit[]>();

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      byUri.set(uri, edits);
    }
  } else if (edit.documentChanges) {
    for (const docChange of edit.documentChanges) {
      const uri = docChange.textDocument.uri;
      const existing = byUri.get(uri) ?? [];
      byUri.set(uri, [...existing, ...docChange.edits]);
    }
  }

  if (byUri.size === 0) {
    return { filesChanged: [], summary: "No changes needed" };
  }

  const filesChanged: string[] = [];
  const fileSummaries: string[] = [];

  for (const [uri, edits] of byUri) {
    let absPath: string;
    try {
      absPath = fileURLToPath(uri);
    } catch {
      return { error: `Invalid file URI: ${uri}` };
    }

    let content: string;
    try {
      content = readFileSync(absPath, "utf-8");
    } catch (e) {
      return { error: `Cannot read file ${absPath}: ${e instanceof Error ? e.message : String(e)}` };
    }

    // Sort descending by position so each splice doesn't invalidate later (earlier in file) offsets
    const sorted = [...edits].sort((a, b) => {
      if (b.range.start.line !== a.range.start.line) return b.range.start.line - a.range.start.line;
      return b.range.start.character - a.range.start.character;
    });

    for (const textEdit of sorted) {
      const startOffset = positionToOffset(content, textEdit.range.start.line, textEdit.range.start.character);
      const endOffset = positionToOffset(content, textEdit.range.end.line, textEdit.range.end.character);
      content = content.slice(0, startOffset) + textEdit.newText + content.slice(endOffset);
    }

    try {
      writeFileSync(absPath, content, "utf-8");
    } catch (e) {
      return { error: `Cannot write file ${absPath}: ${e instanceof Error ? e.message : String(e)}` };
    }

    const relPath = relative(worktreePath, absPath);
    filesChanged.push(relPath);
    fileSummaries.push(`${relPath}:${edits.length}`);
  }

  const summary = filesChanged.length === 1
    ? `1 file changed (${fileSummaries[0]})`
    : `${filesChanged.length} files changed (${fileSummaries.join(", ")})`;

  return { filesChanged, summary };
}

/** Convert 0-based (line, character) to a byte offset in a UTF-8 string. */
function positionToOffset(content: string, line: number, character: number): number {
  let offset = 0;
  let currentLine = 0;
  while (currentLine < line && offset < content.length) {
    const nl = content.indexOf("\n", offset);
    if (nl === -1) break;
    offset = nl + 1;
    currentLine++;
  }
  return offset + character;
}

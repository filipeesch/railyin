/**
 * Shared diff parsing utilities for unified diff format.
 *
 * Used by both Copilot and Cursor engines to parse edit/write diffString
 * into FileDiffPayload with hunks for file-diff rendering.
 */

import type { FileDiffPayload, Hunk } from "../../shared/rpc-types.ts";

/**
 * Parse a unified diff string into a FileDiffPayload with hunks.
 *
 * Handles:
 *   - --- a/path / +++ b/path headers
 *   - @@ -old_start,old_count +new_start,new_count @@ hunk headers
 *   - + added lines, - removed lines, space context lines
 *   - /dev/null for new/deleted files
 */
export function parseUnifiedDiff(
  diffText: string,
  fallbackPath: string,
  operation: FileDiffPayload["operation"],
): FileDiffPayload {
  const lines = diffText.split("\n");
  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let path = fallbackPath;
  let toPath: string | undefined;
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      const raw = line.slice(4).trim().replace(/^[ab]\//, "");
      if (raw !== "/dev/null") path = raw;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim().replace(/^[ab]\//, "");
      if (raw !== "/dev/null") toPath = raw;
      continue;
    }
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      currentHunk = { old_start: Number(header[1]), new_start: Number(header[2]), lines: [] };
      hunks.push(currentHunk);
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith("+") && !line.startsWith("++")) {
      currentHunk.lines.push({ type: "added", new_line: newLine, content: line.slice(1) });
      newLine++;
      added++;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("--")) {
      currentHunk.lines.push({ type: "removed", old_line: oldLine, content: line.slice(1) });
      oldLine++;
      removed++;
      continue;
    }
    if (line.startsWith(" ")) {
      currentHunk.lines.push({ type: "context", old_line: oldLine, new_line: newLine, content: line.slice(1) });
      oldLine++;
      newLine++;
    }
  }

  return {
    operation,
    path,
    ...(toPath && toPath !== path ? { to_path: toPath } : {}),
    added,
    removed,
    ...(hunks.length > 0 ? { hunks } : {}),
  };
}

import type { CodeReviewPayload, CodeReviewHunk, LineComment } from "../../shared/rpc-types.ts";

const DEFAULT_REJECT_COMMENT = "The user explicitly rejected this change.";

/**
 * Formats a CodeReviewPayload into a plain-text message for the LLM.
 * Only includes rejected and change_request hunks — accepted and pending hunks are omitted.
 * Line comments are always included.
 */
export function formatReviewMessageForLLM(payload: CodeReviewPayload): string {
  const rejectedItems: string[] = [];
  const changeRequestItems: string[] = [];
  const lineCommentItems: string[] = [];

  for (const file of payload.files) {
    const rejected = file.hunks.filter((h) => h.decision === "rejected");
    const changeRequested = file.hunks.filter((h) => h.decision === "change_request");

    for (const hunk of rejected) {
      const comment = hunk.comment?.trim() || DEFAULT_REJECT_COMMENT;
      const range = formatRange(hunk);
      const block = formatDiffBlock(hunk);
      rejectedItems.push(`  • ${file.path}${range}\n    → "${comment}"${block ? "\n" + block : ""}`);
    }

    for (const hunk of changeRequested) {
      const comment = hunk.comment?.trim() ?? "";
      const range = formatRange(hunk);
      const block = formatDiffBlock(hunk);
      changeRequestItems.push(`  • ${file.path}${range}\n    → "${comment}"${block ? "\n" + block : ""}`);
    }

    for (const lc of (file.lineComments ?? [])) {
      lineCommentItems.push(formatLineComment(file.path, lc));
    }
  }

  const hasActionable = rejectedItems.length > 0 || changeRequestItems.length > 0 || lineCommentItems.length > 0 || (payload.manualEdits?.length ?? 0) > 0;

  if (!hasActionable) {
    return "=== Code Review ===\n\nAll changes were accepted. No action required.";
  }

  const sections: string[] = ["=== Code Review ==="];

  if (rejectedItems.length > 0) {
    sections.push(
      "❌ REJECTED — already reverted in your worktree:\n" + rejectedItems.join("\n\n"),
    );
  }

  if (changeRequestItems.length > 0) {
    sections.push(
      "📝 CHANGE REQUESTED — code kept as-is, apply these targeted fixes:\n" +
      changeRequestItems.join("\n\n"),
    );
  }

  if (lineCommentItems.length > 0) {
    sections.push(
      "💬 LINE COMMENTS — contextual feedback on specific lines:\n" +
      lineCommentItems.join("\n\n"),
    );
  }

  if (payload.manualEdits && payload.manualEdits.length > 0) {
    const editItems = payload.manualEdits.map(
      (e) => `  • ${e.filePath}\n\`\`\`diff\n${e.unifiedDiff}\n\`\`\``,
    );
    sections.push(
      "✏️ MANUAL EDITS — the user directly edited these files in the diff editor:\n" +
      editItems.join("\n\n"),
    );
  }

  sections.push("Please address all rejected, change-requested items, line comments, and respect the manual edits.");

  return sections.join("\n\n");
}

function formatRange(hunk: CodeReviewHunk): string {
  const [modStart, modEnd] = hunk.modifiedRange;
  if (modStart === 0 && modEnd === 0) {
    // Deletion hunk — use original range
    const [origStart, origEnd] = hunk.originalRange;
    return origStart > 0 ? `, lines ${origStart}–${origEnd}` : "";
  }
  return modStart > 0 ? `, lines ${modStart}–${modEnd}` : "";
}

function formatDiffBlock(hunk: CodeReviewHunk): string {
  const orig = hunk.originalLines ?? [];
  const mod = hunk.modifiedLines ?? [];
  if (orig.length === 0 && mod.length === 0) return "";
  const lines: string[] = ["```diff"];
  for (const l of orig) lines.push(`- ${l}`);
  for (const l of mod) lines.push(`+ ${l}`);
  lines.push("```");
  return lines.map((l) => "    " + l).join("\n");
}

function formatLineComment(filePath: string, lc: LineComment): string {
  const rangeLabel = lc.lineStart === lc.lineEnd
    ? `line ${lc.lineStart}`
    : `lines ${lc.lineStart}–${lc.lineEnd}`;
  const contextLines = lc.contextLines ?? [];
  const commentedLines = lc.lineText ?? [];

  const blockLines: string[] = [`  • ${filePath}, ${rangeLabel}\n    → "${lc.comment}"`];

  if (contextLines.length > 0 || commentedLines.length > 0) {
    blockLines.push("    ```");
    const commentedSet = new Set(commentedLines);
    for (const line of contextLines) {
      const marker = commentedSet.has(line) ? "  > " : "    ";
      blockLines.push(`    ${marker}${line}`);
    }
    blockLines.push("    ```");
  }

  return blockLines.join("\n");
}

import type { CodeReviewPayload, CodeReviewHunk } from "../../shared/rpc-types.ts";

const DEFAULT_REJECT_COMMENT = "The user explicitly rejected this change.";

/**
 * Formats a CodeReviewPayload into a plain-text message for the LLM.
 * Only includes rejected and change_request hunks — accepted and pending hunks are omitted.
 */
export function formatReviewMessageForLLM(payload: CodeReviewPayload): string {
  const rejectedItems: string[] = [];
  const changeRequestItems: string[] = [];

  for (const file of payload.files) {
    const rejected = file.hunks.filter((h) => h.decision === "rejected");
    const changeRequested = file.hunks.filter((h) => h.decision === "change_request");

    for (const hunk of rejected) {
      const comment = hunk.comment?.trim() || DEFAULT_REJECT_COMMENT;
      const range = formatRange(hunk);
      rejectedItems.push(`  • ${file.path}${range}\n    → "${comment}"`);
    }

    for (const hunk of changeRequested) {
      const comment = hunk.comment?.trim() ?? "";
      const range = formatRange(hunk);
      changeRequestItems.push(`  • ${file.path}${range}\n    → "${comment}"`);
    }
  }

  const hasActionable = rejectedItems.length > 0 || changeRequestItems.length > 0;

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

  sections.push("Please address all rejected and change-requested items.");

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

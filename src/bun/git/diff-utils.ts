import { createHash } from "crypto";
import type { Database } from "bun:sqlite";
import type { FileDiffContent, HunkWithDecisions, HunkDecision, ReviewerDecision } from "../../shared/rpc-types.ts";

// ─── Hunk model ───────────────────────────────────────────────────────────────

export interface ParsedHunk {
  hash: string;
  hunkIndex: number;
  originalStart: number;
  originalEnd: number;
  modifiedStart: number;
  modifiedEnd: number;
  /** First/last "+" line in the modified file (excluding context). Both 0 for pure deletions. */
  modifiedContentStart: number;
  modifiedContentEnd: number;
  /** First/last "-" line in the original file (excluding context). Both 0 for pure additions. */
  originalContentStart: number;
  originalContentEnd: number;
}

// ─── Hunk hash computation ────────────────────────────────────────────────────

export function computeHunkHash(filePath: string, originalLines: string[], modifiedLines: string[]): string {
  return createHash("sha256")
    .update(filePath + "\0" + originalLines.join("\n") + "\0" + modifiedLines.join("\n"))
    .digest("hex");
}

// ─── Git diff hunk parser ─────────────────────────────────────────────────────

export function parseGitDiffHunks(diffOutput: string, filePath: string): ParsedHunk[] {
  const lines = diffOutput.split("\n");
  const result: ParsedHunk[] = [];
  let hunkIndex = 0;

  // Regex: @@ -<orig_start>,<orig_count> +<mod_start>,<mod_count> @@
  const hhRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  let i = 0;
  while (i < lines.length) {
    const m = hhRe.exec(lines[i]);
    if (!m) { i++; continue; }

    const origStart = parseInt(m[1], 10);
    const origCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    const modStart = parseInt(m[3], 10);
    const modCount = m[4] !== undefined ? parseInt(m[4], 10) : 1;

    // Collect lines of this hunk (until next @@ or end)
    const hunkBodyLines: string[] = [];
    i++;
    while (i < lines.length && !hhRe.test(lines[i])) {
      hunkBodyLines.push(lines[i]);
      i++;
    }

    const originalLines = hunkBodyLines.filter((l) => l.startsWith("-") || l.startsWith(" ")).map((l) => l.slice(1));
    const modifiedLines = hunkBodyLines.filter((l) => l.startsWith("+") || l.startsWith(" ")).map((l) => l.slice(1));
    const hash = computeHunkHash(filePath, originalLines, modifiedLines);

    // Compute content ranges: first/last actual +/- lines, excluding surrounding context.
    // These are used by correlateHunks in the frontend to correctly place action bar zones.
    let origI = origStart;
    let modI = modStart;
    let modifiedContentStart = 0, modifiedContentEnd = 0;
    let originalContentStart = 0, originalContentEnd = 0;
    for (const line of hunkBodyLines) {
      if (line.startsWith("+")) {
        if (modifiedContentStart === 0) modifiedContentStart = modI;
        modifiedContentEnd = modI;
        modI++;
      } else if (line.startsWith("-")) {
        if (originalContentStart === 0) originalContentStart = origI;
        originalContentEnd = origI;
        origI++;
      } else if (line.startsWith(" ")) {
        modI++;
        origI++;
      }
    }

    result.push({
      hash,
      hunkIndex,
      originalStart: origStart,
      originalEnd: origStart + origCount - 1,
      modifiedStart: modStart,
      modifiedEnd: modStart + modCount - 1,
      modifiedContentStart,
      modifiedContentEnd,
      originalContentStart,
      originalContentEnd,
    });
    hunkIndex++;
  }

  return result;
}

// ─── Hunk patch extraction helper ────────────────────────────────────────────

export function extractHunkPatch(diffOutput: string, hunkIndex: number, filePath: string): string {
  const lines = diffOutput.split("\n");

  // Find the file header lines (--- and +++ lines)
  const headerLines: string[] = [];
  const hunkStarts: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      headerLines.push(line);
    } else if (line.startsWith("@@ ")) {
      hunkStarts.push(i);
    }
  }

  if (hunkIndex >= hunkStarts.length) {
    throw new Error(`Hunk index ${hunkIndex} out of range (${hunkStarts.length} hunks found)`);
  }

  const hunkStart = hunkStarts[hunkIndex];
  const hunkEnd = hunkIndex + 1 < hunkStarts.length ? hunkStarts[hunkIndex + 1] : lines.length;
  const hunkLines = lines.slice(hunkStart, hunkEnd);

  // Build a minimal patch with just this hunk
  const patch = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    ...hunkLines,
    "",
  ].join("\n");

  return patch;
}

// ─── File diff content reader ─────────────────────────────────────────────────

export async function readFileDiffContent(
  db: Database,
  taskId: number,
  worktreePath: string,
  filePath: string,
  checkpointRef?: string,
  baseSha?: string,
): Promise<FileDiffContent> {
  // Determine the base ref: use checkpoint if provided, then base_sha, then HEAD
  const baseRef = checkpointRef || baseSha || "HEAD";

  let original = "";
  try {
    const headProc = Bun.spawn(["git", "show", `${baseRef}:${filePath}`], {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    await headProc.exited;
    if (headProc.exitCode === 0) {
      original = await new Response(headProc.stdout).text();
    }
  } catch { /* new file */ }

  let modified = "";
  try {
    const file = Bun.file(`${worktreePath}/${filePath}`);
    if (await file.exists()) {
      modified = await file.text();
    }
  } catch { /* deleted file */ }

  // Parse git diff to get hunk metadata + hashes
  let hunks: HunkWithDecisions[] = [];
  try {
    const diffArgs = baseRef !== "HEAD"
      ? ["git", "diff", baseRef, "HEAD", "--", filePath]
      : ["git", "diff", "HEAD", "--", filePath];
    const diffProc = Bun.spawn(diffArgs, {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    await diffProc.exited;
    const diffOutput = await new Response(diffProc.stdout).text();
    if (diffOutput.trim()) {
      const parsed = parseGitDiffHunks(diffOutput, filePath);
      // Join with decisions from DB for the human reviewer
      const decisionRows = db
        .query<{ hunk_hash: string; reviewer_type: string; reviewer_id: string; decision: string; comment: string | null }, [number, string]>(
          "SELECT hunk_hash, reviewer_type, reviewer_id, decision, comment FROM task_hunk_decisions WHERE task_id = ? AND file_path = ?",
        )
        .all(taskId, filePath);
      const decisionMap = new Map<string, { reviewerType: string; reviewerId: string; decision: string; comment: string | null }[]>();
      for (const row of decisionRows) {
        const existing = decisionMap.get(row.hunk_hash) ?? [];
        existing.push({ reviewerType: row.reviewer_type, reviewerId: row.reviewer_id, decision: row.decision, comment: row.comment });
        decisionMap.set(row.hunk_hash, existing);
      }

      hunks = parsed.map((h) => {
        const allDecisions = decisionMap.get(h.hash) ?? [];
        const decisions: ReviewerDecision[] = allDecisions.map((d) => ({
          reviewerId: d.reviewerId,
          reviewerType: d.reviewerType as "human" | "ai",
          decision: d.decision as HunkDecision,
          comment: d.comment,
        }));
        const humanDecisionRow = allDecisions.find((d) => d.reviewerId === "user");
        return {
          hash: h.hash,
          hunkIndex: h.hunkIndex,
          originalStart: h.originalStart,
          originalEnd: h.originalEnd,
          modifiedStart: h.modifiedStart,
          modifiedEnd: h.modifiedEnd,
          modifiedContentStart: h.modifiedContentStart,
          modifiedContentEnd: h.modifiedContentEnd,
          originalContentStart: h.originalContentStart,
          originalContentEnd: h.originalContentEnd,
          decisions,
          humanDecision: (humanDecisionRow?.decision ?? "pending") as HunkDecision,
          humanComment: humanDecisionRow?.comment ?? null,
        };
      });
    } else if (!original && modified) {
      // Untracked file (never `git add`ed): no diff from git, but file exists on disk.
      // Synthesize a single hunk covering the whole file so the review UI can show it.
      const modifiedLines = modified.split("\n");
      const hash = computeHunkHash(filePath, [], modifiedLines);
      const humanDecisionRow = db
        .query<{ decision: string; comment: string | null }, [number, string]>(
          "SELECT decision, comment FROM task_hunk_decisions WHERE task_id = ? AND hunk_hash = ? AND reviewer_id = 'user' LIMIT 1",
        )
        .get(taskId, hash);
      hunks = [{
        hash,
        hunkIndex: 0,
        originalStart: 0,
        originalEnd: 0,
        modifiedStart: 1,
        modifiedEnd: modifiedLines.length,
        modifiedContentStart: 1,
        modifiedContentEnd: modifiedLines.length,
        originalContentStart: 0,
        originalContentEnd: 0,
        decisions: humanDecisionRow
          ? [{ reviewerId: "user", reviewerType: "human", decision: humanDecisionRow.decision as HunkDecision, comment: humanDecisionRow.comment }]
          : [],
        humanDecision: (humanDecisionRow?.decision ?? "pending") as HunkDecision,
        humanComment: humanDecisionRow?.comment ?? null,
      }];
    }
  } catch { /* ignore diff parse errors */ }

  return { original, modified, hunks };
}

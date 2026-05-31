import type { FileDiffPayload, Hunk, HunkLine } from "../../shared/rpc-types.ts";
// ---------------------------------------------------------------------------
// splitLines
// ---------------------------------------------------------------------------

/**
 * Count lines using consistent spec semantics:
 * - Empty string → 0 lines
 * - Single "\n" → 1 line (one blank line)
 * - Trailing newline does NOT add an extra line
 *   e.g. "a\nb\n" → 2 lines (same as "a\nb")
 */
export function splitLines(text: string): number {
  if (text === "") return 0;
  const newlineCount = (text.match(/\n/g) || []).length;
  // If string doesn't end with \n, the last segment is a line
  return text.endsWith("\n") ? newlineCount : newlineCount + 1;
}


export function myersDiff(before: string[], after: string[]): Hunk[] {
  const N = before.length;
  const M = after.length;
  const MAX = N + M;

  if (MAX === 0) return [];

  const v = new Array<number>(2 * MAX + 2).fill(0);
  const trace: number[][] = [];

  let found = false;
  for (let d = 0; d <= MAX && !found; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      const ki = k + MAX;
      let x: number;
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        x = v[ki + 1];
      } else {
        x = v[ki - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && before[x] === after[y]) { x++; y++; }
      v[ki] = x;
      if (x >= N && y >= M) { found = true; break; }
    }
  }

  type Op =
    | { type: "="; x: number; y: number }
    | { type: "+"; y: number }
    | { type: "-"; x: number };

  const ops: Op[] = [];
  let x = N;
  let y = M;

  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d]; // trace[d] = v snapshot from start of level d = state after level d-1
    const k = x - y;
    const ki = k + MAX;
    const prevK = (k <= -(d - 1) || (k !== d - 1 && prev[ki - 1] < prev[ki + 1]))
      ? k + 1
      : k - 1;
    const prevX = prev[prevK + MAX];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--; y--;
      ops.unshift({ type: "=", x, y });
    }
    if (x > prevX) {
      ops.unshift({ type: "-", x: prevX });
    } else if (y > prevY) {
      ops.unshift({ type: "+", y: prevY });
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { x--; y--; ops.unshift({ type: "=", x, y }); }

  if (ops.length === 0) return [];

  const CONTEXT = 3;
  const hunks: Hunk[] = [];

  const buildHunk = (segment: Op[]): Hunk => {
    const lines: HunkLine[] = segment.map((op) => {
      if (op.type === "=") {
        return { type: "context" as const, old_line: op.x + 1, new_line: op.y + 1, content: before[op.x] };
      } else if (op.type === "-") {
        return { type: "removed" as const, old_line: op.x + 1, content: before[op.x] };
      } else {
        return { type: "added" as const, new_line: op.y + 1, content: after[op.y] };
      }
    });
    const first = segment[0];
    const oldStart = first.type === "+" ? (lines.find((l) => l.old_line != null)?.old_line ?? 1) : first.type === "=" ? first.x + 1 : first.x + 1;
    const newStart = first.type === "-" ? (lines.find((l) => l.new_line != null)?.new_line ?? 1) : first.type === "=" ? first.y + 1 : first.y + 1;
    return { old_start: oldStart, new_start: newStart, lines };
  };

  let segment: Op[] = [];
  let pendingCtx: Op[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type !== "=") {
      segment.push(...pendingCtx);
      pendingCtx = [];
      segment.push(op);
    } else {
      if (segment.length > 0) {
        pendingCtx.push(op);
        if (pendingCtx.length >= CONTEXT) {
          const hasChangeAhead = ops.slice(i + 1, i + CONTEXT + 1).some((o) => o.type !== "=");
          if (!hasChangeAhead) {
            hunks.push(buildHunk(segment));
            segment = [];
            pendingCtx = [];
          }
        }
      } else {
        pendingCtx.push(op);
        if (pendingCtx.length > CONTEXT) pendingCtx.shift();
      }
    }
  }
  if (segment.length > 0) {
    segment.push(...pendingCtx.slice(0, CONTEXT));
    hunks.push(buildHunk(segment));
  }

  return hunks;
}

export function computeFileDiff(
  before: string,
  after: string,
  relPath: string,
  operation: FileDiffPayload["operation"] = "edit_file",
  opts?: { isNew?: boolean; toPath?: string },
): FileDiffPayload {
  const beforeLines = before ? before.split("\n") : [];
  const afterLines = after ? after.split("\n") : [];
  // Strip trailing empty string from split (caused by trailing newline)
  if (beforeLines.length > 0 && beforeLines[beforeLines.length - 1] === "") beforeLines.pop();
  if (afterLines.length > 0 && afterLines[afterLines.length - 1] === "") afterLines.pop();
  const hunks = myersDiff(beforeLines, afterLines);
  // Derive counts from hunk results, not raw array lengths
  const added = hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.type === "added").length, 0);
  const removed = hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.type === "removed").length, 0);
  return {
    operation,
    path: relPath,
    hunks,
    added,
    removed,
    ...(opts?.isNew !== undefined ? { is_new: opts.isNew } : {}),
    ...(opts?.toPath !== undefined ? { to_path: opts.toPath } : {}),
  };
}

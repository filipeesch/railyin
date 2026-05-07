import type { FileDiffPayload, Hunk, HunkLine } from "../../shared/rpc-types.ts";

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
    const prev = trace[d - 1];
    const k = x - y;
    const ki = k + MAX;
    const prevK = (k === -(d - 1) || (k !== d - 1 && prev[ki - 1] < prev[ki + 1]))
      ? k + 1
      : k - 1;
    const prevX = prev[prevK + MAX];
    const prevY = prevX - prevK;

    while (x > prevX + 1 && y > prevY + 1) {
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
        if (pendingCtx.length === CONTEXT) {
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
  const hunks = myersDiff(beforeLines, afterLines);
  const added = afterLines.length;
  const removed = beforeLines.length;
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

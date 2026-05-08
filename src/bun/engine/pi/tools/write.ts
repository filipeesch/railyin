import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import { Type } from "@earendil-works/pi-ai";
import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync, mkdirSync } from "node:fs";
import { join, resolve, relative, dirname, isAbsolute } from "node:path";
import type { FileDiffPayload, Hunk, HunkLine } from "../../../../shared/rpc-types.ts";
import { safePath } from "./read.ts";

// ---------------------------------------------------------------------------
// Myers diff
// ---------------------------------------------------------------------------

function myersDiff(before: string[], after: string[]): Hunk[] {
  const N = before.length;
  const M = after.length;
  const MAX = N + M;

  if (MAX === 0) return [];

  // Forward pass: record the frontier for each edit distance d
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

  // Back-trace to build edit operations: "=", "+", "-"
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

    // diagonal snakes
    while (x > prevX + 1 && y > prevY + 1) {
      x--; y--;
      ops.unshift({ type: "=", x, y });
    }
    // the move
    if (x > prevX) {
      ops.unshift({ type: "-", x: prevX });
    } else if (y > prevY) {
      ops.unshift({ type: "+", y: prevY });
    }
    x = prevX;
    y = prevY;
  }
  // remaining diagonal at the start
  while (x > 0 && y > 0) { x--; y--; ops.unshift({ type: "=", x, y }); }

  if (ops.length === 0) return [];

  // Group into hunks with 3 context lines
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
      // flush pending context into segment
      segment.push(...pendingCtx);
      pendingCtx = [];
      segment.push(op);
    } else {
      if (segment.length > 0) {
        pendingCtx.push(op);
        if (pendingCtx.length === CONTEXT) {
          // check if another change follows within range
          const hasChangeAhead = ops.slice(i + 1, i + CONTEXT + 1).some((o) => o.type !== "=");
          if (!hasChangeAhead) {
            hunks.push(buildHunk(segment));
            segment = [];
            pendingCtx = [];
          }
        }
      } else {
        // leading context: keep last CONTEXT lines
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

// ---------------------------------------------------------------------------
// Diff builder
// ---------------------------------------------------------------------------

function buildDiff(
  rel: string,
  operation: FileDiffPayload["operation"],
  before: string,
  after: string,
  opts?: { isNew?: boolean; toPath?: string },
): FileDiffPayload {
  const beforeLines = before ? before.split("\n") : [];
  const afterLines = after ? after.split("\n") : [];
  const hunks = myersDiff(beforeLines, afterLines);
  const added = afterLines.length;
  const removed = beforeLines.length;
  return {
    operation,
    path: rel,
    hunks,
    added,
    removed,
    ...(opts?.isNew !== undefined ? { is_new: opts.isNew } : {}),
    ...(opts?.toPath !== undefined ? { to_path: opts.toPath } : {}),
  };
}

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

const writeFileParams = Type.Object({
  path: Type.String(),
  content: Type.String(),
});

function writeFileTool(harnessCtx: HarnessContext): AgentTool<typeof writeFileParams> {
  return {
    name: "write_file",
    label: "Write File",
    description: `Create or fully overwrite a file in the worktree.

ALWAYS save the op:XXXX from the result — pass it to undo_write if you need to revert.
NEVER use run_command to write files — ALWAYS use write_file or patch_file.
Use patch_file for targeted edits to existing files; use write_file only when rewriting the entire file.`,
    parameters: writeFileParams,
    execute: async (_toolCallId, args) => {
      const checked = safePath(harnessCtx.worktreePath, args.path);
      if (!checked.safe) {
        return { content: [{ type: "text", text: checked.error }], details: null, isError: true };
      }
      const { abs, rel } = checked;

      const existingContent = existsSync(abs) ? readFileSync(abs, "utf-8") : null;
      const opId = harnessCtx.undoStack.push({
        path: abs,
        type: "write_file",
        beforeContent: existingContent ?? null,
      });

      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, args.content, "utf-8");
      harnessCtx.hashCache.invalidate(abs);

      const diff = buildDiff(rel, "write_file", existingContent ?? "", args.content, {
        isNew: existingContent === null,
      });

      return {
        content: [{ type: "text", text: `OK: wrote ${rel} [${opId}]` }],
        details: { writtenFiles: [diff] },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// patch_file
// ---------------------------------------------------------------------------

const patchFileParams = Type.Object({
  path: Type.String(),
  anchor: Type.String({ description: "Exact unique string to locate the insertion point" }),
  position: Type.Union([
    Type.Literal("before"),
    Type.Literal("after"),
    Type.Literal("replace"),
    Type.Literal("start"),
    Type.Literal("end"),
  ]),
  content: Type.String({ description: "Text to insert or use as replacement" }),
});

function patchFileTool(harnessCtx: HarnessContext): AgentTool<typeof patchFileParams> {
  return {
    name: "patch_file",
    label: "Patch File",
    description: `Make a targeted anchor-based edit to an existing file.

ALWAYS use an anchor string that appears EXACTLY ONCE in the file.
Use position "replace" to substitute the anchor text, "after" to insert after it, "before" to insert before it.
Use "start" or "end" (anchor ignored) to prepend or append to the whole file.
ALWAYS save the op:XXXX to undo_write if needed.`,
    parameters: patchFileParams,
    execute: async (_toolCallId, args) => {
      const checked = safePath(harnessCtx.worktreePath, args.path);
      if (!checked.safe) {
        return { content: [{ type: "text", text: checked.error }], details: null, isError: true };
      }
      const { abs, rel } = checked;

      if (!existsSync(abs)) {
        return {
          content: [{ type: "text", text: `Error: file not found — ${rel}` }],
          details: null,
          isError: true,
        };
      }

      const before = readFileSync(abs, "utf-8");
      let after: string;

      if (args.position === "start") {
        after = args.content + before;
      } else if (args.position === "end") {
        after = before + args.content;
      } else {
        const count = before.split(args.anchor).length - 1;
        if (count > 1) {
          return {
            content: [
              {
                type: "text",
                text: `Error: anchor appears ${count} times — use a more specific anchor`,
              },
            ],
            details: null,
            isError: true,
          };
        }
        if (count === 0) {
          return {
            content: [{ type: "text", text: `Error: anchor not found in file` }],
            details: null,
            isError: true,
          };
        }

        switch (args.position) {
          case "before":
            after = before.replace(args.anchor, args.content + args.anchor);
            break;
          case "after":
            after = before.replace(args.anchor, args.anchor + args.content);
            break;
          case "replace":
            after = before.replace(args.anchor, args.content);
            break;
        }
      }

      const opId = harnessCtx.undoStack.push({
        path: abs,
        type: "patch_file",
        beforeContent: before,
      });

      writeFileSync(abs, after!, "utf-8");
      harnessCtx.hashCache.invalidate(abs);

      const diff = buildDiff(rel, "patch_file", before, after!);

      return {
        content: [{ type: "text", text: `OK: patched ${rel} [${opId}]` }],
        details: { writtenFiles: [diff] },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// delete_file
// ---------------------------------------------------------------------------

const deleteFileParams = Type.Object({
  path: Type.String(),
});

function deleteFileTool(harnessCtx: HarnessContext): AgentTool<typeof deleteFileParams> {
  return {
    name: "delete_file",
    label: "Delete File",
    description: `Delete a file from the worktree.

ALWAYS save the op:XXXX — undo_write can restore the file if needed.
NEVER delete files outside the worktree.`,
    parameters: deleteFileParams,
    execute: async (_toolCallId, args) => {
      const checked = safePath(harnessCtx.worktreePath, args.path);
      if (!checked.safe) {
        return { content: [{ type: "text", text: checked.error }], details: null, isError: true };
      }
      const { abs, rel } = checked;

      if (!existsSync(abs)) {
        return {
          content: [{ type: "text", text: `Error: file not found — ${rel}` }],
          details: null,
          isError: true,
        };
      }

      const content = readFileSync(abs, "utf-8");
      const opId = harnessCtx.undoStack.push({
        path: abs,
        type: "delete_file",
        beforeContent: content,
      });

      unlinkSync(abs);
      harnessCtx.hashCache.invalidate(abs);

      return {
        content: [{ type: "text", text: `OK: deleted ${rel} [${opId}]` }],
        details: { writtenFiles: [] },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// rename_file
// ---------------------------------------------------------------------------

const renameFileParams = Type.Object({
  from: Type.String(),
  to: Type.String(),
});

function renameFileTool(harnessCtx: HarnessContext): AgentTool<typeof renameFileParams> {
  return {
    name: "rename_file",
    label: "Rename File",
    description: `Rename or move a file within the worktree.

ALWAYS save the op:XXXX — undo_write restores the original path.
NEVER rename files to paths outside the worktree.`,
    parameters: renameFileParams,
    execute: async (_toolCallId, args) => {
      const fromChecked = safePath(harnessCtx.worktreePath, args.from);
      if (!fromChecked.safe) {
        return { content: [{ type: "text", text: fromChecked.error }], details: null, isError: true };
      }
      const toChecked = safePath(harnessCtx.worktreePath, args.to);
      if (!toChecked.safe) {
        return { content: [{ type: "text", text: toChecked.error }], details: null, isError: true };
      }

      const { abs: fromAbs, rel: fromRel } = fromChecked;
      const { abs: toAbs, rel: toRel } = toChecked;

      if (!existsSync(fromAbs)) {
        return {
          content: [{ type: "text", text: `Error: file not found — ${fromRel}` }],
          details: null,
          isError: true,
        };
      }

      const opId = harnessCtx.undoStack.push({
        path: fromAbs,
        type: "rename_file",
        beforeContent: null,
        toPath: toAbs,
      });

      mkdirSync(dirname(toAbs), { recursive: true });
      renameSync(fromAbs, toAbs);
      harnessCtx.hashCache.invalidate(fromAbs);
      harnessCtx.hashCache.invalidate(toAbs);

      const diff: FileDiffPayload = {
        operation: "rename_file",
        path: fromRel,
        to_path: toRel,
        added: 0,
        removed: 0,
      };

      return {
        content: [{ type: "text", text: `OK: renamed ${fromRel} → ${toRel} [${opId}]` }],
        details: { writtenFiles: [diff] },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function buildWriteTools(harnessCtx: HarnessContext): AgentTool<any>[] {
  return [
    writeFileTool(harnessCtx),
    patchFileTool(harnessCtx),
    deleteFileTool(harnessCtx),
    renameFileTool(harnessCtx),
  ];
}

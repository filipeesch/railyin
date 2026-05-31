import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import { Type } from "@earendil-works/pi-ai";
import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { FileDiffPayload } from "../../../../shared/rpc-types.ts";
import { computeFileDiff } from "../../../utils/diff.ts";
import { safePath } from "./read.ts";

function requireContent(toolName: string, rawArgs: unknown): void {
  const args = rawArgs as Record<string, unknown> | null | undefined;
  if (!args || typeof args.content !== "string") {
    throw new Error(
      `${toolName}: "content" is required — provide the text as a string`,
    );
  }
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

Required params: path (string), content (string — REQUIRED, the full file text to write)

Example:
{"path": "src/utils.ts", "content": "export function add(a: number, b: number) { return a + b; }\\n"}

ALWAYS save the op:XXXX from the result — pass it to undo_write if you need to revert.
NEVER use run_command to write files — ALWAYS use write_file or patch_file.
Use patch_file for targeted edits to existing files; use write_file only when rewriting the entire file.`,
    parameters: writeFileParams,
    prepareArguments: (args) => {
      requireContent("write_file", args);
      return args as { path: string; content: string };
    },
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

      const diff = computeFileDiff(existingContent ?? "", args.content, rel, "write_file", {
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
  content: Type.String({
    description: "REQUIRED. The exact text to insert or replace. Must always be provided.",
  }),
  anchor: Type.String({
    description:
      "Exact unique string to locate the insertion point. Ignored when position is start or end.",
  }),
  position: Type.Union([
    Type.Literal("before"),
    Type.Literal("after"),
    Type.Literal("replace"),
    Type.Literal("start"),
    Type.Literal("end"),
  ]),
});

function patchFileTool(harnessCtx: HarnessContext): AgentTool<typeof patchFileParams> {
  return {
    name: "patch_file",
    label: "Patch File",
    description: `Make a targeted anchor-based edit to an existing file.

Required params: path (string), content (string — REQUIRED, text to insert or replace), anchor (string), position ("before"|"after"|"replace"|"start"|"end")

Example:
{"path": "src/app.ts", "content": "  const x = 1;\\n", "anchor": "function setup() {", "position": "after"}

ALWAYS use an anchor string that appears EXACTLY ONCE in the file.
Use position "replace" to substitute the anchor text, "after" to insert after it, "before" to insert before it.
Use "start" or "end" (anchor ignored) to prepend or append to the whole file.
ALWAYS save the op:XXXX to undo_write if needed.`,
    parameters: patchFileParams,
    prepareArguments: (args) => {
      requireContent("patch_file", args);
      return args as { path: string; content: string; anchor: string; position: "before" | "after" | "replace" | "start" | "end" };
    },
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

      const diff = computeFileDiff(before, after!, rel, "patch_file");

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

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import { Type } from "@mariozechner/pi-ai";
import { existsSync, writeFileSync, unlinkSync, renameSync, mkdirSync } from "node:fs";
import { relative, dirname } from "node:path";
import { safePath } from "./read.ts";

// ---------------------------------------------------------------------------
// undo_write
// ---------------------------------------------------------------------------

const undoWriteParams = Type.Object({
  operationId: Type.Optional(
    Type.String({ description: "op:XXXX from a previous write result" }),
  ),
  path: Type.Optional(
    Type.String({ description: "Undo most recent write to this path" }),
  ),
});

function undoWriteTool(harnessCtx: HarnessContext): AgentTool<typeof undoWriteParams> {
  return {
    name: "undo_write",
    label: "Undo Write",
    description: `Revert a previous write operation by its operationId or by file path.

Pass operationId (the op:XXXX from a write result) to undo a specific operation.
Pass path to undo the most recent write to that file — call again with the same path to peel more layers.
ALWAYS check the write result for op:XXXX before calling undo_write.`,
    parameters: undoWriteParams,
    execute: async (_toolCallId, args) => {
      if (!args.operationId && !args.path) {
        return {
          content: [{ type: "text", text: "Error: provide either operationId or path" }],
          details: null,
          isError: true,
        };
      }

      let snapshot: ReturnType<typeof harnessCtx.undoStack.undoById>;
      let lookupId: string | undefined;
      let lookupRel: string | undefined;

      if (args.operationId) {
        const id = args.operationId.replace(/^op:/, "");
        lookupId = id;
        snapshot = harnessCtx.undoStack.undoById(id);
        if (!snapshot) {
          return {
            content: [
              {
                type: "text",
                text: `Error: op:${id} is no longer in undo history (stack limit reached)`,
              },
            ],
            details: null,
            isError: true,
          };
        }
      } else {
        const checked = safePath(harnessCtx.worktreePath, args.path!);
        if (!checked.safe) {
          return { content: [{ type: "text", text: checked.error }], details: null, isError: true };
        }
        lookupRel = checked.rel;
        snapshot = harnessCtx.undoStack.popByPath(checked.abs);
        if (!snapshot) {
          return {
            content: [
              {
                type: "text",
                text: `Error: no more undo history for ${checked.rel}`,
              },
            ],
            details: null,
            isError: true,
          };
        }
      }

      const opId = snapshot.operationId;

      if (snapshot.type === "lsp_rename") {
        let restored = 0;
        for (const [absPath, beforeContent] of Object.entries(snapshot.beforeFiles)) {
          if (beforeContent === null) {
            if (existsSync(absPath)) unlinkSync(absPath);
          } else {
            mkdirSync(dirname(absPath), { recursive: true });
            writeFileSync(absPath, beforeContent, "utf-8");
          }
          harnessCtx.hashCache.invalidate(absPath);
          restored++;
        }
        return {
          content: [{ type: "text", text: `OK: reverted lsp_rename [op:${opId}] — restored ${restored} file${restored !== 1 ? "s" : ""}` }],
          details: { operationId: opId },
        };
      }

      const rel = relative(harnessCtx.worktreePath, snapshot.path);

      if (snapshot.type === "rename_file") {
        const toPath = snapshot.toPath;
        if (existsSync(toPath)) {
          mkdirSync(dirname(snapshot.path), { recursive: true });
          renameSync(toPath, snapshot.path);
        }
        harnessCtx.hashCache.invalidate(snapshot.path);
        harnessCtx.hashCache.invalidate(toPath);
      } else {
        // write_file, patch_file, delete_file
        if (snapshot.beforeContent === null) {
          // file was newly created — delete it
          if (existsSync(snapshot.path)) {
            unlinkSync(snapshot.path);
          }
        } else {
          writeFileSync(snapshot.path, snapshot.beforeContent, "utf-8");
        }
        harnessCtx.hashCache.invalidate(snapshot.path);
      }

      return {
        content: [{ type: "text", text: `OK: reverted ${rel} to pre-op:${opId} state` }],
        details: { revertedPath: rel, operationId: opId },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function buildUndoTool(harnessCtx: HarnessContext): AgentTool<any>[] {
  return [undoWriteTool(harnessCtx)];
}

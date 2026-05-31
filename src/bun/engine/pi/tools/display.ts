/**
 * Builds ToolCallDisplay metadata for Pi harness tools.
 * Falls back to buildCommonToolDisplay for Railyin common tools.
 */

import { relative, isAbsolute } from "node:path";
import type { ToolCallDisplay } from "../../../../shared/rpc-types.ts";
import { buildCommonToolDisplay } from "../../common-tools.ts";

function str(v: unknown): string {
  return v != null ? String(v) : "";
}

function rel(p: string, worktreePath?: string): string {
  if (!p) return p;
  if (worktreePath && isAbsolute(p) && p.startsWith(worktreePath)) {
    return relative(worktreePath, p);
  }
  return p;
}

export function buildPiToolDisplay(name: string, args: Record<string, unknown>, worktreePath?: string): ToolCallDisplay {
  switch (name) {
    // SDK built-in tools
    case "read":
      return {
        label: "read",
        subject: rel(str(args.file_path ?? args.path), worktreePath) || undefined,
        contentType: "file",
        startLine: typeof args.offset === "number" ? args.offset : undefined,
      };

    case "grep":
      return {
        label: "grep",
        subject: str(args.pattern) || undefined,
        contentType: "terminal",
      };

    case "find":
      return {
        label: "find",
        subject: str(args.pattern) || undefined,
        contentType: "terminal",
      };

    case "ls":
      return {
        label: "ls",
        subject: rel(str(args.path), worktreePath) || undefined,
        contentType: "terminal",
      };

    case "read_file":
      return {
        label: "read file",
        subject: rel(str(args.path), worktreePath) || undefined,
        contentType: "file",
        startLine: typeof args.start_line === "number" ? args.start_line : undefined,
      };

    case "write_file":
      return { label: "write file", subject: rel(str(args.path), worktreePath) || undefined };

    case "patch_file":
      return { label: "patch file", subject: rel(str(args.path), worktreePath) || undefined };

    case "delete_file":
      return { label: "delete file", subject: rel(str(args.path), worktreePath) || undefined };

    case "rename_file": {
      const from = rel(str(args.from), worktreePath);
      const to = rel(str(args.to), worktreePath);
      const subject = from && to ? `${from} → ${to}` : from || to || undefined;
      return { label: "rename file", subject };
    }

    case "find":
      return {
        label: "find",
        subject: str(args.pattern) || undefined,
        contentType: "terminal",
      };

    case "run_command":
      return {
        label: "run",
        subject: str(args.command) || undefined,
        contentType: "terminal",
      };

    case "undo_write":
      return { label: "undo write", subject: rel(str(args.path), worktreePath) || undefined };

    default:
      return buildCommonToolDisplay(name, args);
  }
}

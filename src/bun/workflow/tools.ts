import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, resolve, relative } from "path";
import { spawnSync } from "child_process";
import type { AIToolDefinition } from "../ai/types.ts";

// ─── Tool definitions (JSON schema for the model) ─────────────────────────────

export const TOOL_DEFINITIONS: AIToolDefinition[] = [
  {
    name: "read_file",
    description:
      "Read the contents of a file in the project worktree. Use relative paths from the worktree root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file from the worktree root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description:
      "List files and directories at a path in the project worktree. Use relative paths from the worktree root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path to the directory from the worktree root. Use '.' for root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command in the project worktree directory (read-only commands only — e.g. grep, find, git log, git diff, cat). Do NOT use commands that modify files.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to run.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "ask_user",
    description:
      "Ask the user a question and present structured options for them to choose from. Use this when you need clarification or a decision from the user before proceeding. The execution will pause until the user responds.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user.",
        },
        selection_mode: {
          type: "string",
          enum: ["single", "multi"],
          description: "Whether the user can select one option ('single') or multiple ('multi').",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "The list of options to present to the user.",
        },
      },
      required: ["question", "selection_mode", "options"],
    },
  },
];

/** Default tool names used when a column has no explicit 'tools' config. */
const DEFAULT_TOOL_NAMES = ["read_file", "list_dir", "run_command"];

/**
 * Resolve the tool definitions to offer for a given column.
 * If the column declares a 'tools' array, only those tools are returned.
 * If omitted, the default set is used. Unknown names are skipped with a warning.
 */
export function resolveToolsForColumn(columnTools: string[] | undefined): AIToolDefinition[] {
  const names = columnTools ?? DEFAULT_TOOL_NAMES;
  const byName = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));
  return names.flatMap((name) => {
    const def = byName.get(name);
    if (!def) {
      console.warn(`[tools] Unknown tool "${name}" in column config — skipping`);
      return [];
    }
    return [def];
  });
}

// ─── Safety: block writes & destructive ops ───────────────────────────────────

const BLOCKED_COMMANDS = /\b(rm|rmdir|mv|cp|mkdir|chmod|chown|dd|mkfs|curl|wget|ssh|scp|git\s+(push|reset|clean|checkout\s+-f))\b/i;

// ─── Path safety: keep within worktree root ───────────────────────────────────

function safePath(worktreePath: string, userPath: string): string | null {
  const abs = resolve(join(worktreePath, userPath));
  if (!abs.startsWith(resolve(worktreePath))) return null; // path traversal
  return abs;
}

// ─── Tool executor ────────────────────────────────────────────────────────────

export interface ToolContext {
  worktreePath: string; // absolute path to the git worktree
}

export function executeTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): string {
  let args: Record<string, string>;
  try {
    args = JSON.parse(rawArgs) as Record<string, string>;
  } catch {
    return `Error: could not parse tool arguments: ${rawArgs}`;
  }

  switch (name) {
    case "read_file": {
      const abs = safePath(ctx.worktreePath, args.path ?? "");
      if (!abs) return "Error: path traversal detected — path must be inside the worktree.";
      if (!existsSync(abs)) return `Error: file not found: ${args.path}`;
      try {
        const stat = statSync(abs);
        if (!stat.isFile()) return `Error: ${args.path} is not a file.`;
        if (stat.size > 500_000) return `Error: file too large (${stat.size} bytes). Use run_command with grep/head to inspect it.`;
        return readFileSync(abs, "utf-8");
      } catch (e) {
        return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "list_dir": {
      const abs = safePath(ctx.worktreePath, args.path ?? ".");
      if (!abs) return "Error: path traversal detected — path must be inside the worktree.";
      if (!existsSync(abs)) return `Error: directory not found: ${args.path}`;
      try {
        const stat = statSync(abs);
        if (!stat.isDirectory()) return `Error: ${args.path} is not a directory.`;
        const entries = readdirSync(abs, { withFileTypes: true });
        return entries
          .map((e) => {
            const rel = relative(ctx.worktreePath, join(abs, e.name));
            return e.isDirectory() ? `${rel}/` : rel;
          })
          .sort()
          .join("\n");
      } catch (e) {
        return `Error listing directory: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "run_command": {
      const cmd = args.command ?? "";
      if (BLOCKED_COMMANDS.test(cmd)) {
        return `Error: command blocked for safety. Only read-only commands are permitted.`;
      }
      try {
        const result = spawnSync("sh", ["-c", cmd], {
          cwd: ctx.worktreePath,
          timeout: 15_000,
          maxBuffer: 500_000,
          encoding: "utf-8",
        });
        const out = (result.stdout ?? "").slice(0, 8_000);
        const err = (result.stderr ?? "").slice(0, 2_000);
        if (result.error) return `Error running command: ${result.error.message}`;
        return (out + (err ? `\nstderr:\n${err}` : "")).trim() || "(no output)";
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    default:
      return `Error: unknown tool "${name}"`;
  }
}

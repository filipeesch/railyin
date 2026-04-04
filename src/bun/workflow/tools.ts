import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from "fs";
import { join, resolve, relative, dirname } from "path";
import { spawnSync } from "child_process";
import { lookup as dnsLookup } from "dns/promises";
import type { AIToolDefinition } from "../ai/types.ts";
import type { FileDiffPayload, Hunk, HunkLine } from "../../shared/rpc-types.ts";

// ─── Myers diff algorithm ─────────────────────────────────────────────────────

const CONTEXT_LINES = 3;

/**
 * Compute a line-level diff between two arrays of strings using the Myers
 * algorithm. Returns an array of Hunks with up to CONTEXT_LINES surrounding
 * context lines per changed region. Distant changed regions become separate hunks.
 */
export function myersDiff(before: string[], after: string[]): Hunk[] {
  const n = before.length;
  const m = after.length;

  // Build the edit script via Myers forward algorithm
  const max = n + m;
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  outer:
  for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      const ki = k + max;
      let x: number;
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        x = v[ki + 1]; // move down
      } else {
        x = v[ki - 1] + 1; // move right
      }
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) { x++; y++; }
      v[ki] = x;
      if (x >= n && y >= m) { trace.push([...v]); break outer; }
    }
  }

  // Back-track through the trace to produce edit operations
  type Op = { type: "eq" | "ins" | "del"; old?: number; new?: number; content: string };
  const ops: Op[] = [];
  let x = n, y = m;

  for (let d = trace.length - 1; d > 0; d--) {
    const vPrev = trace[d - 1];
    const k = x - y;
    const ki = k + max;
    let prevK: number;
    if (k === -d + 1 || (k !== d - 1 && (vPrev[ki - 1] ?? -1) < (vPrev[ki + 1] ?? -1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevKi = prevK + max;
    const prevX = vPrev[prevKi] ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX + 1 && y > prevY + 1) {
      x--; y--;
      ops.unshift({ type: "eq", old: x, new: y, content: before[x] });
    }
    if (d > 0) {
      if (x === prevX + 1 && y === prevY) {
        x--;
        ops.unshift({ type: "del", old: x, content: before[x] });
      } else if (y === prevY + 1 && x === prevX) {
        y--;
        ops.unshift({ type: "ins", new: y, content: after[y] });
      } else if (x > prevX && y > prevY) {
        x--; y--;
        ops.unshift({ type: "eq", old: x, new: y, content: before[x] });
      }
    }
  }

  if (ops.length === 0 && n === 0 && m === 0) return [];

  // Convert ops to HunkLine[] with 1-based line numbers
  const allLines: HunkLine[] = ops.map(op => {
    if (op.type === "eq")  return { type: "context" as const, old_line: (op.old! + 1), new_line: (op.new! + 1), content: op.content };
    if (op.type === "del") return { type: "removed" as const, old_line: (op.old! + 1), content: op.content };
    return { type: "added" as const, new_line: (op.new! + 1), content: op.content };
  });

  // Group into hunks: changed lines ± CONTEXT_LINES, merge if gap ≤ 2*CONTEXT_LINES
  const changed: number[] = [];
  allLines.forEach((l, i) => { if (l.type !== "context") changed.push(i); });
  if (changed.length === 0) return [];

  const regions: Array<[number, number]> = [];
  let start = Math.max(0, changed[0] - CONTEXT_LINES);
  let end = Math.min(allLines.length - 1, changed[0] + CONTEXT_LINES);
  for (let ci = 1; ci < changed.length; ci++) {
    const nextStart = Math.max(0, changed[ci] - CONTEXT_LINES);
    const nextEnd = Math.min(allLines.length - 1, changed[ci] + CONTEXT_LINES);
    if (nextStart <= end + 1) {
      end = nextEnd;
    } else {
      regions.push([start, end]);
      start = nextStart;
      end = nextEnd;
    }
  }
  regions.push([start, end]);

  return regions.map(([from, to]) => {
    const lines = allLines.slice(from, to + 1);
    const firstOld = lines.find(l => l.old_line !== undefined)?.old_line ?? 1;
    const firstNew = lines.find(l => l.new_line !== undefined)?.new_line ?? 1;
    return { old_start: firstOld, new_start: firstNew, lines };
  });
}

/** Build a FileDiffPayload for patch_file using pre-known anchor/content info. */
function patchDiff(
  operation: "patch_file",
  path: string,
  fileLines: string[],
  anchorLineIdx: number | null, // 0-based index in file; null for start/end
  removedText: string,
  addedText: string,
  position: string,
): FileDiffPayload {
  const removedLines = removedText ? removedText.split("\n") : [];
  const addedLines = addedText ? addedText.split("\n") : [];
  const removed = removedLines.filter(l => l !== "" || removedText.endsWith("\n")).length;
  const added = addedLines.filter(l => l !== "" || addedText.endsWith("\n")).length;

  // Build a single hunk with context for anchor-based modes
  let hunks: Hunk[] | undefined;
  if (anchorLineIdx !== null) {
    const ctxStart = Math.max(0, anchorLineIdx - CONTEXT_LINES);
    const ctxEnd = Math.min(fileLines.length - 1, anchorLineIdx + removedLines.length - 1 + CONTEXT_LINES);
    const lines: HunkLine[] = [];
    for (let i = ctxStart; i < anchorLineIdx; i++) {
      lines.push({ type: "context", old_line: i + 1, new_line: i + 1, content: fileLines[i] });
    }
    for (const c of removedLines) lines.push({ type: "removed", old_line: anchorLineIdx + 1, content: c });
    for (const c of addedLines)   lines.push({ type: "added",   new_line: anchorLineIdx + 1, content: c });
    for (let i = anchorLineIdx + removedLines.length; i <= ctxEnd; i++) {
      lines.push({ type: "context", old_line: i + 1, new_line: i + 1 - removed + added, content: fileLines[i] });
    }
    hunks = [{ old_start: ctxStart + 1, new_start: ctxStart + 1, lines }];
  }

  return { operation, path, added, removed, hunks };
}

/** Successful write result type — distinguishes from plain error strings. */
export type WriteResult = { content: string; diff: FileDiffPayload };


export const TOOL_DEFINITIONS: AIToolDefinition[] = [
  {
    name: "read_file",
    description:
      "Read the contents of a file in the project worktree. Use relative paths from the worktree root. Optionally specify start_line and/or end_line (1-based) to read only part of a large file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file from the worktree root.",
        },
        start_line: {
          type: "number",
          description: "First line to read (1-based, inclusive). Omit to read from the beginning.",
        },
        end_line: {
          type: "number",
          description: "Last line to read (1-based, inclusive). Omit to read to the end of the file.",
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
    name: "ask_me",
    description:
      "Ask me a question and present structured options to choose from. Use this when you need clarification or a decision before proceeding. Execution will pause until I respond.",
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
  // ── write group ────────────────────────────────────────────────────────────
  {
    name: "write_file",
    description:
      "Create a new file or fully overwrite an existing one in the project worktree. Use patch_file for targeted edits to existing files. Use relative paths from the worktree root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file from the worktree root.",
        },
        content: {
          type: "string",
          description: "Full content to write to the file.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "delete_file",
    description:
      "Delete a file from the project worktree. Use relative paths from the worktree root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file to delete.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "delete_file",
    description:
      "Delete a file from the project worktree. Use relative paths from the worktree root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file to delete.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "rename_file",
    description:
      "Move or rename a file within the project worktree. Both paths must be inside the worktree root.",
    parameters: {
      type: "object",
      properties: {
        from_path: {
          type: "string",
          description: "Relative path of the existing file.",
        },
        to_path: {
          type: "string",
          description: "Relative destination path (new name/location).",
        },
      },
      required: ["from_path", "to_path"],
    },
  },
  {
    name: "patch_file",
    description:
      "Make a targeted edit to a file. Choose a position mode: \"start\" (prepend), \"end\" (append), \"before\" (insert before anchor), \"after\" (insert after anchor), or \"replace\" (replace anchor with content). For anchor-based modes the anchor must appear exactly once in the file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file from the worktree root.",
        },
        content: {
          type: "string",
          description: "The text to insert or replace with.",
        },
        position: {
          type: "string",
          enum: ["start", "end", "before", "after", "replace"],
          description: "Where to apply the edit relative to the file or anchor.",
        },
        anchor: {
          type: "string",
          description: "Required for before/after/replace modes. Must appear exactly once in the file.",
        },
      },
      required: ["path", "content", "position"],
    },
  },
  // ── search group ───────────────────────────────────────────────────────────
  {
    name: "search_text",
    description:
      "Search for a text pattern (plain string or regex) across files in the project worktree. Returns matching lines with file paths and line numbers. Optionally restrict to files matching a glob pattern and include surrounding context lines.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Text or regex pattern to search for.",
        },
        glob: {
          type: "string",
          description: "Optional glob pattern to restrict which files are searched (e.g. 'src/**/*.ts').",
        },
        context_lines: {
          type: "number",
          description: "Number of lines to show before and after each match (like grep -C). Default 0.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "find_files",
    description:
      "Find files in the project worktree whose paths match a glob pattern. Returns relative paths from the worktree root.",
    parameters: {
      type: "object",
      properties: {
        glob: {
          type: "string",
          description: "Glob pattern to match against file paths (e.g. '**/*.test.ts').",
        },
      },
      required: ["glob"],
    },
  },
  // ── agents group ───────────────────────────────────────────────────────────
  {
    name: "spawn_agent",
    description:
      "Spawn one or more sub-agents that run in parallel in the same worktree. Each child receives its own instructions and tool set. Use to break a task into independent parallel workstreams. Returns a JSON array of result strings (one per child).",
    parameters: {
      type: "object",
      properties: {
        children: {
          type: "array",
          description: "Sub-agents to spawn.",
          items: {
            type: "object",
            properties: {
              instructions: {
                type: "string",
                description: "What this sub-agent should do.",
              },
              tools: {
                type: "array",
                items: { type: "string" },
                description: "Tool group names or individual tool names available to this sub-agent.",
              },
              scope: {
                type: "string",
                description: "Optional hint about which paths this agent should touch (not enforced, aids the model).",
              },
            },
            required: ["instructions", "tools"],
          },
        },
      },
      required: ["children"],
    },
  },
  // ── web group ──────────────────────────────────────────────────────
  {
    name: "fetch_url",
    description:
      "Fetch the content of a public URL and return it as plain text (HTML tags stripped). Always available — no API key required. Useful for reading documentation, release notes, or any public web page.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "search_internet",
    description:
      "Search the web and return ranked results (title, URL, snippet). Requires search.engine and search.api_key in workspace.yaml. Returns a configuration error if not set up.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query.",
        },
      },
      required: ["query"],
    },
  },
];

/** Built-in tool groups. A column's `tools` array may use group names, individual
 * tool names, or a mix. Groups are expanded by resolveToolsForColumn. */
export const TOOL_GROUPS: Map<string, string[]> = new Map([
  ["read",         ["read_file", "list_dir"]],
  ["write",        ["write_file", "patch_file", "delete_file", "rename_file"]],
  ["search",       ["search_text", "find_files"]],
  ["shell",        ["run_command"]],
  ["interactions", ["ask_me"]],
  ["agents",       ["spawn_agent"]],
  ["web",          ["fetch_url", "search_internet"]],
]);

/** Default tool names used when a column has no explicit 'tools' config. */
const DEFAULT_TOOL_NAMES = ["read_file", "list_dir", "run_command"];

/**
 * Resolve the tool definitions to offer for a given column.
 * Entries in columnTools may be group names (e.g. "write") or individual tool
 * names (e.g. "read_file") — both are supported and can be mixed. Groups are
 * expanded to their constituent tools. Duplicates are deduplicated. Unknown
 * names (neither a group nor a known tool) are skipped with a warning.
 */
export function resolveToolsForColumn(columnTools: string[] | undefined): AIToolDefinition[] {
  const names = columnTools ?? DEFAULT_TOOL_NAMES;
  const byName = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));

  // Expand group names to individual tool names, dedup via Set
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const entry of names) {
    const groupMembers = TOOL_GROUPS.get(entry);
    const toolNames = groupMembers ?? [entry];
    for (const toolName of toolNames) {
      if (!seen.has(toolName)) {
        seen.add(toolName);
        expanded.push(toolName);
      }
    }
  }

  return expanded.flatMap((name) => {
    const def = byName.get(name);
    if (!def) {
      console.warn(`[tools] Unknown tool "${name}" in column config — skipping`);
      return [];
    }
    return [def];
  });
}

// ─── Safety: block writes & destructive ops ───────────────────────────────────

// Shell write redirections (> >> and piped tee) are blocked so that file writes
// go through the explicit write_file / replace_in_file tools where path-safety
// is enforced. Other destructive ops remain blocked as before.
const BLOCKED_COMMANDS = /\b(rm|rmdir|mv|cp|mkdir|chmod|chown|dd|mkfs|curl|wget|ssh|scp|git\s+(push|reset|clean|checkout\s+-f)|tee)\b|(>>?)/i;

// ─── Path safety: keep within worktree root ───────────────────────────────────

function safePath(worktreePath: string, userPath: string): string | null {
  const abs = resolve(join(worktreePath, userPath));
  if (!abs.startsWith(resolve(worktreePath))) return null; // path traversal
  return abs;
}

// ─── Tool executor ────────────────────────────────────────────────────────────

export interface ToolContext {
  worktreePath: string; // absolute path to the git worktree
  searchConfig?: { engine: string; api_key: string }; // from workspace.yaml search block
}

export async function executeTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<string | WriteResult> {
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
        const raw = readFileSync(abs, "utf-8");
        const startLine = args.start_line ? parseInt(args.start_line, 10) : undefined;
        const endLine = args.end_line ? parseInt(args.end_line, 10) : undefined;
        if (startLine !== undefined || endLine !== undefined) {
          const lines = raw.split("\n");
          const from = (startLine ?? 1) - 1; // convert 1-based → 0-based
          const to = endLine !== undefined ? endLine : lines.length; // end_line is inclusive
          return lines.slice(Math.max(0, from), to).join("\n");
        }
        return raw;
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

    // ── write group ────────────────────────────────────────────────────────────

    case "write_file": {
      const abs = safePath(ctx.worktreePath, args.path ?? "");
      if (!abs) return "Error: path traversal detected — path must be inside the worktree.";
      try {
        const isNew = !existsSync(abs);
        let hunks: Hunk[] | undefined;
        let added: number;
        let removed: number;

        if (isNew) {
          const newLines = (args.content ?? "").split("\n");
          added = newLines.length;
          removed = 0;
        } else {
          const beforeContent = readFileSync(abs, "utf-8");
          const beforeLines = beforeContent.split("\n");
          const afterLines = (args.content ?? "").split("\n");
          hunks = myersDiff(beforeLines, afterLines);
          added = hunks.flatMap(h => h.lines).filter(l => l.type === "added").length;
          removed = hunks.flatMap(h => h.lines).filter(l => l.type === "removed").length;
        }

        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, args.content ?? "", "utf-8");

        const countStr = isNew ? `(+${added} lines)` : `(+${added} -${removed})`;
        const diff: FileDiffPayload = {
          operation: "write_file",
          path: args.path,
          added,
          removed,
          ...(isNew ? { is_new: true } : {}),
          ...(hunks ? { hunks } : {}),
        };
        return { content: `OK: wrote ${args.path} ${countStr}`, diff } as WriteResult;
      } catch (e) {
        return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "delete_file": {
      const abs = safePath(ctx.worktreePath, args.path ?? "");
      if (!abs) return "Error: path traversal detected — path must be inside the worktree.";
      if (!existsSync(abs)) return `Error: file not found: ${args.path}`;
      try {
        const stat = statSync(abs);
        if (!stat.isFile()) return `Error: ${args.path} is not a file.`;
        const lineCount = readFileSync(abs, "utf-8").split("\n").length;
        unlinkSync(abs);
        const diff: FileDiffPayload = {
          operation: "delete_file",
          path: args.path,
          added: 0,
          removed: lineCount,
        };
        return { content: `OK: deleted ${args.path} (${lineCount} lines)`, diff } as WriteResult;
      } catch (e) {
        return `Error deleting file: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "rename_file": {
      const absFrom = safePath(ctx.worktreePath, args.from_path ?? "");
      if (!absFrom) return "Error: path traversal detected in from_path — must be inside the worktree.";
      const absTo = safePath(ctx.worktreePath, args.to_path ?? "");
      if (!absTo) return "Error: path traversal detected in to_path — must be inside the worktree.";
      if (!existsSync(absFrom)) return `Error: source not found: ${args.from_path}`;
      try {
        mkdirSync(dirname(absTo), { recursive: true });
        renameSync(absFrom, absTo);
        const diff: FileDiffPayload = {
          operation: "rename_file",
          path: args.from_path,
          to_path: args.to_path,
          added: 0,
          removed: 0,
        };
        return { content: `OK: renamed ${args.from_path} → ${args.to_path}`, diff } as WriteResult;
      } catch (e) {
        return `Error renaming file: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "patch_file": {
      const abs = safePath(ctx.worktreePath, args.path ?? "");
      if (!abs) return "Error: path traversal detected — path must be inside the worktree.";
      if (!existsSync(abs)) return `Error: file not found: ${args.path}`;
      try {
        const stat = statSync(abs);
        if (!stat.isFile()) return `Error: ${args.path} is not a file.`;
        const content = readFileSync(abs, "utf-8");
        const fileLines = content.split("\n");
        const insertion = args.content ?? "";
        const position = args.position ?? "";
        const anchor = args.anchor as string | undefined;

        if (position === "start") {
          writeFileSync(abs, insertion + content, "utf-8");
          const added = insertion.split("\n").length;
          const diff = patchDiff("patch_file", args.path, fileLines, null, "", insertion, position);
          return { content: `OK: patched ${args.path} (+${added} lines, prepended)`, diff } as WriteResult;
        }
        if (position === "end") {
          writeFileSync(abs, content + insertion, "utf-8");
          const added = insertion.split("\n").length;
          const diff = patchDiff("patch_file", args.path, fileLines, null, "", insertion, position);
          return { content: `OK: patched ${args.path} (+${added} lines, appended)`, diff } as WriteResult;
        }
        // Anchor-based positions
        if (!anchor) return `Error: anchor is required for position "${position}"`;
        const occurrences = content.split(anchor).length - 1;
        if (occurrences === 0) return `Error: anchor not found in ${args.path}`;
        if (occurrences > 1) {
          return `Error: anchor appears ${occurrences} times in ${args.path} — must be unique. Add more context to make it unambiguous.`;
        }

        // Find anchor line index (0-based)
        const anchorLineIdx = fileLines.findIndex((_, i) => fileLines.slice(i).join("\n").startsWith(anchor));

        let newContent: string;
        let removedText = "";
        let addedText = insertion;
        if (position === "before") {
          newContent = content.replace(anchor, insertion + anchor);
        } else if (position === "after") {
          newContent = content.replace(anchor, anchor + insertion);
        } else if (position === "replace") {
          newContent = content.replace(anchor, insertion);
          removedText = anchor;
        } else {
          return `Error: unknown position "${position}". Use start, end, before, after, or replace.`;
        }
        writeFileSync(abs, newContent, "utf-8");

        const added = addedText.split("\n").length;
        const removed = removedText ? removedText.split("\n").length : 0;
        const lineNum = anchorLineIdx >= 0 ? anchorLineIdx + 1 : "?";
        const countStr = position === "replace" ? `(+${added} -${removed} at line ${lineNum})` : `(+${added} at line ${lineNum})`;
        const diff = patchDiff("patch_file", args.path, fileLines, anchorLineIdx >= 0 ? anchorLineIdx : null, removedText, addedText, position);
        return { content: `OK: patched ${args.path} ${countStr}`, diff } as WriteResult;
      } catch (e) {
        return `Error patching file: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── search group ───────────────────────────────────────────────────────────

    case "search_text": {
      const pattern = args.pattern ?? "";
      const glob = args.glob ?? "";
      const contextLines = args.context_lines ? parseInt(args.context_lines, 10) : 0;
      try {
        const grepArgs = ["-rn", "--color=never"];
        if (contextLines > 0) grepArgs.push(`-C`, String(contextLines));
        grepArgs.push(pattern);
        if (glob) grepArgs.push("--include", glob);
        grepArgs.push(".");
        const result = spawnSync("grep", grepArgs, {
          cwd: ctx.worktreePath,
          timeout: 15_000,
          maxBuffer: 500_000,
          encoding: "utf-8",
        });
        if (result.error) return `Error running search: ${result.error.message}`;
        // Exit code 1 means no matches — not an error
        if (result.status === 1) return "(no matches found)";
        const out = (result.stdout ?? "").slice(0, 8_000);
        return out.trim() || "(no matches found)";
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "find_files": {
      const glob = args.glob ?? "";
      try {
        // For **/<pattern> globs, strip the **/ prefix and use -name so root-level
        // files are included. For path-restricted globs (e.g. src/**/*.ts), use
        // the directory prefix with -name. In v1 we handle the two most common forms:
        //   **/<name>   → find . -type f -name <name>
        //   <dir>/**/<name> → find ./<dir> -type f -name <name>
        let findDir = ".";
        let namePattern = glob;
        const doubleStar = glob.lastIndexOf("**/");
        if (doubleStar !== -1) {
          if (doubleStar > 0) {
            findDir = join(".", glob.slice(0, doubleStar).replace(/\/$/, ""));
          }
          namePattern = glob.slice(doubleStar + 3); // strip "**/"
        }
        const result = spawnSync("find", [findDir, "-type", "f", "-name", namePattern], {
          cwd: ctx.worktreePath,
          timeout: 15_000,
          maxBuffer: 500_000,
          encoding: "utf-8",
        });
        if (result.error) return `Error running find: ${result.error.message}`;
        const lines = (result.stdout ?? "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => l.replace(/^\.\//, ""))
          .sort();
        if (lines.length === 0) return "(no files found)";
        return lines.slice(0, 500).join("\n");
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── web group ──────────────────────────────────────────────────────────────

    case "fetch_url": {
      const rawUrl = args.url ?? "";
      try {
        const parsed = new URL(rawUrl);
        const hostname = parsed.hostname;
        // SSRF: resolve hostname and check IP range before fetching
        let ip: string;
        try {
          const result = await dnsLookup(hostname);
          ip = result.address;
        } catch {
          return `Error: could not resolve hostname "${hostname}"`;
        }
        if (isPrivateIp(ip)) {
          return `Error: SSRF protection — URL resolves to a private/loopback IP (${ip})`;
        }
        const response = await fetch(rawUrl, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) return `Error: HTTP ${response.status} ${response.statusText} from ${rawUrl}`;
        const MAX_BYTES = 100_000;
        const arrayBuf = await response.arrayBuffer();
        const decoder = new TextDecoder("utf-8");
        let html = decoder.decode(arrayBuf.slice(0, MAX_BYTES * 5)); // grab extra to account for tag overhead
        // Strip script/style blocks first
        html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
        html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
        // Strip remaining HTML tags
        let text = html.replace(/<[^>]+>/g, " ");
        // Normalize whitespace
        text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        if (text.length > MAX_BYTES) text = text.slice(0, MAX_BYTES) + "\n[truncated]";
        return text || "(no text content)";
      } catch (e) {
        return `Error fetching URL: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "search_internet": {
      const sc = ctx.searchConfig;
      if (!sc || !sc.engine || sc.engine === "none" || !sc.api_key) {
        return "Error: search not configured — add search.engine and search.api_key to workspace.yaml";
      }
      const query = args.query ?? "";
      if (!query) return "Error: query is required";
      try {
        if (sc.engine === "tavily") {
          const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: sc.api_key, query, max_results: 5 }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) return `Error: Tavily API returned HTTP ${response.status}`;
          const data = await response.json() as { results?: Array<{ title: string; url: string; content: string }> };
          const results = data.results ?? [];
          if (results.length === 0) return "(no results found)";
          return results
            .map((r) => `${r.title} | ${r.url}\n${r.content}`)
            .join("\n\n");
        }
        return `Error: unsupported search engine "${sc.engine}". Only "tavily" is supported.`;
      } catch (e) {
        return `Error querying search API: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    default:
      return `Error: unknown tool "${name}"`;
  }
}

// ─── SSRF helper ──────────────────────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  // IPv4 private/loopback/link-local ranges
  if (/^127\./.test(ip)) return true;          // 127.0.0.0/8 loopback
  if (/^10\./.test(ip)) return true;           // 10.0.0.0/8
  if (/^192\.168\./.test(ip)) return true;     // 192.168.0.0/16
  if (/^169\.254\./.test(ip)) return true;     // 169.254.0.0/16 link-local
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // 172.16.0.0/12
  // IPv6 loopback
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  return false;
}
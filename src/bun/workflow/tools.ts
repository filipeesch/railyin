import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, relative, dirname } from "path";
import { pathToFileURL } from "url";
import { spawnSync } from "child_process";
import { lookup as dnsLookup } from "dns/promises";
import type { AIToolDefinition } from "../ai/types.ts";
import type { FileDiffPayload, Hunk, HunkLine } from "../../shared/rpc-types.ts";
import type { LSPServerManager } from "../lsp/manager.ts";
import type { CallHierarchyItem } from "../lsp/types.ts";
import {
  formatDefinition,
  formatReferences,
  formatHover,
  formatDocumentSymbols,
  formatWorkspaceSymbols,
  formatCallHierarchyItems,
  formatIncomingCalls,
  formatOutgoingCalls,
} from "../lsp/formatters.ts";
import { getDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import type { TaskRow, ConversationMessageRow } from "../db/row-types.ts";
import { mapTask, mapConversationMessage } from "../db/mappers.ts";
import { removeWorktree } from "../git/worktree.ts";
import {
  createTodo,
  updateTodo as dbUpdateTodo,
  deleteTodo as dbDeleteTodo,
  listTodos,
} from "../db/todos.ts";

// ─── Myers diff algorithm ─────────────────────────────────────────────────────

/** Convert a glob pattern to a RegExp matching relative file paths.
 *  Supports `*` (within a path segment), `**` (any depth), `?` (single char).
 *  Returns null when `g` is empty. Case-sensitivity follows `caseInsensitive`. */
function globToRegex(g: string, caseInsensitive = false): RegExp | null {
  if (!g) return null;
  const escaped = g
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\x00")
    .replace(/\*\*/g, "\x01")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\x00/g, "(.*/)?")
    .replace(/\x01/g, ".*");
  return new RegExp(`^${escaped}$`, caseInsensitive ? "i" : "");
}

const CONTEXT_LINES = 3;

/**
 * Compute a line-level diff between two arrays of strings using the Myers
 * algorithm. Returns an array of Hunks with up to CONTEXT_LINES surrounding
 * context lines per changed region. Distant changed regions become separate hunks.
 */
export function myersDiff(before: string[], after: string[]): Hunk[] {
  const n = before.length;
  const m = after.length;

  // Degenerate cases — no need to run the algorithm
  if (n === 0 && m === 0) return [];

  const allLines = computeEditOps(before, after, n, m);

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

/**
 * Compute edit operations (context/removed/added lines) using the Myers diff algorithm.
 * Returns a flat array of HunkLine covering the entire file — myersDiff slices it into hunks.
 */
function computeEditOps(before: string[], after: string[], n: number, m: number): HunkLine[] {
  if (n === 0) {
    return after.map((c, j) => ({ type: "added" as const, new_line: j + 1, content: c }));
  }
  if (m === 0) {
    return before.map((c, i) => ({ type: "removed" as const, old_line: i + 1, content: c }));
  }

  // Myers forward algorithm.
  // v[k + offset] = furthest x reached on diagonal k; k = x - y.
  // trace[d] = snapshot of v BEFORE step d's updates.
  // At step d, only even-k (or odd-k) indices are updated depending on parity.
  // Values read (v[k-1], v[k+1]) always have opposite parity → they reflect d-1 state.
  const max = n + m;
  const offset = max;
  const v = new Array(2 * max + 2).fill(0);
  v[1 + offset] = 0;
  const trace: number[][] = [];

  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push([...v]); // snapshot BEFORE step d
    for (let k = -d; k <= d; k += 2) {
      const ki = k + offset;
      let x: number;
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        x = v[ki + 1]; // insert: move down, x stays
      } else {
        x = v[ki - 1] + 1; // delete: move right, x++
      }
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) { x++; y++; }
      v[ki] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
  }

  // Backtrack: at step d, trace[d] has the v values used for the decision at that step.
  const ops: HunkLine[] = [];
  let x = n, y = m;

  for (let d = trace.length - 1; d >= 1; d--) {
    const vd = trace[d]; // v BEFORE step d → used to determine step d's move
    const k = x - y;
    const ki = k + offset;

    let prevK: number;
    if (k === -d || (k !== d && (vd[ki - 1] ?? 0) < (vd[ki + 1] ?? 0))) {
      prevK = k + 1; // came via insert (y++): from diagonal k+1
    } else {
      prevK = k - 1; // came via delete (x++): from diagonal k-1
    }

    const prevX = vd[prevK + offset] ?? 0;
    const prevY = prevX - prevK;

    if (prevK === k + 1) {
      // Insert: started at (prevX, prevY+1) then extended diagonal to (x, y)
      while (x > prevX) {
        x--; y--;
        ops.unshift({ type: "context", old_line: x + 1, new_line: y + 1, content: before[x] });
      }
      // x === prevX, y === prevY + 1
      y--;
      ops.unshift({ type: "added", new_line: y + 1, content: after[y] });
    } else {
      // Delete: started at (prevX+1, prevY) then extended diagonal to (x, y)
      while (x > prevX + 1) {
        x--; y--;
        ops.unshift({ type: "context", old_line: x + 1, new_line: y + 1, content: before[x] });
      }
      // x === prevX + 1, y === prevY
      x--;
      ops.unshift({ type: "removed", old_line: x + 1, content: before[x] });
    }
    // x === prevX, y === prevY
  }

  // Any remaining lines at index 0 are equal (d=0 means entire prefix matched)
  while (x > 0 && y > 0) {
    x--; y--;
    ops.unshift({ type: "context", old_line: x + 1, new_line: y + 1, content: before[x] });
  }

  return ops;
}

/**
 * Split text into lines for diff counting/building.
 * "" → []  (no lines)
 * "\n" → [""]  (one blank line)
 * "a\nb\n" → ["a","b"]  (trailing newline does not add an extra line)
 * "a\nb" → ["a","b"]
 */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Build a FileDiffPayload for edit_file using old_string/new_string replacement info. */
function editDiff(
  path: string,
  fileLines: string[],
  anchorLineIdx: number | null, // 0-based index where old_string starts; null for new-file creation
  removedText: string,
  addedText: string,
): FileDiffPayload {
  const removedLines = splitLines(removedText);
  const addedLines = splitLines(addedText);
  const removed = removedLines.length;
  const added = addedLines.length;

  // Build a single hunk with context for anchor-based replacement
  let hunks: Hunk[] | undefined;
  if (anchorLineIdx !== null) {
    const ctxStart = Math.max(0, anchorLineIdx - CONTEXT_LINES);
    const ctxEnd = Math.min(fileLines.length - 1, anchorLineIdx + removedLines.length - 1 + CONTEXT_LINES);
    const lines: HunkLine[] = [];
    for (let i = ctxStart; i < anchorLineIdx; i++) {
      lines.push({ type: "context", old_line: i + 1, new_line: i + 1, content: fileLines[i] });
    }
    for (const c of removedLines) lines.push({ type: "removed", old_line: anchorLineIdx + 1, content: c });
    for (const c of addedLines) lines.push({ type: "added", new_line: anchorLineIdx + 1, content: c });
    for (let i = anchorLineIdx + removedLines.length; i <= ctxEnd; i++) {
      lines.push({ type: "context", old_line: i + 1, new_line: i + 1 - removed + added, content: fileLines[i] });
    }
    hunks = [{ old_start: ctxStart + 1, new_start: ctxStart + 1, lines }];
  } else {
    // New file creation — all lines are added
    hunks = [{
      old_start: 1, new_start: 1,
      lines: addedLines.map((c, j) => ({ type: "added" as const, new_line: j + 1, content: c })),
    }];
  }

  return { operation: "edit_file", path, added, removed, hunks };
}

/** Successful write result type — distinguishes from plain error strings. */
export type WriteResult = { content: string; diff?: FileDiffPayload; diffs?: FileDiffPayload[] };

type ReplacementResult = { ok: true; diff: FileDiffPayload } | { ok: false; error: string };

/** Apply a single old_string → new_string replacement to a file. Used by both edit_file and multi_replace. */
function applyOneReplacement(
  abs: string,
  relPath: string,
  oldString: string,
  newString: string,
  mtimeCache: Map<string, number> | undefined,
): ReplacementResult {
  if (!existsSync(abs)) return { ok: false, error: `file not found: ${relPath}` };
  const stat = statSync(abs);
  if (!stat.isFile()) return { ok: false, error: `${relPath} is not a file` };
  if (mtimeCache) {
    const cached = mtimeCache.get(abs);
    if (cached === undefined) return { ok: false, error: `you must read ${relPath} before editing it` };
    if (cached !== stat.mtimeMs) return { ok: false, error: `${relPath} has been modified since you last read it` };
  }
  const content = readFileSync(abs, "utf-8");
  if (oldString === "") return { ok: false, error: "old_string is empty — provide text to replace or use write_file" };
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) return { ok: false, error: `old_string not found in ${relPath}` };
  if (occurrences > 1) return { ok: false, error: `old_string found ${occurrences} times in ${relPath} — use a longer, unique string` };
  const fileLines = content.split("\n");
  const newContent = content.replace(oldString, newString);
  writeFileSync(abs, newContent, "utf-8");
  if (mtimeCache) {
    const newStat = statSync(abs);
    mtimeCache.set(abs, newStat.mtimeMs);
  }
  const anchorLineIdx = fileLines.findIndex((_, i) => fileLines.slice(i).join("\n").startsWith(oldString));
  const diff = editDiff(relPath, fileLines, anchorLineIdx >= 0 ? anchorLineIdx : null, oldString, newString);
  return { ok: true, diff };
}


export const TOOL_DEFINITIONS: AIToolDefinition[] = [
  {
    name: "read_file",
    description:
      "Read a file from the project worktree.\n\n" +
      "Usage:\n" +
      "- Returns content with line numbers and a metadata header (size, total lines)\n" +
      "- Use start_line/end_line (1-based, inclusive) to read a specific range — prefer partial reads for large files\n" +
      "- If the file exceeds the output limit it will be truncated; use start_line/end_line to read the remainder\n" +
      "- ALWAYS read a file before editing it to get the exact text for edit_file's old_string parameter\n" +
      "- NEVER use this to inspect binary files — they are detected and rejected with an error",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path from worktree root (e.g. 'src/index.ts', 'README.md').",
        },
        start_line: {
          type: "number",
          description: "First line to read (1-based, inclusive). Omit to start from the beginning.",
        },
        end_line: {
          type: "number",
          description: "Last line to read (1-based, inclusive). Omit to read to the end.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command in the project worktree directory.\n\n" +
      "Usage:\n" +
      "- Output is captured and returned as text; has a timeout for long-running commands\n" +
      "- ALWAYS use search_text instead of grep for project-wide text search",
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
      "Pause execution and ask one or more questions with structured options.\n\n" +
      "Usage:\n" +
      "- Each question needs: question text, selection_mode ('single'/'multi'), and options array\n" +
      "- Options support: label (required), description, recommended, preview (markdown)\n" +
      "- ALWAYS batch related decisions into the same call to minimize interruptions\n" +
      "- NEVER use for confirmation on routine operations",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "One or more questions to ask. Batch related decisions into the same call.",
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "The question text." },
              selection_mode: {
                type: "string",
                enum: ["single", "multi"],
                description: "'single' for one selection, 'multi' for multiple.",
              },
              options: {
                type: "array",
                description: "Options to present. Must contain at least one.",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "Option text." },
                    description: { type: "string", description: "Secondary explanation." },
                    recommended: { type: "boolean", description: "Highlight as default." },
                    preview: { type: "string", description: "Markdown preview pane content." },
                  },
                  required: ["label"],
                },
              },
            },
            required: ["question", "selection_mode", "options"],
          },
        },
      },
      required: ["questions"],
    },
  },
  // ── write group ────────────────────────────────────────────────────────────
  {
    name: "write_file",
    description:
      "Create a new file or fully overwrite an existing file with provided content.\n\n" +
      "Usage:\n" +
      "- Parent directory is created automatically if it does not exist\n" +
      "- ALWAYS use edit_file instead when modifying an existing file — write_file replaces all content silently\n" +
      "- Use only for new files or when the entire content must be replaced",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path from worktree root.",
        },
        content: {
          type: "string",
          description: "Full file content.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Make a targeted edit to a file by replacing an exact string match.\n\n" +
      "Usage:\n" +
      "- ALWAYS read the file first to get the exact text for old_string\n" +
      "- Include enough surrounding context in old_string to make the match unique\n" +
      "- Set old_string to empty string to create a new file\n" +
      "- NEVER re-read the file after a successful edit to verify the change — a success response confirms the edit was applied\n" +
      "- NEVER use this if old_string matches multiple locations unless replace_all is set\n" +
      "- When making multiple independent edits, use multi_replace instead to apply them all in a single call",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path from worktree root.",
        },
        old_string: {
          type: "string",
          description: "Exact string to replace (must appear once unless replace_all). Empty string creates a new file.",
        },
        new_string: {
          type: "string",
          description: "Replacement string.",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences. Default false.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "multi_replace",
    description:
      "Apply multiple string replacements across one or more files in a single call.\n\n" +
      "Usage:\n" +
      "- ALWAYS read all files first to get exact text for each old_string\n" +
      "- **NEVER re-read files after a replace operation** — the response reports lines changed per operation\n" +
      "- Replacements are applied sequentially — later ones see the result of earlier ones\n" +
      "- Use instead of multiple edit_file calls when making independent edits",
    parameters: {
      type: "object",
      properties: {
        replacements: {
          type: "array",
          description: "List of replacements to apply in order.",
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Relative path from worktree root.",
              },
              old_string: {
                type: "string",
                description: "Exact string to replace (must appear exactly once).",
              },
              new_string: {
                type: "string",
                description: "Replacement string.",
              },
            },
            required: ["path", "old_string", "new_string"],
          },
        },
      },
      required: ["replacements"],
    },
  },
  // ── search group ───────────────────────────────────────────────────────────
  {
    name: "search_text",
    description:
      "Search for a text or regex pattern across project files using ripgrep.\n\n" +
      "Usage:\n" +
      "- output_mode: 'content' (default, matching lines), 'files_with_matches' (paths only), 'count' (match counts per file)\n" +
      "- Use glob to restrict to file types or directories (e.g. 'src/**/*.ts')\n" +
      "- Use limit and offset to paginate large result sets",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Text or regex pattern.",
        },
        glob: {
          type: "string",
          description: "Glob to restrict files (e.g. 'src/**/*.ts').",
        },
        context_lines: {
          type: "number",
          description: "Lines before/after each match. Default 0.",
        },
        output_mode: {
          type: "string",
          enum: ["content", "files_with_matches", "count"],
          description: "Output format. Default 'content'.",
        },
        limit: {
          type: "number",
          description: "Max result lines. Default 250.",
        },
        offset: {
          type: "number",
          description: "Lines to skip (pagination). Default 0.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "find_files",
    description:
      "Find files matching a glob pattern in the project worktree.\n\n" +
      "Usage:\n" +
      "- Returns relative paths sorted by most recently modified\n" +
      "- Respects .gitignore and common ignore patterns (node_modules, .git, build artifacts)\n" +
      "- Use before reading to discover file structure",
    parameters: {
      type: "object",
      properties: {
        glob: {
          type: "string",
          description: "Glob pattern (e.g. '**/*.test.ts').",
        },
      },
      required: ["glob"],
    },
  },
  // ── agents group ───────────────────────────────────────────────────────────
  {
    name: "spawn_agent",
    description:
      "Spawn one or more parallel sub-agents that execute independently in the same worktree.\n\n" +
      "Usage:\n" +
      "- Each child gets its own instructions, tools, and conversation with full parent context\n" +
      "- Returns a JSON array of result strings (one per child) in input order\n" +
      "- Use for parallelising independent tasks (reviewing files, searching, implementing unrelated changes)\n" +
      "- Provide complete instructions for each child including file paths, context, and constraints",
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
                description: "Complete self-contained task description. Include all context — file paths, background, constraints, action. Sub-agent has no conversation history.",
              },
              tools: {
                type: "array",
                items: { type: "string" },
                description: "Tool group names or individual tool names for this sub-agent.",
              },
              scope: {
                type: "string",
                description: "Optional hint about which paths this agent should touch.",
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
      "Fetch a public URL and return its text content.\n\n" +
      "Usage:\n" +
      "- HTML pages are stripped to readable text\n" +
      "- No authentication — only publicly accessible URLs work\n" +
      "- Large responses may be truncated; prefer specific pages over tables of contents",
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
      "Search the web and return ranked results with title, URL, and snippet.\n\n" +
      "Usage:\n" +
      "- Returns up to 10 results; follow up with fetch_url for full content\n" +
      "- Use for finding documentation, researching APIs, looking up error messages",
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
  // ── tasks_read group ───────────────────────────────────────────────────────
  {
    name: "get_task",
    description:
      "Fetch metadata for a specific task by ID.\n\n" +
      "Usage:\n" +
      "- Returns title, description, workflow_state, execution_state, model, branch, worktree path, execution count\n" +
      "- Use include_messages=N for the last N conversation messages in chronological order\n" +
      "- Returns metadata only — use read_file to inspect files in the task's worktree",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "number",
          description: "The id of the task to fetch.",
        },
        include_messages: {
          type: "number",
          description: "If provided, include the last N conversation messages in chronological order.",
        },
      },
      required: ["task_id"],
    },
  },
  {
    name: "get_board_summary",
    description:
      "Return a high-level summary of task distribution across board columns.\n\n" +
      "Usage:\n" +
      "- Shows total count and breakdown by execution_state (idle, running, completed, failed) per column\n" +
      "- Omit board_id to summarise the current task's board\n" +
      "- Use to get an overview before listing individual tasks",
    parameters: {
      type: "object",
      properties: {
        board_id: {
          type: "number",
          description: "The board to summarise. Defaults to the current task's board when omitted.",
        },
      },
      required: [],
    },
  },
  {
    name: "list_tasks",
    description:
      "List tasks on a board with optional filters.\n\n" +
      "Usage:\n" +
      "- Filter by workflow_state, execution_state, project_id\n" +
      "- Use query for case-insensitive text search across title and description\n" +
      "- Omit board_id to search the current task's board; default limit 50 (max 200)",
    parameters: {
      type: "object",
      properties: {
        board_id: {
          type: "number",
          description: "Board to list tasks from. Defaults to the current task's board.",
        },
        workflow_state: {
          type: "string",
          description: "Filter by exact workflow column id (e.g. 'backlog', 'in-progress').",
        },
        execution_state: {
          type: "string",
          description: "Filter by execution state (e.g. 'idle', 'running', 'failed').",
        },
        project_id: {
          type: "number",
          description: "Filter tasks belonging to a specific project.",
        },
        query: {
          type: "string",
          description: "Case-insensitive substring search across title and description.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default 50, max 200).",
        },
      },
      required: [],
    },
  },
  // ── tasks_write group ──────────────────────────────────────────────────────
  {
    name: "create_task",
    description:
      "Create a new task in the backlog column of a board.\n\n" +
      "Usage:\n" +
      "- Starts in 'idle' execution state; use move_task to start it\n" +
      "- Omit board_id to create on the current task's board\n" +
      "- Use model parameter to override the default model for this task",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "The project this task belongs to.",
        },
        title: {
          type: "string",
          description: "The task title.",
        },
        description: {
          type: "string",
          description: "The task description.",
        },
        board_id: {
          type: "number",
          description: "Board to create the task on. Defaults to the current task's board.",
        },
        model: {
          type: "string",
          description: "Optional model override for this task (e.g. 'lmstudio/qwen3-8b').",
        },
      },
      required: ["project_id", "title", "description"],
    },
  },
  {
    name: "edit_task",
    description:
      "Update the title and/or description of a task.\n\n" +
      "Usage:\n" +
      "- Only allowed before a worktree/branch has been created\n" +
      "- At least one of title or description must be provided",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "number",
          description: "The id of the task to edit.",
        },
        title: {
          type: "string",
          description: "New title for the task.",
        },
        description: {
          type: "string",
          description: "New description for the task.",
        },
      },
      required: ["task_id"],
    },
  },
  {
    name: "delete_task",
    description:
      "Fully delete a task and all its data including conversation history, executions, and worktree.\n\n" +
      "Usage:\n" +
      "- Git branch is preserved; only task data is removed\n" +
      "- Running tasks are cancelled first; this action is permanent and cannot be undone",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "number",
          description: "The id of the task to delete.",
        },
      },
      required: ["task_id"],
    },
  },
  {
    name: "move_task",
    description:
      "Move a task to a different workflow column.\n\n" +
      "Usage:\n" +
      "- workflow_state is updated immediately\n" +
      "- If the target column has an on_enter_prompt, it is triggered asynchronously\n" +
      "- Returns immediately without waiting for triggered execution to complete",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "number",
          description: "The id of the task to move.",
        },
        workflow_state: {
          type: "string",
          description: "The target column id (e.g. 'backlog', 'in-progress', 'done').",
        },
      },
      required: ["task_id", "workflow_state"],
    },
  },
  {
    name: "message_task",
    description:
      "Append a message to another task's conversation and trigger its AI model.\n\n" +
      "Usage:\n" +
      "- Returns 'delivered' (idle/waiting) or 'queued' (running — delivered when execution finishes)\n" +
      "- Use for inter-task communication: sending results, requesting actions",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "number",
          description: "The id of the task to message.",
        },
        message: {
          type: "string",
          description: "The message content to send.",
        },
      },
      required: ["task_id", "message"],
    },
  },
  // ── todos group ────────────────────────────────────────────────────────────
  {
    name: "create_todo",
    description:
      "Create a new todo item scoped to the current task.\n\n" +
      "Usage:\n" +
      "- Returns the stable integer ID of the created item\n" +
      "- Use todos to track multi-step work — update status as you progress",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short label for the todo item.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "update_todo",
    description:
      "Update one or more fields of a todo item by ID.\n\n" +
      "Usage:\n" +
      "- Set status to 'in-progress' when starting, 'completed' when done\n" +
      "- Use result field to record outcome — persists across compactions for parent agent\n" +
      "- At least one of title, status, or result must be provided",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The todo item id.",
        },
        title: {
          type: "string",
          description: "New title for the todo.",
        },
        status: {
          type: "string",
          description: "New status: 'not-started', 'in-progress', or 'completed'.",
        },
        result: {
          type: "string",
          description: "Outcome summary — written when completing the item so the parent agent can read it after compaction.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_todo",
    description:
      "Permanently remove a todo item by ID. Use when no longer relevant or created in error.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The todo item id to delete.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "list_todos",
    description:
      "List all todo items for the current task. Returns ID, title, and status for each item.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // ── lsp group ───────────────────────────────────────────────────────────────
  {
    name: "lsp",
    description:
      "Query a language server for code intelligence.\n\n" +
      "Usage:\n" +
      "- Operations: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls\n" +
      "- Position-based operations require file_path, line, and character (all 1-based)\n" +
      "- Use documentSymbol to find symbol positions before calling position-based operations\n" +
      "- Use hover for type info, workspaceSymbol for project-wide symbol search",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "goToDefinition",
            "findReferences",
            "hover",
            "documentSymbol",
            "workspaceSymbol",
            "goToImplementation",
            "prepareCallHierarchy",
            "incomingCalls",
            "outgoingCalls",
          ],
          description: "The LSP operation to perform.",
        },
        file_path: {
          type: "string",
          description: "Relative path to the file from the worktree root.",
        },
        line: {
          type: "number",
          description: "1-based line number. Required for operations that need a cursor position.",
        },
        character: {
          type: "number",
          description: "1-based character offset. Required for position-based operations.",
        },
        query: {
          type: "string",
          description: "Symbol name query string. Required for workspaceSymbol.",
        },
      },
      required: ["operation", "file_path"],
    },
  },
];

/** Built-in tool groups. A column's `tools` array may use group names, individual
 * tool names, or a mix. Groups are expanded by resolveToolsForColumn. */
export const TOOL_GROUPS: Map<string, string[]> = new Map([
  ["read", ["read_file"]],
  ["write", ["write_file", "edit_file", "multi_replace"]],
  ["search", ["search_text", "find_files"]],
  ["shell", ["run_command"]],
  ["interactions", ["ask_me"]],
  ["agents", ["spawn_agent"]],
  ["web", ["fetch_url", "search_internet"]],
  ["tasks_read", ["get_task", "get_board_summary", "list_tasks"]],
  ["tasks_write", ["create_task", "edit_task", "delete_task", "move_task", "message_task"]],
  ["todos", ["create_todo", "update_todo", "delete_todo", "list_todos"]],
  ["lsp", ["lsp"]],
]);

/** Default tool names used when a column has no explicit 'tools' config. */
const DEFAULT_TOOL_NAMES = ["read_file", "run_command"];

/** One-line natural-language description for each tool, used in the worktree context block. */
const TOOL_DESCRIPTIONS: Map<string, string> = new Map([
  // read
  ["read_file", "read_file(path, start_line?, end_line?): read a file with line numbers and metadata header. Use start_line/end_line (1-based) for partial reads of large files. Always read before editing to get exact text for edit_file."],
  // write
  ["write_file", "write_file(path, content): create a new file or fully overwrite an existing one. Parent directories are created automatically. Use edit_file instead for targeted edits to existing files."],
  ["edit_file", "edit_file(path, old_string, new_string, replace_all?): targeted edit — replace exact text in a file. Must read the file first to get exact text. Fails if old_string doesn't match exactly once (unless replace_all). Set old_string='' to create a new file."],
  ["multi_replace", "multi_replace(replacements): apply multiple {path, old_string, new_string} replacements in a single call, applied sequentially. Returns lines changed per operation. Prefer over repeated edit_file calls."],
  // search
  ["search_text", "search_text(pattern, glob?, context_lines?, output_mode?, limit?, offset?): search project files with ripgrep. output_mode: 'content' (matching lines), 'files_with_matches' (file paths only), 'count' (match counts). Use limit/offset for pagination. Respects .gitignore."],
  ["find_files", "find_files(glob): find files matching a glob pattern, sorted by most recently modified. Respects .gitignore. Use to discover file structure before reading."],
  // shell
  ["run_command", "run_command(command): run a shell command in the worktree (grep, git log, git diff, bun test, etc.). Unapproved command binaries require user confirmation. Prefer search_text over grep for project-wide search."],
  // interactions
  ["ask_me", "ask_me(questions): pause and ask questions with structured options (label, description?, recommended?, preview?). Batch related decisions into one call."],
  // agents
  ["spawn_agent", "spawn_agent(children): run parallel sub-agents. Each child needs self-contained instructions and tools array — no access to parent conversation. Returns JSON array of results."],
  // web
  ["fetch_url", "fetch_url(url): fetch a public URL and return its text content (HTML stripped to readable text). Use for documentation, API references, web pages."],
  ["search_internet", "search_internet(query): search the web for ranked results (title, URL, snippet). Requires search config in workspace.yaml. Follow up with fetch_url for full content."],
  // tasks_read
  ["get_task", "get_task(task_id, include_messages?): get task metadata (title, description, state, model, branch). Use include_messages=N for last N conversation messages."],
  ["get_board_summary", "get_board_summary(board_id?): overview of task distribution across board columns with execution_state breakdown. Omit board_id for current board."],
  ["list_tasks", "list_tasks(board_id?, state?, query?, limit?): list tasks with filters. Use query for case-insensitive text search across title and description."],
  // tasks_write
  ["create_task", "create_task(title, description?, board_id?, state?): create a new task in backlog. Use move_task to start it."],
  ["edit_task", "edit_task(task_id, title?, description?): update task title or description (only before worktree creation)."],
  ["delete_task", "delete_task(task_id): permanently delete a task and all its data. Git branch is preserved."],
  ["move_task", "move_task(task_id, to_state): move a task to a different workflow column. Triggers on_enter_prompt if configured."],
  ["message_task", "message_task(task_id, message): send a message to another task's conversation and trigger its AI model."],
  // todos
  ["create_todo", "create_todo(title): create a new todo item for the current task. Returns stable integer ID."],
  ["update_todo", "update_todo(id, status?, title?, result?): update todo status ('in-progress'/'completed'), title, or result summary."],
  ["delete_todo", "delete_todo(id): permanently remove a todo item."],
  ["list_todos", "list_todos(): list all todos for this task (id, title, status)."],
  // lsp
  ["lsp", "lsp(operation, file_path, line?, character?, query?): code intelligence — goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls. Requires lsp.servers in workspace.yaml."],
]);

/** Ordered group definitions for the worktree context tool description block. */
const TOOL_GROUP_LABELS: Array<[groupName: string, label: string]> = [
  ["read", "Read tools"],
  ["write", "Write tools"],
  ["search", "Search tools"],
  ["web", "Web tools"],
  ["shell", "Shell tool"],
  ["interactions", "Interaction tool"],
  ["agents", "Agent tool"],
  ["tasks_read", "Task read tools"],
  ["tasks_write", "Task write tools"],
  ["todos", "Todo tools"],
  ["lsp", "LSP tool"],
];

/**
 * Build the natural-language tool description block for the worktree context system message.
 * Only includes tools present in `columnTools` (expanded from group names).
 * Returns an empty string if no tools are available or no worktree context is needed.
 */
export function getToolDescriptionBlock(columnTools: string[] | undefined): string {
  const names = columnTools ?? DEFAULT_TOOL_NAMES;

  // Expand group names to individual tool names
  const expanded = new Set<string>();
  for (const entry of names) {
    const groupMembers = TOOL_GROUPS.get(entry);
    if (groupMembers) {
      for (const t of groupMembers) expanded.add(t);
    } else {
      expanded.add(entry);
    }
  }

  const hasWrite = TOOL_GROUPS.get("write")?.some((t) => expanded.has(t)) ?? false;
  const lines: string[] = ["You have access to the following tools to work with the project files:", ""];

  for (const [groupName, label] of TOOL_GROUP_LABELS) {
    const groupTools = TOOL_GROUPS.get(groupName)?.filter((t) => expanded.has(t)) ?? [];
    if (groupTools.length === 0) continue;
    lines.push(`**${label}:**`);
    for (const t of groupTools) {
      const desc = TOOL_DESCRIPTIONS.get(t);
      if (desc) lines.push(`- ${desc}`);
    }
    lines.push("");
  }

  if (hasWrite) {
    lines.push("Always read before you write. Use edit_file for targeted edits to existing files.", "");
  }

  lines.push(
    "CRITICAL: Always invoke tools using the API tool_call mechanism. NEVER write tool calls as XML (`<tool_call>`), JSON, or any other text format in your response — those formats are silently ignored and the tool will not run.",
  );

  return lines.join("\n");
}

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

// ─── Shell command binary extraction ─────────────────────────────────────────

// Splits a compound shell command on meta-characters (&&, ||, |, ;) and
// extracts the first token (binary name) of each segment. Deduplicates the result.
export function extractCommandBinaries(command: string): string[] {
  const segments = command.split(/&&|\|\||[|;]/);
  const binaries: string[] = [];
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const token = trimmed.split(/\s+/)[0];
    if (token && !binaries.includes(token)) {
      binaries.push(token);
    }
  }
  return binaries;
}

// ─── Path safety: keep within worktree root ───────────────────────────────────

function safePath(worktreePath: string, userPath: string): string | null {
  const abs = resolve(join(worktreePath, userPath));
  if (!abs.startsWith(resolve(worktreePath))) return null; // path traversal
  return abs;
}

// ─── Tool executor ────────────────────────────────────────────────────────────

// Callbacks injected by the engine to avoid circular imports.
// The engine passes these when building ToolContext so task tools can trigger
// transitions and human turns without importing engine.ts directly.
export type ShellApprovalDecision = "approve_once" | "approve_all" | "deny";

export type TaskToolCallbacks = {
  /** Fire-and-forget: update workflow_state and trigger on_enter_prompt if present. */
  handleTransition: (taskId: number, toState: string) => void;
  /** Fire-and-forget: append a human message and resume execution. */
  handleHumanTurn: (taskId: number, message: string) => void;
  /** Abort the in-flight execution (safe to call if already stopped). */
  cancelExecution: (executionId: number) => void;
  /** Pause execution and ask the user to approve a shell command. Returns the decision. */
  requestShellApproval: (taskId: number, command: string, unapprovedBinaries: string[]) => Promise<ShellApprovalDecision>;
  /** Persist newly approved binaries to the tasks.approved_commands column. */
  appendApprovedCommands: (taskId: number, binaries: string[]) => void;
};

export interface ToolContext {
  worktreePath: string; // absolute path to the git worktree
  searchConfig?: { engine: string; api_key: string }; // from workspace.yaml search block
  taskId?: number; // id of the currently executing task (for board-scoped tools)
  boardId?: number; // board the executing task belongs to
  taskCallbacks?: TaskToolCallbacks; // engine callbacks for move_task / message_task
  shellAutoApprove?: boolean; // pre-fetched at execution start from tasks.shell_auto_approve
  approvedCommands?: string[]; // in-memory approved set, updated on approve_all
  /** Per-execution mtime cache for read-before-write enforcement and deduplication.
   *  Key: absolute file path. Value: mtimeMs at last read. */
  mtimeCache?: Map<string, number>;
  /** LSP server manager for code intelligence operations. */
  lspManager?: LSPServerManager;
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
        const startLine = args.start_line ? parseInt(args.start_line, 10) : undefined;
        const endLine = args.end_line ? parseInt(args.end_line, 10) : undefined;
        const isPartialRead = startLine !== undefined || endLine !== undefined;

        // Mtime-based deduplication for full reads (partial reads always bypass)
        if (!isPartialRead && ctx.mtimeCache) {
          const cachedMtime = ctx.mtimeCache.get(abs);
          if (cachedMtime !== undefined && cachedMtime === stat.mtimeMs) {
            return "File unchanged since last read — refer to the earlier tool result.";
          }
          ctx.mtimeCache.set(abs, stat.mtimeMs);
        } else if (ctx.mtimeCache) {
          // For partial reads, still track mtime for write enforcement but no dedup
          ctx.mtimeCache.set(abs, stat.mtimeMs);
        }

        const raw = readFileSync(abs, "utf-8");

        if (raw.length === 0) {
          return "Warning: the file exists but the contents are empty.";
        }

        const allLines = raw.split("\n");
        const totalLines = allLines.length;

        // Determine actual range to display (1-based inclusive)
        let from1 = startLine ?? 1;
        let to1 = endLine ?? totalLines;

        // Clamp to valid range
        from1 = Math.max(1, from1);
        to1 = Math.min(totalLines, to1);

        // Offset-past-EOF check
        if (startLine !== undefined && startLine > totalLines) {
          return `Warning: start_line ${startLine} exceeds file length (${totalLines} lines). The file has ${totalLines} line${totalLines === 1 ? "" : "s"}.`;
        }

        const slicedLines = allLines.slice(from1 - 1, to1);

        // Format: line number padded to 6 chars + arrow
        const numbered = slicedLines.map((line, idx) => {
          const lineNum = from1 + idx;
          const padded = String(lineNum).padStart(6, " ");
          return `${padded}→${line}`;
        });

        const header = `[file: ${args.path}, lines: ${totalLines}, showing: ${from1}-${to1}]`;
        return [header, ...numbered].join("\n");
      } catch (e) {
        return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "run_command": {
      const cmd = args.command ?? "";
      // ── Shell approval gate ─────────────────────────────────────────────────
      // Read shell_auto_approve live from DB so mid-execution toggles take effect
      // immediately. Falls back to ctx.shellAutoApprove when the task isn't in DB
      // (sub-agent context or test with synthetic taskId).
      const dbRow = ctx.taskId != null
        ? getDb().query<{ shell_auto_approve: number }, [number]>("SELECT shell_auto_approve FROM tasks WHERE id = ?").get(ctx.taskId)
        : null;
      const shellAutoApprove = dbRow != null ? dbRow.shell_auto_approve === 1 : (ctx.shellAutoApprove ?? false);
      if (!shellAutoApprove && ctx.taskCallbacks?.requestShellApproval && ctx.taskId != null) {
        const binaries = extractCommandBinaries(cmd);
        const approved = ctx.approvedCommands ?? [];
        const unapproved = binaries.filter((b) => !approved.includes(b));
        if (unapproved.length > 0) {
          const decision = await ctx.taskCallbacks.requestShellApproval(ctx.taskId, cmd, unapproved);
          if (decision === "deny") {
            return `Error: Command denied by user: ${cmd}`;
          }
          if (decision === "approve_all") {
            ctx.taskCallbacks.appendApprovedCommands(ctx.taskId, unapproved);
            if (ctx.approvedCommands) ctx.approvedCommands.push(...unapproved);
          }
          // approve_once: proceed without persisting
        }
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
          const newFileLines = splitLines(args.content ?? "");
          added = newFileLines.length;
          removed = 0;
          hunks = [{
            old_start: 1, new_start: 1,
            lines: newFileLines.map((c, j) => ({ type: "added" as const, new_line: j + 1, content: c })),
          }];
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

    case "edit_file": {
      const abs = safePath(ctx.worktreePath, args.path ?? "");
      if (!abs) return "Error: path traversal detected — path must be inside the worktree.";

      const oldString = args.old_string ?? "";
      const newString = args.new_string ?? "";
      const replaceAll = String(args.replace_all ?? "false").toLowerCase() === "true";

      try {
        // File creation mode: empty old_string + file doesn't exist → create
        if (oldString === "" && !existsSync(abs)) {
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, newString, "utf-8");
          const addedLines = splitLines(newString);
          const diff = editDiff(args.path, [], null, "", newString);
          return { content: `The file ${args.path} has been created successfully.`, diff } as WriteResult;
        }

        if (!existsSync(abs)) return `Error: file not found: ${args.path}`;
        const stat = statSync(abs);
        if (!stat.isFile()) return `Error: ${args.path} is not a file.`;

        // Read-before-write enforcement
        if (ctx.mtimeCache) {
          const cached = ctx.mtimeCache.get(abs);
          if (cached === undefined) {
            return `Error: you must read ${args.path} before editing it.`;
          }
          if (cached !== stat.mtimeMs) {
            return `Error: ${args.path} has been modified since you last read it. Read it again before editing.`;
          }
        }

        const content = readFileSync(abs, "utf-8");

        if (oldString === "") {
          // old_string empty but file exists — prepend/truncate not supported, require explicit old_string
          return "Error: old_string is empty but the file already exists. Provide the text to replace, or use write_file to fully overwrite.";
        }

        const occurrences = content.split(oldString).length - 1;

        if (occurrences === 0) {
          return `Error: old_string not found in ${args.path}. Make sure the text matches exactly (including whitespace and indentation).`;
        }

        if (occurrences > 1 && !replaceAll) {
          return `Error: old_string found ${occurrences} times in ${args.path}. Use a longer, more unique string or set replace_all=true.`;
        }

        const fileLines = content.split("\n");
        let newContent: string;
        let replacedCount: number;

        if (replaceAll) {
          newContent = content.split(oldString).join(newString);
          replacedCount = occurrences;
        } else {
          newContent = content.replace(oldString, newString);
          replacedCount = 1;
        }

        writeFileSync(abs, newContent, "utf-8");
        // Update mtime cache after write
        if (ctx.mtimeCache) {
          const newStat = statSync(abs);
          ctx.mtimeCache.set(abs, newStat.mtimeMs);
        }

        // Find anchor line index (0-based) for the diff
        const anchorLineIdx = fileLines.findIndex((_, i) => fileLines.slice(i).join("\n").startsWith(oldString));
        const diff = editDiff(args.path, fileLines, anchorLineIdx >= 0 ? anchorLineIdx : null, oldString, newString);

        const suffix = replaceAll && replacedCount > 1 ? ` (${replacedCount} replacements)` : "";
        return { content: `The file ${args.path} has been updated successfully.${suffix}`, diff } as WriteResult;
      } catch (e) {
        return `Error editing file: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "multi_replace": {
      const rawReplacements = (args as unknown as { replacements?: unknown }).replacements;
      if (!Array.isArray(rawReplacements) || rawReplacements.length === 0)
        return "Error: replacements must be a non-empty array.";

      type RepInput = { path?: string; old_string?: string; new_string?: string };
      const reps = rawReplacements as RepInput[];

      const results: Array<{ index: number; path: string; lines_removed?: number; lines_added?: number; error?: string }> = [];
      const diffs: FileDiffPayload[] = [];

      for (let i = 0; i < reps.length; i++) {
        const rep = reps[i];
        const relPath = rep.path ?? "";
        const abs = safePath(ctx.worktreePath, relPath);
        if (!abs) {
          results.push({ index: i, path: relPath, error: "path traversal detected" });
          continue;
        }
        const r = applyOneReplacement(abs, relPath, rep.old_string ?? "", rep.new_string ?? "", ctx.mtimeCache);
        if (!r.ok) {
          results.push({ index: i, path: relPath, error: r.error });
        } else {
          results.push({ index: i, path: relPath, lines_removed: r.diff.removed, lines_added: r.diff.added });
          diffs.push(r.diff);
        }
      }

      const successCount = results.filter(r => !r.error).length;
      const summary = results.map(r =>
        r.error
          ? `[${r.index}] ${r.path}: ERROR — ${r.error}`
          : `[${r.index}] ${r.path}: +${r.lines_added}/-${r.lines_removed} lines`
      ).join("\n");
      const content = `Applied ${successCount}/${results.length} replacements:\n${summary}`;
      return { content, diffs } as WriteResult;
    }

    // ── search group ───────────────────────────────────────────────────────────

    case "search_text": {
      const pattern = args.pattern ?? "";
      const globPat = args.glob ?? "";
      const contextLines = args.context_lines ? parseInt(String(args.context_lines), 10) : 0;
      const outputMode = (args.output_mode as string | undefined) ?? "content";
      const limit = args.limit ? Math.max(1, parseInt(String(args.limit), 10)) : 250;
      const offset = args.offset ? Math.max(0, parseInt(String(args.offset), 10)) : 0;
      const MAX_OUTPUT = 20_000;

      try {
        // Check if ripgrep is available
        const rgCheck = spawnSync("which", ["rg"], { encoding: "utf-8" });
        const hasRg = rgCheck.status === 0 && (rgCheck.stdout ?? "").trim().length > 0;

        if (!hasRg) {
          // Fall back to hand-rolled walker with a one-time warning prefix
          const fallbackWarning = "Warning: ripgrep (rg) not found, using slower fallback search.\n\n";
          let regex: RegExp;
          try { regex = new RegExp(pattern, "i"); } catch {
            return `Error: invalid regex pattern: ${pattern}`;
          }
          const globRe = globToRegex(globPat, true);
          const IGNORE_DIRS = new Set([".git", "node_modules", "dist", ".cache"]);
          const matches: string[] = [];
          const walkAndSearch = (dir: string): void => {
            if (matches.length >= limit + offset) return;
            let entries: string[];
            try { entries = readdirSync(dir); } catch { return; }
            for (const entry of entries) {
              if (IGNORE_DIRS.has(entry)) continue;
              const fullPath = join(dir, entry);
              let fstat; try { fstat = statSync(fullPath); } catch { continue; }
              if (fstat.isDirectory()) { walkAndSearch(fullPath); }
              else if (fstat.isFile()) {
                const relPath = relative(ctx.worktreePath, fullPath);
                if (globRe && !globRe.test(relPath)) continue;
                let content: string; try { content = readFileSync(fullPath, "utf-8"); } catch { continue; }
                const lines = content.split("\n");
                for (let i = 0; i < lines.length && matches.length < limit + offset; i++) {
                  if (!regex.test(lines[i])) continue;
                  const from = Math.max(0, i - contextLines);
                  const to = Math.min(lines.length - 1, i + contextLines);
                  for (let j = from; j <= to; j++) {
                    const prefix = j === i ? `${relPath}:${j + 1}:` : `${relPath}-${j + 1}-`;
                    matches.push(`${prefix}${lines[j]}`);
                  }
                  if (contextLines > 0 && i + contextLines < lines.length - 1) matches.push("--");
                }
              }
            }
          };
          walkAndSearch(ctx.worktreePath);
          const paged = matches.slice(offset, offset + limit);
          if (paged.length === 0) return "(no matches found)";
          const out = paged.join("\n");
          const truncated = matches.length > offset + limit;
          return fallbackWarning + (out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + "\n[truncated]" : out)
            + (truncated ? `\n\n[Showing ${offset + 1}–${offset + paged.length} of ${matches.length}+ results. Use offset=${offset + limit} for next page.]` : "");
        }

        // Build ripgrep arguments
        const rgArgs: string[] = [
          "--hidden",
          "--glob=!.git",
          "--glob=!node_modules",
          "--glob=!dist",
          "--glob=!.cache",
          "--max-columns=500",
        ];

        if (outputMode === "files_with_matches") {
          rgArgs.push("-l");
        } else if (outputMode === "count") {
          rgArgs.push("-c");
        } else {
          // content mode
          rgArgs.push("-n", "--no-heading");
          if (contextLines > 0) rgArgs.push(`-C${contextLines}`);
        }

        if (globPat) rgArgs.push(`--glob=${globPat}`);
        rgArgs.push("--", pattern);

        const rgResult = spawnSync("rg", rgArgs, {
          cwd: ctx.worktreePath,
          encoding: "utf-8",
          maxBuffer: 2_000_000,
        });

        // rg exits 1 when no matches found (not an error)
        if (rgResult.status !== 0 && rgResult.status !== 1) {
          const errMsg = (rgResult.stderr ?? "").trim();
          return `Error: ripgrep failed: ${errMsg || "unknown error"}`;
        }

        const rawOutput = (rgResult.stdout ?? "").trimEnd();
        if (!rawOutput) return "(no matches found)";

        if (outputMode === "files_with_matches") {
          // Sort by mtime (most recently modified first)
          const filePaths = rawOutput.split("\n").filter(Boolean);
          const withMtime = filePaths.map((fp) => {
            const abs = join(ctx.worktreePath, fp);
            let mtime = 0;
            try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
            return { fp, mtime };
          });
          withMtime.sort((a, b) => b.mtime - a.mtime);
          const paged = withMtime.slice(offset, offset + limit);
          const result = paged.map(({ fp }) => fp).join("\n");
          const truncated = withMtime.length > offset + limit;
          return result + (truncated ? `\n\n[Showing ${offset + 1}–${offset + paged.length} of ${withMtime.length}+ results. Use offset=${offset + limit} for next page.]` : "");
        }

        if (outputMode === "count") {
          const lines = rawOutput.split("\n").filter(Boolean);
          const paged = lines.slice(offset, offset + limit);
          const total = lines.reduce((sum, l) => {
            const m = l.match(/:(\d+)$/);
            return sum + (m ? parseInt(m[1], 10) : 0);
          }, 0);
          const truncated = lines.length > offset + limit;
          return paged.join("\n") + `\n\nTotal matches: ${total}`
            + (truncated ? `\n[Showing ${offset + 1}–${offset + paged.length} of ${lines.length} files. Use offset=${offset + limit} for next page.]` : "");
        }

        // content mode: apply limit/offset per line
        const lines = rawOutput.split("\n");
        const paged = lines.slice(offset, offset + limit);
        const out = paged.join("\n");
        const truncated = lines.length > offset + limit;
        const capped = out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + "\n[truncated]" : out;
        return capped + (truncated ? `\n\n[Showing lines ${offset + 1}–${offset + paged.length} of ${lines.length}. Use offset=${offset + limit} for next page.]` : "");
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "find_files": {
      const globPat = args.glob ?? "";
      try {
        const re = globToRegex(globPat, process.platform === "win32") ?? /(?:)/;
        const IGNORE_DIRS = new Set([".git", "node_modules", "dist", ".cache"]);
        const found: Array<{ relPath: string; mtime: number }> = [];

        const walk = (dir: string): void => {
          if (found.length >= 500) return;
          let entries: string[];
          try { entries = readdirSync(dir); } catch { return; }
          for (const entry of entries) {
            if (IGNORE_DIRS.has(entry)) continue;
            const fullPath = join(dir, entry);
            let fstat;
            try { fstat = statSync(fullPath); } catch { continue; }
            const relPath = relative(ctx.worktreePath, fullPath);
            if (fstat.isDirectory()) {
              walk(fullPath);
            } else if (fstat.isFile() && re.test(relPath)) {
              found.push({ relPath, mtime: fstat.mtimeMs });
            }
          }
        };

        walk(ctx.worktreePath);
        if (found.length === 0) return "(no files found)";

        // Sort by mtime descending (most recently modified first)
        found.sort((a, b) => b.mtime - a.mtime);
        const truncated = found.length >= 500;
        const output = found.map(({ relPath }) => relPath).join("\n");
        return truncated ? output + "\n\n(Results truncated. Consider a more specific pattern.)" : output;
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

    // ── tasks_read group ──────────────────────────────────────────────────────

    case "get_task": {
      const taskId = args.task_id ? parseInt(args.task_id, 10) : NaN;
      if (!taskId || isNaN(taskId)) return "Error: task_id is required";
      const db = getDb();
      const row = db
        .query<TaskRow, [number]>(
          `SELECT t.*,
                  gc.worktree_status, gc.branch_name, gc.worktree_path,
                  (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           WHERE t.id = ?`,
        )
        .get(taskId);
      if (!row) return `Error: task ${taskId} not found`;
      const task = mapTask(row);
      const includeN = args.include_messages ? parseInt(args.include_messages, 10) : 0;
      if (includeN > 0) {
        const msgs = db
          .query<ConversationMessageRow, [number, number]>(
            `SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY id DESC LIMIT ?`,
          )
          .all(taskId, includeN)
          .reverse()
          .map(mapConversationMessage);
        return JSON.stringify({ task, messages: msgs });
      }
      return JSON.stringify(task);
    }

    case "get_board_summary": {
      const db = getDb();
      const boardId = args.board_id ? parseInt(args.board_id, 10) : (ctx.boardId ?? 0);
      if (!boardId) return "Error: board_id is required (or run this tool from a task on a board)";
      // Check board exists
      const boardRow = db.query<{ id: number }, [number]>("SELECT id FROM boards WHERE id = ?").get(boardId);
      if (!boardRow) return `Error: board ${boardId} not found`;
      // Query tasks grouped by workflow_state and execution_state
      const rows = db
        .query<{ workflow_state: string; execution_state: string; count: number }, [number]>(
          `SELECT workflow_state, execution_state, COUNT(*) as count
           FROM tasks WHERE board_id = ?
           GROUP BY workflow_state, execution_state`,
        )
        .all(boardId);
      // Build per-column summary
      const columns: Record<string, { total: number; by_state: Record<string, number> }> = {};
      for (const r of rows) {
        if (!columns[r.workflow_state]) columns[r.workflow_state] = { total: 0, by_state: {} };
        columns[r.workflow_state].total += r.count;
        columns[r.workflow_state].by_state[r.execution_state] = (columns[r.workflow_state].by_state[r.execution_state] ?? 0) + r.count;
      }
      return JSON.stringify({ board_id: boardId, columns });
    }

    case "list_tasks": {
      const db = getDb();
      const boardId = args.board_id ? parseInt(args.board_id, 10) : (ctx.boardId ?? 0);
      if (!boardId) return "Error: board_id is required (or run this tool from a task on a board)";
      const limitRaw = args.limit ? parseInt(args.limit, 10) : 50;
      const limit = Math.min(Math.max(1, limitRaw), 200);
      const conditions: string[] = ["t.board_id = ?"];
      const params: (string | number)[] = [boardId];
      if (args.workflow_state) { conditions.push("t.workflow_state = ?"); params.push(args.workflow_state); }
      if (args.execution_state) { conditions.push("t.execution_state = ?"); params.push(args.execution_state); }
      if (args.project_id) { conditions.push("t.project_id = ?"); params.push(parseInt(args.project_id, 10)); }
      if (args.query) {
        conditions.push("(t.title LIKE ? OR t.description LIKE ?)");
        const q = `%${args.query}%`;
        params.push(q, q);
      }
      params.push(limit);
      const sql = `SELECT t.*,
                          gc.worktree_status, gc.branch_name, gc.worktree_path,
                          (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
                   FROM tasks t
                   LEFT JOIN task_git_context gc ON gc.task_id = t.id
                   WHERE ${conditions.join(" AND ")}
                   ORDER BY t.created_at ASC LIMIT ?`;
      const rows = db.query<TaskRow, typeof params>(sql).all(...params);
      return JSON.stringify(rows.map(mapTask));
    }

    // ── tasks_write group ────────────────────────────────────────────────────

    case "create_task": {
      const projectId = args.project_id ? parseInt(args.project_id, 10) : NaN;
      if (!projectId || isNaN(projectId)) return "Error: project_id is required";
      const title = (args.title ?? "").trim();
      if (!title) return "Error: title is required";
      const description = (args.description ?? "").trim();
      const boardId = args.board_id ? parseInt(args.board_id, 10) : (ctx.boardId ?? 0);
      if (!boardId) return "Error: board_id is required (or run this tool from a task on a board)";
      const db = getDb();
      // Validate board exists
      const boardRow = db.query<{ id: number }, [number]>("SELECT id FROM boards WHERE id = ?").get(boardId);
      if (!boardRow) return `Error: board ${boardId} not found`;
      // Validate project exists
      const projRow = db.query<{ id: number }, [number]>("SELECT id FROM projects WHERE id = ?").get(projectId);
      if (!projRow) return `Error: project ${projectId} not found`;
      // Create conversation first
      const convRes = db.run("INSERT INTO conversations (task_id) VALUES (0)");
      const convId = convRes.lastInsertRowid as number;
      const effectiveModel = args.model || getConfig()?.workspace.default_model || null;
      const taskRes = db.run(
        `INSERT INTO tasks (board_id, project_id, title, description, workflow_state, execution_state, conversation_id${effectiveModel ? ", model" : ""})
         VALUES (?, ?, ?, ?, 'backlog', 'idle', ?${effectiveModel ? ", ?" : ""})`,
        effectiveModel
          ? [boardId, projectId, title, description, convId, effectiveModel]
          : [boardId, projectId, title, description, convId],
      );
      const newTaskId = taskRes.lastInsertRowid as number;
      db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [newTaskId, convId]);
      const newRow = db
        .query<TaskRow, [number]>(
          `SELECT t.*,
                  gc.worktree_status, gc.branch_name, gc.worktree_path,
                  (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           WHERE t.id = ?`,
        )
        .get(newTaskId)!;
      return JSON.stringify(mapTask(newRow));
    }

    case "edit_task": {
      const taskId = args.task_id ? parseInt(args.task_id, 10) : NaN;
      if (!taskId || isNaN(taskId)) return "Error: task_id is required";
      const db = getDb();
      const existing = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
      if (!existing) return `Error: task ${taskId} not found`;
      // Check worktree lock
      const gitRow = db
        .query<{ worktree_status: string | null }, [number]>(
          "SELECT worktree_status FROM task_git_context WHERE task_id = ?",
        )
        .get(taskId);
      if (gitRow?.worktree_status && gitRow.worktree_status !== "not_created") {
        return "Error: cannot edit task once a branch has been created";
      }
      const newTitle = (args.title ?? "").trim() || existing.title;
      const newDesc = args.description !== undefined ? args.description.trim() : existing.description;
      db.run("UPDATE tasks SET title = ?, description = ? WHERE id = ?", [newTitle, newDesc, taskId]);
      const updated = db
        .query<TaskRow, [number]>(
          `SELECT t.*,
                  gc.worktree_status, gc.branch_name, gc.worktree_path,
                  (SELECT COUNT(*) FROM executions e WHERE e.task_id = t.id) AS execution_count
           FROM tasks t
           LEFT JOIN task_git_context gc ON gc.task_id = t.id
           WHERE t.id = ?`,
        )
        .get(taskId)!;
      return JSON.stringify(mapTask(updated));
    }

    case "delete_task": {
      const taskId = args.task_id ? parseInt(args.task_id, 10) : NaN;
      if (!taskId || isNaN(taskId)) return "Error: task_id is required";
      const db = getDb();
      const row = db
        .query<{ current_execution_id: number | null; conversation_id: number }, [number]>(
          "SELECT current_execution_id, conversation_id FROM tasks WHERE id = ?",
        )
        .get(taskId);
      if (!row) return `Error: task ${taskId} not found`;
      if (row.current_execution_id != null && ctx.taskCallbacks) {
        ctx.taskCallbacks.cancelExecution(row.current_execution_id);
      }
      try {
        await removeWorktree(taskId);
      } catch { /* log only; deletion continues */ }
      db.run("DELETE FROM conversation_messages WHERE task_id = ?", [taskId]);
      db.run("DELETE FROM executions WHERE task_id = ?", [taskId]);
      db.run("DELETE FROM task_git_context WHERE task_id = ?", [taskId]);
      db.run("DELETE FROM pending_messages WHERE task_id = ?", [taskId]);
      db.run("DELETE FROM tasks WHERE id = ?", [taskId]);
      if (row.conversation_id) {
        db.run("DELETE FROM conversations WHERE id = ?", [row.conversation_id]);
      }
      return JSON.stringify({ success: true, deleted_task_id: taskId });
    }

    case "move_task": {
      const taskId = args.task_id ? parseInt(args.task_id, 10) : NaN;
      if (!taskId || isNaN(taskId)) return "Error: task_id is required";
      const targetState = (args.workflow_state ?? "").trim();
      if (!targetState) return "Error: workflow_state is required";
      const db = getDb();
      const taskRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
      if (!taskRow) return `Error: task ${taskId} not found`;
      // Validate target column exists in board's workflow template
      const boardRow = db
        .query<{ workflow_template_id: string }, [number]>(
          "SELECT workflow_template_id FROM boards WHERE id = ?",
        )
        .get(taskRow.board_id);
      const config = getConfig();
      const template = config.workflows.find((w) => w.id === boardRow?.workflow_template_id);
      const validColumn = template?.columns.find((c) => c.id === targetState);
      if (!validColumn) {
        const valid = template?.columns.map((c) => c.id).join(", ") ?? "(unknown)";
        return `Error: workflow_state "${targetState}" not found in board template. Valid columns: ${valid}`;
      }
      // Update workflow_state immediately
      db.run("UPDATE tasks SET workflow_state = ? WHERE id = ?", [targetState, taskId]);
      // Fire-and-forget transition (triggers on_enter_prompt asynchronously)
      if (ctx.taskCallbacks) {
        ctx.taskCallbacks.handleTransition(taskId, targetState);
      }
      return JSON.stringify({ success: true, task_id: taskId, workflow_state: targetState });
    }

    case "message_task": {
      const taskId = args.task_id ? parseInt(args.task_id, 10) : NaN;
      if (!taskId || isNaN(taskId)) return "Error: task_id is required";
      const message = (args.message ?? "").trim();
      if (!message) return "Error: message is required";
      const db = getDb();
      const taskRow = db
        .query<{ execution_state: string }, [number]>(
          "SELECT execution_state FROM tasks WHERE id = ?",
        )
        .get(taskId);
      if (!taskRow) return `Error: task ${taskId} not found`;
      if (taskRow.execution_state === "running") {
        // Queue message
        db.run(
          "INSERT INTO pending_messages (task_id, content) VALUES (?, ?)",
          [taskId, message],
        );
        return JSON.stringify({ status: "queued", task_id: taskId });
      }
      // Deliver immediately (fire-and-forget)
      if (ctx.taskCallbacks) {
        ctx.taskCallbacks.handleHumanTurn(taskId, message);
      }
      return JSON.stringify({ status: "delivered", task_id: taskId });
    }

    // ── todos group ───────────────────────────────────────────────────────────

    case "create_todo": {
      const taskId = ctx.taskId;
      if (!taskId) return "Error: create_todo is only available within a task execution";
      const title = (args.title ?? "").trim();
      if (!title) return "Error: title is required";
      const id = createTodo(taskId, title);
      return JSON.stringify({ id });
    }

    case "update_todo": {
      const taskId = ctx.taskId;
      if (!taskId) return "Error: update_todo is only available within a task execution";
      const id = args.id ? parseInt(args.id, 10) : NaN;
      if (!id || isNaN(id)) return "Error: id is required";
      const update: { title?: string; status?: string; result?: string } = {};
      if (args.title !== undefined) update.title = String(args.title).trim();
      if (args.status !== undefined) update.status = String(args.status);
      if (args.result !== undefined) update.result = String(args.result);
      const ok = dbUpdateTodo(taskId, id, update);
      if (!ok) return `Error: todo ${id} not found`;
      return JSON.stringify({ success: true, id });
    }

    case "delete_todo": {
      const taskId = ctx.taskId;
      if (!taskId) return "Error: delete_todo is only available within a task execution";
      const id = args.id ? parseInt(args.id, 10) : NaN;
      if (!id || isNaN(id)) return "Error: id is required";
      const ok = dbDeleteTodo(taskId, id);
      if (!ok) return `Error: todo ${id} not found`;
      return JSON.stringify({ success: true, id });
    }

    case "list_todos": {
      const taskId = ctx.taskId;
      if (!taskId) return "Error: list_todos is only available within a task execution";
      const todos = listTodos(taskId);
      return JSON.stringify(todos);
    }

    case "lsp": {
      if (!ctx.lspManager) {
        return "Error: LSP is not configured. Add lsp.servers to workspace.yaml.";
      }
      const abs = safePath(ctx.worktreePath, args.file_path ?? "");
      if (!abs) return "Error: file_path is outside the worktree";

      const op = args.operation ?? "";
      const line0 = args.line !== undefined ? Number(args.line) - 1 : 0;
      const char0 = args.character !== undefined ? Number(args.character) - 1 : 0;
      const docUri = pathToFileURL(abs).toString();
      const pos = { line: line0, character: char0 };

      switch (op) {
        case "goToDefinition": {
          const result = await ctx.lspManager.request(abs, "textDocument/definition", {
            textDocument: { uri: docUri },
            position: pos,
          });
          return formatDefinition(result, ctx.worktreePath);
        }
        case "findReferences": {
          const result = await ctx.lspManager.request(abs, "textDocument/references", {
            textDocument: { uri: docUri },
            position: pos,
            context: { includeDeclaration: true },
          });
          return formatReferences(result, ctx.worktreePath);
        }
        case "hover": {
          const result = await ctx.lspManager.request(abs, "textDocument/hover", {
            textDocument: { uri: docUri },
            position: pos,
          });
          return formatHover(result);
        }
        case "documentSymbol": {
          const result = await ctx.lspManager.request(abs, "textDocument/documentSymbol", {
            textDocument: { uri: docUri },
          });
          return formatDocumentSymbols(result, ctx.worktreePath);
        }
        case "workspaceSymbol": {
          const query = args.query ?? "";
          const result = await ctx.lspManager.request(abs, "workspace/symbol", { query });
          return formatWorkspaceSymbols(result, ctx.worktreePath);
        }
        case "goToImplementation": {
          const result = await ctx.lspManager.request(abs, "textDocument/implementation", {
            textDocument: { uri: docUri },
            position: pos,
          });
          return formatDefinition(result, ctx.worktreePath, "Implemented");
        }
        case "prepareCallHierarchy": {
          const result = await ctx.lspManager.request(abs, "textDocument/prepareCallHierarchy", {
            textDocument: { uri: docUri },
            position: pos,
          });
          return formatCallHierarchyItems(result as CallHierarchyItem[] | null, ctx.worktreePath);
        }
        case "incomingCalls": {
          const items = (await ctx.lspManager.request(abs, "textDocument/prepareCallHierarchy", {
            textDocument: { uri: docUri },
            position: pos,
          })) as CallHierarchyItem[] | null;
          if (!items || items.length === 0) return "No call hierarchy item found at that position";
          const result = await ctx.lspManager.request(abs, "callHierarchy/incomingCalls", { item: items[0] });
          return formatIncomingCalls(result, ctx.worktreePath);
        }
        case "outgoingCalls": {
          const items = (await ctx.lspManager.request(abs, "textDocument/prepareCallHierarchy", {
            textDocument: { uri: docUri },
            position: pos,
          })) as CallHierarchyItem[] | null;
          if (!items || items.length === 0) return "No call hierarchy item found at that position";
          const result = await ctx.lspManager.request(abs, "callHierarchy/outgoingCalls", { item: items[0] });
          return formatOutgoingCalls(result, ctx.worktreePath);
        }
        default:
          return `Error: unknown lsp operation "${op}"`;
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

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from "fs";
import { join, resolve, relative, dirname } from "path";
import { spawnSync } from "child_process";
import { lookup as dnsLookup } from "dns/promises";
import type { AIToolDefinition } from "../ai/types.ts";
import type { FileDiffPayload, Hunk, HunkLine } from "../../shared/rpc-types.ts";
import { getDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import type { TaskRow, ConversationMessageRow } from "../db/row-types.ts";
import { mapTask, mapConversationMessage } from "../db/mappers.ts";
import { removeWorktree } from "../git/worktree.ts";

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
  const removedLines = splitLines(removedText);
  const addedLines = splitLines(addedText);
  const removed = removedLines.length;
  const added = addedLines.length;

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
    for (const c of addedLines) lines.push({ type: "added", new_line: anchorLineIdx + 1, content: c });
    for (let i = anchorLineIdx + removedLines.length; i <= ctxEnd; i++) {
      lines.push({ type: "context", old_line: i + 1, new_line: i + 1 - removed + added, content: fileLines[i] });
    }
    hunks = [{ old_start: ctxStart + 1, new_start: ctxStart + 1, lines }];
  } else if (position === "start") {
    // Added lines prepended before file — show them followed by first CONTEXT_LINES as context
    const lines: HunkLine[] = [];
    addedLines.forEach((c, j) => lines.push({ type: "added", new_line: j + 1, content: c }));
    const ctxEnd = Math.min(fileLines.length - 1, CONTEXT_LINES - 1);
    for (let i = 0; i <= ctxEnd; i++) {
      lines.push({ type: "context", old_line: i + 1, new_line: added + i + 1, content: fileLines[i] });
    }
    hunks = [{ old_start: 1, new_start: 1, lines }];
  } else if (position === "end") {
    // Added lines appended after file — show last CONTEXT_LINES as context then the added lines
    const ctxStart = Math.max(0, fileLines.length - CONTEXT_LINES);
    const lines: HunkLine[] = [];
    for (let i = ctxStart; i < fileLines.length; i++) {
      lines.push({ type: "context", old_line: i + 1, new_line: i + 1, content: fileLines[i] });
    }
    addedLines.forEach((c, j) => lines.push({ type: "added", new_line: fileLines.length + j + 1, content: c }));
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
      "Ask one or more questions and present structured options to choose from. Use this when you need clarification or a decision before proceeding. Execution will pause until I respond. " +
      "For each option you may set: 'description' (one-line explanation of the option), 'recommended: true' (highlight the suggested default), 'preview' (markdown string shown as a comparison pane when the option is focused). " +
      "You MUST always provide a non-empty 'options' array for every question.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "One or more questions to ask. Batch related decisions into the same call to reduce round-trips.",
          items: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "The question text. Must be non-empty.",
              },
              selection_mode: {
                type: "string",
                enum: ["single", "multi"],
                description: "Whether the user can select one option ('single') or multiple ('multi').",
              },
              options: {
                type: "array",
                description: "The list of options to present. Must contain at least one option.",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      description: "The option text shown to the user.",
                    },
                    description: {
                      type: "string",
                      description: "Optional secondary text explaining what this option means.",
                    },
                    recommended: {
                      type: "boolean",
                      description: "Set to true to highlight this option as the recommended default.",
                    },
                    preview: {
                      type: "string",
                      description: "Optional markdown string shown as a preview pane when this option is focused.",
                    },
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
      "Make a targeted edit to an existing file. Choose a position mode:\n" +
      "- \"start\": prepend content before the first line\n" +
      "- \"end\": append content after the last line\n" +
      "- \"before\": insert content immediately before the anchor string\n" +
      "- \"after\": insert content immediately after the anchor string\n" +
      "- \"replace\": replace the anchor string with content (use content=\"\" to DELETE the anchor)\n\n" +
      "ANCHOR RULES (before/after/replace):\n" +
      "- The anchor must appear EXACTLY ONCE in the file. If it appears multiple times, the call will fail.\n" +
      "- Use a long, distinctive anchor (full line or multiple lines) — never use short repeated patterns like '---', '#', or empty lines as anchors.\n" +
      "- To delete a section, use position=\"replace\" with the full section text as anchor and content=\"\".\n" +
      "- Prefer write_file when making large structural changes; use patch_file for small targeted edits.",
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
          description: "Required for before/after/replace modes. Must be a unique string that appears exactly once in the file. Use full lines or multiple lines for uniqueness — avoid short or repeated patterns.",
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
  // ── tasks_read group ───────────────────────────────────────────────────────
  {
    name: "get_task",
    description:
      "Fetch metadata for a specific task. Returns title, description, workflow_state, execution_state, model, branch, and execution count. Optionally include the last N conversation messages.",
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
      "Return a summary of task distribution across all columns of a board. Shows total task count and breakdown by execution_state per column. Omit board_id to use the current task's board.",
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
      "List tasks on a board with optional filters. Use 'query' for a case-insensitive text search across title and description. Omit board_id to search the current task's board.",
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
      "Create a new task in the backlog column of a board. Omit board_id to create on the current task's board.",
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
      "Update the title and/or description of a task. Only allowed before a worktree/branch has been created for the task.",
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
      "Fully delete a task and all its data (conversation, executions, worktree directory). The git branch is kept. If the task is currently running, the execution is cancelled first.",
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
      "Move a task to a different workflow column. The task's workflow_state is updated immediately and the column's on_enter_prompt (if any) is triggered asynchronously. Returns immediately without waiting for execution.",
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
      "Append a message to another task's conversation and trigger its AI model. Returns 'delivered' if the task is idle/waiting, or 'queued' if the task is currently running (message will be delivered when it finishes).",
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
];

/** Built-in tool groups. A column's `tools` array may use group names, individual
 * tool names, or a mix. Groups are expanded by resolveToolsForColumn. */
export const TOOL_GROUPS: Map<string, string[]> = new Map([
  ["read", ["read_file", "list_dir"]],
  ["write", ["write_file", "patch_file", "delete_file", "rename_file"]],
  ["search", ["search_text", "find_files"]],
  ["shell", ["run_command"]],
  ["interactions", ["ask_me"]],
  ["agents", ["spawn_agent"]],
  ["web", ["fetch_url", "search_internet"]],
  ["tasks_read", ["get_task", "get_board_summary", "list_tasks"]],
  ["tasks_write", ["create_task", "edit_task", "delete_task", "move_task", "message_task"]],
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

// Shell write redirections (> >>) are blocked so that file writes go through
// the explicit write_file / replace_in_file tools where path-safety is enforced.
// We only block file-write redirections, not fd redirections like 2>&1 or >&2:
//   (?<![0-9&]) — not preceded by a digit (e.g. 2>) or & (e.g. &>targeting fd)
//   >>?          — literal > or >>
//   (?!&|\()     — not followed by & (fd redirect) or ( (process substitution)
const BLOCKED_COMMANDS = /\b(rm|rmdir|mv|cp|mkdir|chmod|chown|dd|mkfs|curl|wget|ssh|scp|git\s+(push|reset|clean|checkout\s+-f)|tee)\b|(?<![0-9&])(>>?)(?!&|\()/i;

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
export type TaskToolCallbacks = {
  /** Fire-and-forget: update workflow_state and trigger on_enter_prompt if present. */
  handleTransition: (taskId: number, toState: string) => void;
  /** Fire-and-forget: append a human message and resume execution. */
  handleHumanTurn: (taskId: number, message: string) => void;
  /** Abort the in-flight execution (safe to call if already stopped). */
  cancelExecution: (executionId: number) => void;
};

export interface ToolContext {
  worktreePath: string; // absolute path to the git worktree
  searchConfig?: { engine: string; api_key: string }; // from workspace.yaml search block
  taskId?: number; // id of the currently executing task (for board-scoped tools)
  boardId?: number; // board the executing task belongs to
  taskCallbacks?: TaskToolCallbacks; // engine callbacks for move_task / message_task
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

    case "delete_file": {
      const abs = safePath(ctx.worktreePath, args.path ?? "");
      if (!abs) return "Error: path traversal detected — path must be inside the worktree.";
      if (!existsSync(abs)) return `Error: file not found: ${args.path}`;
      try {
        const stat = statSync(abs);
        if (!stat.isFile()) return `Error: ${args.path} is not a file.`;
        const deletedLines = splitLines(readFileSync(abs, "utf-8"));
        unlinkSync(abs);
        const diff: FileDiffPayload = {
          operation: "delete_file",
          path: args.path,
          added: 0,
          removed: deletedLines.length,
          hunks: [{
            old_start: 1, new_start: 1,
            lines: deletedLines.map((c, i) => ({ type: "removed" as const, old_line: i + 1, content: c })),
          }],
        };
        return { content: `OK: deleted ${args.path} (${deletedLines.length} lines)`, diff } as WriteResult;
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
          const added = splitLines(insertion).length;
          const diff = patchDiff("patch_file", args.path, fileLines, null, "", insertion, position);
          return { content: `OK: patched ${args.path} (+${added} lines, prepended)`, diff } as WriteResult;
        }
        if (position === "end") {
          writeFileSync(abs, content + insertion, "utf-8");
          const added = splitLines(insertion).length;
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
        if (newContent === content) {
          return `Error: this patch would not modify the file. For deletion use position="replace" with content="" and anchor set to the exact text to remove. For insertion ensure content is non-empty.`;
        }
        writeFileSync(abs, newContent, "utf-8");

        const added = splitLines(addedText).length;
        const removed = splitLines(removedText).length;
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
      const globPat = args.glob ?? "";
      const contextLines = args.context_lines ? parseInt(String(args.context_lines), 10) : 0;
      try {
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, "i");
        } catch {
          return `Error: invalid regex pattern: ${pattern}`;
        }

        // Convert a glob pattern to a RegExp for relative path matching.
        const globRe = globToRegex(globPat, /* caseInsensitive */ true);
        const IGNORE_DIRS = new Set([".git", "node_modules", "dist", ".cache"]);
        const MAX_OUTPUT = 8_000;
        const matches: string[] = [];

        const walkAndSearch = (dir: string): void => {
          if (matches.join("\n").length >= MAX_OUTPUT) return;
          let entries: string[];
          try { entries = readdirSync(dir); } catch { return; }
          for (const entry of entries) {
            if (IGNORE_DIRS.has(entry)) continue;
            const fullPath = join(dir, entry);
            let stat;
            try { stat = statSync(fullPath); } catch { continue; }
            if (stat.isDirectory()) {
              walkAndSearch(fullPath);
            } else if (stat.isFile()) {
              const relPath = relative(ctx.worktreePath, fullPath);
              if (globRe && !globRe.test(relPath)) continue;
              let content: string;
              try { content = readFileSync(fullPath, "utf-8"); } catch { continue; }
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (!regex.test(lines[i])) continue;
                // Collect context window around the match
                const from = Math.max(0, i - contextLines);
                const to = Math.min(lines.length - 1, i + contextLines);
                for (let j = from; j <= to; j++) {
                  const prefix = j === i ? `${relPath}:${j + 1}:` : `${relPath}-${j + 1}-`;
                  matches.push(`${prefix}${lines[j]}`);
                }
                if (contextLines > 0 && i + contextLines < lines.length - 1) {
                  matches.push("--");
                }
                if (matches.join("\n").length >= MAX_OUTPUT) return;
              }
            }
          }
        };

        walkAndSearch(ctx.worktreePath);
        if (matches.length === 0) return "(no matches found)";
        const out = matches.join("\n");
        return out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + "\n[truncated]" : out;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "find_files": {
      const globPat = args.glob ?? "";
      try {
        const re = globToRegex(globPat, process.platform === "win32") ?? /(?:)/;
        const IGNORE_DIRS = new Set([".git", "node_modules", "dist", ".cache"]);
        const found: string[] = [];

        const walk = (dir: string): void => {
          if (found.length >= 500) return;
          let entries: string[];
          try { entries = readdirSync(dir); } catch { return; }
          for (const entry of entries) {
            if (IGNORE_DIRS.has(entry)) continue;
            const fullPath = join(dir, entry);
            let stat;
            try { stat = statSync(fullPath); } catch { continue; }
            const relPath = relative(ctx.worktreePath, fullPath);
            if (stat.isDirectory()) {
              walk(fullPath);
            } else if (stat.isFile() && re.test(relPath)) {
              found.push(relPath);
            }
          }
        };

        walk(ctx.worktreePath);
        found.sort();
        if (found.length === 0) return "(no files found)";
        return found.join("\n");
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
            `SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY created_at DESC LIMIT ?`,
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

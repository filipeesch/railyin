import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from "fs";
import { join, resolve, relative, dirname } from "path";
import { spawnSync } from "child_process";
import { lookup as dnsLookup } from "dns/promises";
import type { AIToolDefinition } from "../ai/types.ts";

// ─── Tool definitions (JSON schema for the model) ─────────────────────────────

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
): Promise<string> {
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
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, args.content ?? "", "utf-8");
        return `OK: wrote ${args.path}`;
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
        unlinkSync(abs);
        return `OK: deleted ${args.path}`;
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
        return `OK: renamed ${args.from_path} → ${args.to_path}`;
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
        const insertion = args.content ?? "";
        const position = args.position ?? "";
        const anchor = args.anchor as string | undefined;

        if (position === "start") {
          writeFileSync(abs, insertion + content, "utf-8");
          return `OK: patched ${args.path} (prepended)`;
        }
        if (position === "end") {
          writeFileSync(abs, content + insertion, "utf-8");
          return `OK: patched ${args.path} (appended)`;
        }
        // Anchor-based positions
        if (!anchor) return `Error: anchor is required for position "${position}"`;
        const occurrences = content.split(anchor).length - 1;
        if (occurrences === 0) return `Error: anchor not found in ${args.path}`;
        if (occurrences > 1) {
          return `Error: anchor appears ${occurrences} times in ${args.path} — must be unique. Add more context to make it unambiguous.`;
        }
        let newContent: string;
        if (position === "before") {
          newContent = content.replace(anchor, insertion + anchor);
        } else if (position === "after") {
          newContent = content.replace(anchor, anchor + insertion);
        } else if (position === "replace") {
          newContent = content.replace(anchor, insertion);
        } else {
          return `Error: unknown position "${position}". Use start, end, before, after, or replace.`;
        }
        writeFileSync(abs, newContent, "utf-8");
        return `OK: patched ${args.path} (${position})`;
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
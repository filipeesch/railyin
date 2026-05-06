import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import { Type } from "@mariozechner/pi-ai";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function safePath(
  worktreePath: string,
  inputPath: string,
): { safe: true; abs: string; rel: string } | { safe: false; error: string } {
  const abs = isAbsolute(inputPath) ? inputPath : join(worktreePath, inputPath);
  const resolved = resolve(abs);
  if (!resolved.startsWith(worktreePath + "/") && resolved !== worktreePath) {
    return {
      safe: false,
      error: "Error: path traversal detected — path must be inside the worktree",
    };
  }
  return { safe: true, abs: resolved, rel: relative(worktreePath, resolved) };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

const readFileParams = Type.Object({
  path: Type.String({
    description: "Path to the file to read, relative to the worktree root or absolute.",
  }),
  start_line: Type.Optional(
    Type.Integer({
      description: "1-based line number to start reading from (inclusive).",
    }),
  ),
  end_line: Type.Optional(
    Type.Integer({
      description: "1-based line number to stop reading at (inclusive).",
    }),
  ),
});

function readFileTool(harnessCtx: HarnessContext): AgentTool<typeof readFileParams> {
  return {
    name: "read_file",
    label: "Read File",
    description: `Read a file from the worktree.

ALWAYS use start_line and end_line to read specific sections of large files — do NOT read an entire large file when you only need part of it.
If the result is "[file unchanged since turn N — use your cached version]", the file has NOT changed — NEVER call read_file again for the same path, use your cached version instead.
NEVER read a file you just wrote — the write result already confirms success.`,
    parameters: readFileParams,
    execute: async (_toolCallId, args) => {
      const checked = safePath(harnessCtx.worktreePath, args.path);
      if (!checked.safe) {
        return {
          content: [{ type: "text", text: checked.error }],
          details: { path: args.path },
          isError: true,
        };
      }

      const { abs: absPath, rel: relPath } = checked;

      if (!existsSync(absPath)) {
        return {
          content: [{ type: "text", text: `Error: file not found — ${relPath}` }],
          details: { path: args.path },
          isError: true,
        };
      }

      const stat = statSync(absPath);
      if (stat.size > 512_000) {
        return {
          content: [
            {
              type: "text",
              text: `Error: file too large (${stat.size} bytes) — use start_line/end_line to read sections`,
            },
          ],
          details: { path: args.path },
          isError: true,
        };
      }

      const fullContent = readFileSync(absPath, "utf-8");
      const hash = sha256(fullContent);
      const allLines = fullContent.split("\n");
      const totalLines = allLines.length;

      const hasRange = args.start_line != null || args.end_line != null;
      const rangeKey = hasRange
        ? `${args.start_line ?? 1}:${args.end_line ?? totalLines}`
        : "0:0";

      const cacheResult = harnessCtx.hashCache.checkFile(absPath, hash, rangeKey, 0);
      if (cacheResult.hit && cacheResult.message) {
        return {
          content: [{ type: "text", text: cacheResult.message }],
          details: { path: args.path },
        };
      }

      let content: string;
      let fromLine: number;
      let toLine: number;

      if (hasRange) {
        fromLine = Math.max(1, args.start_line ?? 1);
        toLine = Math.min(totalLines, args.end_line ?? totalLines);
        const sliced = allLines.slice(fromLine - 1, toLine);
        content = sliced.join("\n");
      } else {
        fromLine = 1;
        toLine = totalLines;
        content = fullContent;
      }

      harnessCtx.hashCache.updateFile(absPath, hash, rangeKey, 0);

      const header = hasRange
        ? `// path: ${relPath}\n// lines: ${fromLine}-${toLine} of ${totalLines}\n`
        : `// path: ${relPath}\n// lines: 1-${totalLines}\n`;

      return {
        content: [{ type: "text", text: header + content }],
        details: { path: args.path, fromLine, toLine, totalLines },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// glob
// ---------------------------------------------------------------------------

const globParams = Type.Object({
  pattern: Type.String({
    description: "Glob pattern to match against files/directories in the worktree.",
  }),
  type: Type.Optional(
    Type.Union(
      [Type.Literal("file"), Type.Literal("dir"), Type.Literal("any")],
      { default: "file", description: "Match files, directories, or both. Defaults to 'file'." },
    ),
  ),
  limit: Type.Optional(
    Type.Integer({ default: 100, description: "Maximum number of results to return per page." }),
  ),
  offset: Type.Optional(
    Type.Integer({ default: 0, description: "Number of results to skip for pagination." }),
  ),
});

function globTool(harnessCtx: HarnessContext): AgentTool<typeof globParams> {
  return {
    name: "glob",
    label: "Glob",
    description: `Find files and directories matching a glob pattern in the worktree.

Use type="file" (default) for files, type="dir" for directories, type="any" for both.
Results are paginated — use offset to get the next page.
If the result is "[search unchanged — same as turn N]", the listing has NOT changed — NEVER call glob again with the same parameters.
ALWAYS prefer glob over run_command for file discovery.`,
    parameters: globParams,
    execute: async (_toolCallId, args) => {
      const cwd = harnessCtx.worktreePath;
      const type = args.type ?? "file";
      const limit = args.limit ?? 100;
      const offset = args.offset ?? 0;
      const cacheKey = `glob:${args.pattern}:${type}:${offset}`;

      const g = new Bun.Glob(args.pattern);

      let entries: string[];

      if (type === "dir") {
        const all = await Array.fromAsync(g.scan({ cwd, onlyFiles: false }));
        entries = all.filter((p) => statSync(join(cwd, p)).isDirectory());
        entries.sort();
      } else {
        const onlyFiles = type === "file";
        const all = await Array.fromAsync(g.scan({ cwd, onlyFiles }));
        if (type === "any") {
          // Sort dirs alphabetically, files by mtime desc, then interleave
          const dirs = all.filter((p) => statSync(join(cwd, p)).isDirectory()).sort();
          const files = all
            .filter((p) => !statSync(join(cwd, p)).isDirectory())
            .sort((a, b) => statSync(join(cwd, b)).mtimeMs - statSync(join(cwd, a)).mtimeMs);
          entries = [...dirs, ...files];
        } else {
          // type === "file" — sort by mtime desc
          entries = all.sort(
            (a, b) => statSync(join(cwd, b)).mtimeMs - statSync(join(cwd, a)).mtimeMs,
          );
        }
      }

      const total = entries.length;
      const page = entries.slice(offset, offset + limit);

      const resultHash = sha256(page.join("\n"));
      const cacheResult = harnessCtx.hashCache.checkSearch(cacheKey);
      if (cacheResult.hit && cacheResult.message) {
        return {
          content: [{ type: "text", text: cacheResult.message }],
          details: { pattern: args.pattern, type, total, offset },
        };
      }

      harnessCtx.hashCache.updateSearch(cacheKey, 0);

      const fromIdx = offset + 1;
      const toIdx = offset + page.length;
      let text = page.join("\n");

      if (total > offset + limit) {
        const nextOffset = offset + limit;
        text += `\n[Showing ${fromIdx}-${toIdx} of ${total}. Use offset=${nextOffset} for next page.]`;
      } else if (total === 0) {
        text = `[No matches for pattern: ${args.pattern}]`;
      }

      // Suppress unused-variable warning — hash is used only for cache key derivation above
      void resultHash;

      return {
        content: [{ type: "text", text }],
        details: { pattern: args.pattern, type, total, offset, count: page.length },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function buildReadTools(harnessCtx: HarnessContext): AgentTool<any>[] {
  return [readFileTool(harnessCtx), globTool(harnessCtx)];
}

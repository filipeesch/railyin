import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import type { ContentHashCache } from "../harness/hash-cache.ts";
import { Type } from "@earendil-works/pi-ai";
import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import picomatch from "picomatch";

const OUTPUT_LIMIT = 20 * 1024;

// ---------------------------------------------------------------------------
// Cache invalidation helper (exported for use by write tools)
// ---------------------------------------------------------------------------

export function invalidateSearchByPath(
  cache: ContentHashCache,
  absPath: string,
  worktreePath: string,
): void {
  const relPath = relative(worktreePath, absPath);
  const keys = cache.getSearchKeys();
  for (const key of keys) {
    // Key format: "search:PATTERN:GLOB:ctx:mode:offset"
    const parts = key.split(":");
    const glob = parts[2]; // may be empty
    if (!glob || picomatch(glob)(relPath)) {
      cache.invalidateSearch(key);
    }
  }
}

// ---------------------------------------------------------------------------
// search_text
// ---------------------------------------------------------------------------

const searchTextParams = Type.Object({
  pattern: Type.String({
    description: "Ripgrep-compatible regex pattern to search for.",
  }),
  glob: Type.Optional(Type.String({
    description: "Glob pattern to restrict the search scope (e.g., '**/*.ts').",
  })),
  context_lines: Type.Optional(Type.Integer({
    default: 3,
    description: "Number of context lines to show around each match.",
  })),
  output_mode: Type.Optional(Type.Union([
    Type.Literal("content"),
    Type.Literal("files_with_matches"),
    Type.Literal("count"),
  ], {
    default: "content",
    description: "Output format: 'content' (matching lines), 'files_with_matches' (file paths only), 'count' (match counts per file).",
  })),
  limit: Type.Optional(Type.Integer({
    default: 250,
    description: "Maximum number of output lines to return.",
  })),
  offset: Type.Optional(Type.Integer({
    default: 0,
    description: "Number of output lines to skip (for pagination).",
  })),
});

function searchTextTool(harnessCtx: HarnessContext): AgentTool<typeof searchTextParams> {
  return {
    name: "search_text",
    label: "Search Text",
    description: `Search for a pattern in worktree files using ripgrep-compatible regex.

Use glob to restrict the search scope (e.g., "**/*.ts").
Use output_mode="files_with_matches" to find which files contain the pattern before reading them.
Use context_lines to see lines around each match.
Results are paginated — use offset to continue.
If the result is "[search unchanged — same as turn N]", the results have NOT changed since last search — do NOT search again.`,
    parameters: searchTextParams,
    execute: async (_id, args) => {
      const contextLines = args.context_lines ?? 3;
      const outputMode = args.output_mode ?? "content";
      const limit = args.limit ?? 250;
      const offset = args.offset ?? 0;
      const glob = args.glob ?? "";

      const cacheKey = `search:${args.pattern}:${glob}:${contextLines}:${outputMode}:${offset}`;
      const cacheResult = harnessCtx.hashCache.checkSearch(cacheKey);
      if (cacheResult.hit && cacheResult.message) {
        return {
          content: [{ type: "text", text: cacheResult.message }],
          details: { pattern: args.pattern, glob, outputMode },
        };
      }

      const rgArgs: string[] = ["--no-heading"];

      if (outputMode === "files_with_matches") {
        rgArgs.push("-l");
      } else if (outputMode === "count") {
        rgArgs.push("-c");
      } else {
        // content mode
        if (contextLines > 0) {
          rgArgs.push(`-C${contextLines}`);
        }
        rgArgs.push("-n");
      }

      if (glob) {
        rgArgs.push("--glob", glob);
      }

      rgArgs.push("--", args.pattern);

      const result = spawnSync("rg", rgArgs, {
        cwd: harnessCtx.worktreePath,
        maxBuffer: OUTPUT_LIMIT * 4,
      });

      let raw = "";
      if (result.stdout && result.stdout.length > 0) {
        raw = result.stdout.toString();
      }

      // Non-zero exit: 1 = no matches (normal), 2 = error
      if (result.status === 2) {
        const errText = result.stderr ? result.stderr.toString().trim() : "unknown ripgrep error";
        return {
          content: [{ type: "text", text: `Error: ${errText}` }],
          details: { pattern: args.pattern, glob, outputMode },
          isError: true,
        };
      }

      if (!raw.trim()) {
        const noMatchText = `[No matches for pattern: ${args.pattern}${glob ? ` in ${glob}` : ""}]`;
        harnessCtx.hashCache.updateSearch(cacheKey, 0);
        return {
          content: [{ type: "text", text: noMatchText }],
          details: { pattern: args.pattern, glob, outputMode, matchCount: 0 },
        };
      }

      // Paginate by lines
      const allLines = raw.split("\n");
      const totalLines = allLines.length;
      const pageLines = allLines.slice(offset, offset + limit);
      let text = pageLines.join("\n");

      if (text.length > OUTPUT_LIMIT) {
        text = text.slice(0, OUTPUT_LIMIT) + "\n[output truncated]";
      }

      if (totalLines > offset + limit) {
        const nextOffset = offset + limit;
        text += `\n[Showing lines ${offset + 1}-${offset + pageLines.length} of ${totalLines}. Use offset=${nextOffset} for next page.]`;
      }

      harnessCtx.hashCache.updateSearch(cacheKey, 0);

      return {
        content: [{ type: "text", text }],
        details: { pattern: args.pattern, glob, outputMode, totalLines, offset, count: pageLines.length },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function buildSearchTools(harnessCtx: HarnessContext): AgentTool<any>[] {
  return [searchTextTool(harnessCtx)];
}

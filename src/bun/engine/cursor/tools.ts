/**
 * Cursor tool registration — wraps Railyn's common task-management tools as
 * Cursor SDKCustomTool entries (keyed by tool name).
 *
 * Converts COMMON_TOOL_DEFINITIONS from engine/common-tools.ts into the
 * @cursor/sdk SDKCustomTool format. Suspend-loop tools (e.g. decision_request)
 * report their payload via the onSuspend callback so the engine can abort the
 * run and yield a decision_request event upstream.
 *
 * Cursor's built-in tools (Read/Edit/Shell/Grep) remain available alongside
 * these — the SDK does not expose a knob to disable them. The agent is steered
 * via system instructions to use Railyn's tools for task orchestration.
 */

import type { SDKCustomTool, SDKJsonValue } from "@cursor/sdk";
import type { CommonToolContext } from "../types.ts";
import { COMMON_TOOL_DEFINITIONS, executeCommonTool } from "../common-tools.ts";
import type { McpClientRegistry } from "../../mcp/registry.ts";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { existsSync } from "node:fs";

const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;

function truncate(out: string): string {
  if (out.length <= MAX_TOOL_OUTPUT_BYTES) return out;
  return out.slice(0, MAX_TOOL_OUTPUT_BYTES) + `\n…(truncated, ${out.length - MAX_TOOL_OUTPUT_BYTES} more bytes)`;
}

function resolveCwd(cwd: string | undefined, fallback: string): string {
  if (!cwd) return fallback;
  return isAbsolute(cwd) ? cwd : resolvePath(fallback, cwd);
}

function spawnCollect(cmd: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveFn) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolveFn({ stdout, stderr, code });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolveFn({ stdout, stderr: `${stderr}\n${err.message}`, code: -1 });
    });
  });
}

function findBundledRipgrep(): string {
  const candidates = [
    `${process.cwd()}/node_modules/@cursor/sdk-darwin-arm64/bin/rg`,
    `${process.cwd()}/node_modules/@cursor/sdk-darwin-x64/bin/rg`,
    `${process.cwd()}/node_modules/@cursor/sdk-linux-arm64/bin/rg`,
    `${process.cwd()}/node_modules/@cursor/sdk-linux-x64/bin/rg`,
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return "rg"; // fall back to PATH
}

/**
 * Bypass tools for Cursor's broken built-ins. In @cursor/sdk 1.0.18 the
 * Shell/Glob/Grep tools fail with NGHTTP2 transport errors on directories of
 * non-trivial size even with our maxFrameSize patch (because the SDK's own
 * server-side reply still violates internal limits). We expose Railyn-native
 * equivalents the agent can use instead.
 */
function buildBypassTools(worktreePath: string): Record<string, SDKCustomTool> {
  const rgPath = findBundledRipgrep();

  return {
    railyin_shell: {
      description:
        "Execute a shell command in the working directory and return stdout, stderr, and exit code. " +
        "USE THIS instead of the built-in `Shell` tool, which is broken in this environment. " +
        "Command runs through /bin/bash -lc. Output is truncated to 64 KB.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
          cwd: { type: "string", description: "Optional working directory (absolute or relative to worktree). Defaults to the worktree root." },
          timeout_ms: { type: "number", description: "Optional timeout in milliseconds (default 30000)" },
        },
        required: ["command"],
      },
      execute: async (args) => {
        const command = String((args as any).command ?? "");
        const cwd = resolveCwd((args as any).cwd as string | undefined, worktreePath);
        const timeoutMs = Number((args as any).timeout_ms ?? 30_000);
        const { stdout, stderr, code } = await spawnCollect("/bin/bash", ["-lc", command], cwd, timeoutMs);
        return truncate(`exit_code: ${code}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
      },
    },

    railyin_grep: {
      description:
        "Search file contents with ripgrep. " +
        "USE THIS instead of the built-in `Grep` tool, which is broken in this environment. " +
        "Output is truncated to 64 KB.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern (ripgrep syntax)" },
          path: { type: "string", description: "Optional file or directory to search (absolute or relative to worktree). Defaults to the worktree root." },
          case_insensitive: { type: "boolean", description: "Case-insensitive match. Default false." },
          glob: { type: "string", description: "Optional glob filter, e.g. '*.ts' or '!*.test.ts'." },
          context: { type: "number", description: "Lines of context around each match (default 0)." },
          max_count: { type: "number", description: "Stop after this many matches per file." },
        },
        required: ["pattern"],
      },
      execute: async (args) => {
        const pattern = String((args as any).pattern ?? "");
        const path = resolveCwd((args as any).path as string | undefined, worktreePath);
        const rgArgs: string[] = ["--no-heading", "-n"];
        if ((args as any).case_insensitive) rgArgs.push("-i");
        if ((args as any).context != null) rgArgs.push("-C", String((args as any).context));
        if ((args as any).max_count != null) rgArgs.push("-m", String((args as any).max_count));
        if ((args as any).glob) rgArgs.push("-g", String((args as any).glob));
        rgArgs.push(pattern, path);
        const { stdout, stderr, code } = await spawnCollect(rgPath, rgArgs, worktreePath);
        if (code === 1 && !stdout) return "(no matches)";
        if (code !== 0 && code !== 1) return truncate(`ripgrep exited ${code}\n${stderr}`);
        return truncate(stdout);
      },
    },

    railyin_glob: {
      description:
        "Find files matching a glob pattern. " +
        "USE THIS instead of the built-in `Glob` tool, which is broken in this environment. " +
        "Returns one path per line, capped at 1000 entries.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern, e.g. 'src/**/*.ts'." },
          cwd: { type: "string", description: "Optional working directory (absolute or relative to worktree)." },
        },
        required: ["pattern"],
      },
      execute: async (args) => {
        const pattern = String((args as any).pattern ?? "");
        const cwd = resolveCwd((args as any).cwd as string | undefined, worktreePath);
        const glob = new (globalThis as any).Bun.Glob(pattern);
        const matches: string[] = [];
        for await (const entry of glob.scan({ cwd, onlyFiles: false })) {
          matches.push(entry);
          if (matches.length >= 1000) {
            matches.push("…(truncated at 1000 entries)");
            break;
          }
        }
        return matches.length ? matches.join("\n") : "(no matches)";
      },
    },

    railyin_read: {
      description:
        "Read a file. Mostly a fallback — the built-in `Read` tool works for single files in this environment, but use this if it fails. " +
        "Output is truncated to 64 KB. Supports optional offset/limit (in bytes).",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (absolute or relative to worktree)." },
          offset: { type: "number", description: "Optional byte offset to start reading from." },
          limit: { type: "number", description: "Optional byte count to read." },
        },
        required: ["path"],
      },
      execute: async (args) => {
        const path = resolveCwd((args as any).path as string | undefined, worktreePath);
        try {
          const buf = await readFile(path);
          const offset = Math.max(0, Number((args as any).offset ?? 0));
          const limit = Number((args as any).limit ?? buf.byteLength - offset);
          const slice = buf.subarray(offset, offset + limit).toString("utf8");
          return truncate(slice);
        } catch (err) {
          return `Error reading ${path}: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}

/**
 * Build a Record of Cursor SDKCustomTool entries (keyed by tool name) for the
 * given execution context. Common tools and (optionally) MCP tools are merged
 * into a single map suitable for `LocalAgentOptions.customTools`.
 */
export function buildCursorTools(
  context: CommonToolContext,
  mcpRegistry?: McpClientRegistry | null,
  enabledMcpTools?: string[] | null,
  onSuspend?: (payload: string) => void,
): Record<string, SDKCustomTool> {
  const tools: Record<string, SDKCustomTool> = {};

  for (const def of COMMON_TOOL_DEFINITIONS) {
    tools[def.name] = {
      description: def.description,
      inputSchema: def.parameters as Record<string, SDKJsonValue>,
      execute: async (args) => {
        try {
          const result = await executeCommonTool(
            def.name,
            (args ?? {}) as Record<string, unknown>,
            context,
          );
          if (result.type === "suspend") {
            onSuspend?.(result.payload);
            return "Interview suspended - awaiting user response.";
          }
          return result.text;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    };
  }

  if (mcpRegistry) {
    for (const def of mcpRegistry.listTools(enabledMcpTools ?? null)) {
      tools[def.qualifiedName] = {
        description: def.description ?? `MCP tool: ${def.name}`,
        inputSchema: def.inputSchema as Record<string, SDKJsonValue>,
        execute: async (args) => {
          return (await mcpRegistry.callTool(
            def.serverName,
            def.name,
            (args as Record<string, unknown>) ?? {},
          )) as SDKJsonValue;
        },
      };
    }
  }

  if (context.runtime.worktreePath) {
    Object.assign(tools, buildBypassTools(context.runtime.worktreePath));
  }

  return tools;
}

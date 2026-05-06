import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import { Type } from "@mariozechner/pi-ai";
import { spawnSync } from "node:child_process";

const STDOUT_LIMIT = 8 * 1024;
const STDERR_LIMIT = 2 * 1024;
const TIMEOUT_MS = 15_000;

const runCommandParams = Type.Object({
  command: Type.String({
    description: "Shell command to run (executed via sh -c in the worktree directory).",
  }),
});

function buildShellTool(harnessCtx: HarnessContext): AgentTool<typeof runCommandParams> {
  return {
    name: "run_command",
    label: "Run Command",
    description: `Run a shell command in the worktree for read-only inspection (git, grep, ls, cat, etc.).

NEVER use run_command to write or edit files — ALWAYS use write_file or patch_file instead.
NEVER use run_command to create files, append to files, or redirect output to files.
ALWAYS prefer read_file, glob, and search_text over shell commands for file operations.
Use run_command for: git commands, running tests, checking tool versions, network inspection.`,
    parameters: runCommandParams,
    execute: async (_id, args) => {
      const result = spawnSync("sh", ["-c", args.command], {
        cwd: harnessCtx.worktreePath,
        timeout: TIMEOUT_MS,
        maxBuffer: (STDOUT_LIMIT + STDERR_LIMIT) * 2,
      });

      const rawStdout = result.stdout ? result.stdout.toString() : "";
      const rawStderr = result.stderr ? result.stderr.toString() : "";

      let stdout = rawStdout.slice(0, STDOUT_LIMIT);
      if (rawStdout.length > STDOUT_LIMIT) stdout += "\n[stdout truncated]";

      let stderr = rawStderr.slice(0, STDERR_LIMIT);
      if (rawStderr.length > STDERR_LIMIT) stderr += "\n[stderr truncated]";

      const parts: string[] = [];
      if (stdout) parts.push(stdout);
      if (stderr) parts.push(`STDERR:\n${stderr}`);
      if (result.status !== 0) parts.push(`Exit code: ${result.status ?? "null"}`);
      if (result.error) parts.push(`Error: ${result.error.message}`);

      const text = parts.join("\n").trim() || "(no output)";

      return {
        content: [{ type: "text", text }],
        details: { command: args.command, exitCode: result.status },
      };
    },
  };
}

export function buildShellTools(harnessCtx: HarnessContext): AgentTool<any>[] {
  return [buildShellTool(harnessCtx)];
}
